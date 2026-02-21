/**
 * Main orchestrator for the recruiting pipeline
 * Uses LangGraph DeepAgents for state management and execution
 */

import { createDeepAgent, FilesystemBackend, createSubAgentMiddleware, createFilesystemMiddleware, type SubAgent } from "deepagents";
import type { BaseLanguageModel } from "@langchain/core/language_models/base";
import { type BaseCheckpointSaver, Command } from "@langchain/langgraph";
import type { StructuredTool } from "@langchain/core/tools";
import type { AgentMiddleware } from "langchain";
import type { UserProfile, CompanyReviewItem, StreamEvent, InterruptChunk } from "@/core/types";
import { SUBAGENT_DEFINITIONS, assignToolsToSubagent } from "./subagents";
import { logger } from "@/utils/logger";
import * as clack from "@clack/prompts";
import { existsSync, readFileSync } from "fs";
import { join } from "path";

// ============================================================================
// Orchestrator Configuration
// ============================================================================

const ORCHESTRATOR_PROMPT = `You coordinate a recruiting outreach pipeline.

IMPORTANT: You will be given a WORKSPACE DIRECTORY and STORAGE DIRECTORY.
- Workspace directory: for this run's files
- Storage directory: for cross-run persistent data (contacted companies)
Pass the workspace directory to all subagent tasks.

STAGE 0: CHECK PREVIOUSLY CONTACTED COMPANIES
Before finding companies, read the contacted companies list:
1. Read <storage>/contacted.json (array of company objects with "domain" field)
2. If file doesn't exist or is empty, treat as empty array []
3. Extract all domains into a list of already-contacted companies

STAGE 1: COMPANY DISCOVERY
- Use web search to find NEW companies matching the student's preferences
- Target the number of companies specified in the max outreach configuration
- CRITICAL: Exclude any companies whose domain appears in the contacted list from Stage 0
- Look for companies that are hiring, growing, or match the target roles/industries
- For each company, note: name, domain, description, why it's a good fit
- Save to <workspace>/companies.json as array of company objects:
  [
    {
      "name": "Company Name",
      "domain": "company.com",
      "description": "Brief description",
      "why_good_fit": "Why this matches student preferences",
      "selected": true,
      "status": "PENDING"
    }
  ]

STAGE 1.5: HUMAN REVIEW (LOOP UNTIL APPROVED)
After saving companies to companies.json, call review_companies with the full list.
The human will either APPROVE or REJECT with feedback.

IF APPROVED: The tool returns { approved: true, instruction: "proceed to Stage 2" }
  - Immediately proceed to Stage 2 with the approved companies

IF REJECTED: The human provides feedback (e.g., "more startup focused", "different industry")
  - You will receive the feedback as a message
  - Use the feedback to search for NEW/DIFFERENT companies
  - Update companies.json with the new list
  - Call review_companies AGAIN with the new list
  - REPEAT this loop until the human approves

CRITICAL: After rejection, you MUST find new companies and call review_companies again. Do NOT proceed to Stage 2 until approved. Do NOT give up or end the run.

STAGE 2: PARALLEL COMPANY PROCESSING (CRITICAL)
After finding companies, invoke the task tool MULTIPLE TIMES IN A SINGLE RESPONSE.
Each task should process one company using the "company-flow" subagent.

IMPORTANT: Do NOT process companies one at a time. Issue ALL task calls together.

Example - issue ALL at once (include workspace in each task message):
  task("company-flow", "Workspace: <workspace>. Process Acme Corp (acme.com): AI startup, hiring engineers")
  task("company-flow", "Workspace: <workspace>. Process Beta Inc (beta.io): Fintech company, Series B")
  task("company-flow", "Workspace: <workspace>. Process Gamma Co (gamma.com): Dev tools, remote-first")
  ... (repeat for all selected companies)

Each company-flow task will:
1. Research the company (1 quick search)
2. Find contacts using people_lookup (engineers only, number specified in config)
3. Draft personalized emails for each contact
4. Update the company entry in <workspace>/companies.json with status (SUCCESS or FAILED)

STAGE 3: UPDATE CONTACTED COMPANIES
After all company-flow tasks complete:
1. Read <workspace>/companies.json to see which companies have status "SUCCESS"
2. Read <storage>/contacted.json (or initialize as [] if doesn't exist)
3. For each successful company (status: "SUCCESS"):
   - Add an entry to contacted.json:
     {
       "domain": "company.com",
       "name": "Company Name",
       "contactedAt": "ISO timestamp",
       "runId": "<run-id>"
     }
4. Write the updated array back to <storage>/contacted.json
5. Companies with status "FAILED" should NOT be added (they can be retried in future runs)

When all tasks complete, summarize results:
- Number of companies processed
- Total contacts found
- Total drafts generated

Use your built-in file system tools to read/write artifacts.`;

export interface OrchestratorConfig {
  model: BaseLanguageModel;
  tools: StructuredTool[];
  checkpointer: BaseCheckpointSaver;
  projectRoot: string; // Physical disk path to project root (e.g., /Users/user/recruiting-agent)
  verbose?: boolean; // Show detailed tool-by-tool logging
}

// ============================================================================
// Create Orchestrator Agent
// ============================================================================

export function createRecruitingOrchestrator(config: OrchestratorConfig) {
  const log = logger.orchestrator;
  const { model, tools, checkpointer, projectRoot } = config;

  log.info("Creating recruiting orchestrator", { 
    projectRoot,
    toolCount: tools.length,
    toolNames: tools.map(t => t.name),
  });

  // Create subagent configurations
  // Note: File system tools (read_file, write_file, etc.) are automatically
  // provided by DeepAgents' FilesystemMiddleware - don't need explicit tools
  const subagents: SubAgent[] = SUBAGENT_DEFINITIONS.map(def => {
    const assignedTools = assignToolsToSubagent(def.name, tools);
    log.debug("Configuring subagent", { 
      name: def.name, 
      assignedTools: assignedTools.map(t => t.name),
    });
    
    // For company-flow, add middleware to enable spawning contact-personalization
    let middleware: AgentMiddleware[] = [];
    if (def.name === "company-flow") {
      const contactPersonalizationDef = SUBAGENT_DEFINITIONS.find(
        s => s.name === "contact-personalization"
      );
      if (contactPersonalizationDef) {
        log.debug("Adding SubAgentMiddleware to company-flow for contact-personalization");
        
        // Create filesystem backend factory that returns the same FilesystemBackend
        // This ensures nested subagents can write to the same workspace
        const filesystemBackend = () => new FilesystemBackend({ 
          rootDir: projectRoot,
          virtualMode: false
        });
        
        middleware = [
          createSubAgentMiddleware({
            defaultModel: model,
            defaultMiddleware: [
              createFilesystemMiddleware({ backend: filesystemBackend }),
            ],
            subagents: [{
              name: contactPersonalizationDef.name,
              description: contactPersonalizationDef.description,
              systemPrompt: contactPersonalizationDef.systemPrompt,
              tools: assignToolsToSubagent(contactPersonalizationDef.name, tools),
              model,
            }],
            generalPurposeAgent: false, // Only expose contact-personalization
          }),
        ];
      }
    }
    
    return {
      name: def.name,
      description: def.description,
      systemPrompt: def.systemPrompt,
      tools: assignedTools,
      model, // Pass the same model to subagents to avoid default fallback
      middleware, // Add middleware array
      interruptOn: def.interruptOn || {},
    };
  });

  log.debug("Subagent configurations created", { 
    subagentNames: subagents.map(s => s.name),
  });

  // Create the deep agent with FilesystemBackend
  // Agent can access absolute OS paths
  log.debug("Creating DeepAgent with FilesystemBackend", { rootDir: projectRoot });
  const agent = createDeepAgent({
    model,
    tools, // Custom tools (web_search, hunter, etc.)
    systemPrompt: ORCHESTRATOR_PROMPT,
    checkpointer,
    backend: () => new FilesystemBackend({ 
      rootDir: projectRoot, // Physical disk path (project root)
      virtualMode: false // Allow absolute OS paths
    }),
    subagents,
    interruptOn: {
      review_companies: true, // Pause for human review after company discovery
      // Future: enable human-in-the-loop for sending
      // sendEmail: true, // Would require approval before sending
    },
  });

  log.info("Orchestrator created successfully");
  return agent;
}

// ============================================================================
// Pipeline Entry Point
// ============================================================================

export interface PipelineResult {
  success: boolean;
  runId: string;
  stats: {
    companiesCandidates: number;
    companiesSelected: number;
    companiesResearched: number;
    contactsFound: number;
    contactsVerified: number;
    draftsGenerated: number;
  };
  error?: string;
}

/**
 * Main entry point to run the complete pipeline
 */
export async function runPipeline(
  runId: string,
  profile: UserProfile,
  userPrompt: string | undefined,
  orchestratorConfig: OrchestratorConfig
): Promise<PipelineResult> {
  const log = logger.orchestrator;
  const { model, tools, checkpointer, projectRoot, verbose = false } = orchestratorConfig;
  
  log.info("Pipeline execution starting", { 
    runId,
    studentName: profile.name,
    defaultRoles: profile.defaultRoles,
    maxOutreach: profile.defaultMaxOutreachPerRun || 10,
    hasUserPrompt: !!userPrompt,
  });
  
  // Set work directory to the run directory (absolute path)
  const workDir = `${projectRoot}/runs/${runId}`;
  const storageDir = `${projectRoot}/storage`;
  log.debug("Work directory set", { workDir, storageDir });
  
  // Create orchestrator
  log.debug("Creating orchestrator agent");
  const agent = createRecruitingOrchestrator({
    model,
    tools,
    checkpointer,
    projectRoot,
  });

  const threadId = runId;
  log.debug("Thread ID assigned", { threadId });

  // Declare variables for error context tracking (before try block)
  let stepCount = 0;
  let lastApprovedCompanies: CompanyReviewItem[] | null = null;

  try {
    // Stage 0: Initialize run and save inputs
    
    log.info("Preparing initialization message for agent");

    const maxOutreach = profile.defaultMaxOutreachPerRun || 10;
    const contactsPerCompany = profile.defaultContactsPerCompany || 10;
    
    const initMessage = `
      Initialize the recruiting pipeline for run: ${runId}

      WORKSPACE DIRECTORY: ${workDir}
      STORAGE DIRECTORY: ${storageDir}
      
      Workspace files: for this run only (companies, contacts, drafts)
      Storage files: persistent across all runs (contacted companies history)
      
      Do NOT write files to /tmp/ or any other location.

      STUDENT PROFILE:
      Name: ${profile.name}
      Email: ${profile.email}
      LinkedIn: ${profile.linkedinUrl || "N/A"}
      GitHub: ${profile.githubUrl || "N/A"}
      Portfolio: ${profile.portfolioUrl || "N/A"}
      Interests: ${profile.interests?.join(", ") || "N/A"}
      Resume: ${projectRoot}/.deepreach/resume/resume.md (read this for detailed education, skills, and experience)

      DEFAULT PREFERENCES (use these as fallbacks):
      Target Roles: ${profile.defaultRoles.join(", ")}
      Target Locations: ${profile.defaultLocations?.join(", ") || "Any"}
      Target Industries: ${profile.defaultIndustries?.join(", ") || "Any"}
      Max Outreach: ${maxOutreach} companies
      Contacts Per Company: ${contactsPerCompany}
      Tone: ${profile.defaultTone || "professional"}
      
      ALWAYS EXCLUDE (never contact these): ${profile.hardExclusions?.join(", ") || "None"}

      ${userPrompt ? `
      USER'S SPECIFIC REQUEST FOR THIS RUN:
      "${userPrompt}"
      
      IMPORTANT: The user's request takes priority over defaults. Use their specific preferences
      (industries, locations, company types, etc.) for your search. Only fall back to defaults
      for things not mentioned in their request. Always enforce the exclusions above.
      ` : `
      No specific request - use the default preferences above.
      `}

      PIPELINE:
      0. Check ${storageDir}/contacted.json for previously contacted companies
      1. Find ${maxOutreach} NEW companies matching preferences (exclude contacted ones)
         - Save to ${workDir}/companies.json (single file with all companies)
      2. Process all ${maxOutreach} companies in PARALLEL using task("company-flow", ...)
         - Each company flow: research → contacts → drafts
         - Each will update its entry in companies.json with status
      3. Update ${storageDir}/contacted.json with successfully processed companies
      
      NOTE: Input configuration is already saved to ${workDir}/config.json. Do NOT save any config files.
      
      Begin with Stage 0 (Check contacted companies).
      `;

    // Invoke agent with initial setup
    log.info("Invoking agent with initial message", { 
      messageLength: initMessage.length,
      stages: 7,
    });
    
    const invokeStart = performance.now();
    
    // Start spinner for non-verbose mode
    const s = !verbose ? clack.spinner() : null;
    if (s) s.start("Finding companies...");
    
    // Simple verbose-only logging for tool calls (no progress tracking from stream)
    const logToolCall = (tc: { name: string; args?: Record<string, unknown> }) => {
      if (!verbose) return;
      const args = tc.args || {};
      let detail = tc.name;
      if (tc.name === "task" && args.agent) {
        const message = String(args.message || "");
        const companyMatch = message.match(/Process ([^(]+)/);
        detail = companyMatch ? `task → ${args.agent} [${companyMatch[1].trim()}]` : `task → ${args.agent}`;
      } else if (tc.name === "write_file" && args.path) {
        detail = `write_file(${String(args.path).split("/").pop()})`;
      } else if (tc.name === "web_search" && args.query) {
        detail = `web_search("${String(args.query).slice(0, 40)}...")`;
      }
      log.debug(detail);
    };
    
    // Helper to display companies and get user decision
    const promptUserForReview = async (companies: CompanyReviewItem[]): Promise<{ approved: boolean; feedback?: string }> => {
      log.info("Human review triggered", { count: companies.length });
      
      // Format company list for display
      const companyLines = companies.map((c: any, i: number) => {
        const lines = [`${i + 1}. ${c.name} (${c.domain})`];
        if (c.description) lines.push(`   ${c.description}`);
        if (c.why_good_fit) lines.push(`   Fit: ${c.why_good_fit}`);
        return lines.join("\n");
      }).join("\n\n");
      
      clack.note(companyLines, `Companies (${companies.length})`);
      
      const decision = await clack.select({
        message: "What do you think?",
        options: [
          { value: "approve", label: "Approve", hint: "proceed to outreach" },
          { value: "revise", label: "Revise", hint: "give feedback for different companies" },
        ],
      });
      
      if (clack.isCancel(decision)) {
        // Treat cancel as approve to avoid breaking the pipeline flow
        log.info("User cancelled selection, treating as approve");
        clack.log.warning("Cancelled -- proceeding with current companies");
        return { approved: true };
      }
      
      if (decision === "approve") {
        log.info("User decision received", { hasFeedback: false, feedback: "(approved all)" });
        clack.log.success("Companies approved. Resuming pipeline...");
        return { approved: true };
      }
      
      // User chose revise -- ask for feedback
      const feedback = await clack.text({
        message: "What should the agent look for instead?",
        placeholder: "e.g. more early-stage, different industry, smaller teams",
      });
      
      if (clack.isCancel(feedback) || !feedback) {
        log.info("User cancelled feedback, treating as approve");
        clack.log.warning("No feedback provided -- proceeding with current companies");
        return { approved: true };
      }
      
      log.info("User decision received", { hasFeedback: true, feedback });
      clack.log.step("Feedback received. Agent will find new companies...");
      return { approved: false, feedback };
    };
    
    // ----------------------------------------------------------------
    // Helper: parse stream event tuple (handles both 2- and 3-element)
    // ----------------------------------------------------------------
    const parseStreamEvent = (event: any[]): StreamEvent | null => {
      if (event.length === 3) return { mode: event[1], chunk: event[2] };
      if (event.length === 2) return { mode: event[0], chunk: event[1] };
      return null;
    };

    // ----------------------------------------------------------------
    // Helper: extract companies from an interrupt chunk
    // ----------------------------------------------------------------
    const extractInterruptCompanies = (chunk: InterruptChunk): CompanyReviewItem[] | null => {
      if (!chunk || !("__interrupt__" in chunk)) return null;
      const data = chunk["__interrupt__"];
      if (!Array.isArray(data) || data.length === 0) return null;
      const info = data[0];
      const requests = info?.value?.actionRequests || info?.value || [];
      for (const action of Array.isArray(requests) ? requests : [requests]) {
        if (action?.name === "review_companies" && action?.args?.companies) {
          return action.args.companies;
        }
      }
      return null;
    };

    // ----------------------------------------------------------------
    // Helper: consume a stream, handling HITL interrupts
    // Returns when the stream is fully consumed.
    // ----------------------------------------------------------------
    const consumeStream = async (stream: AsyncIterable<any>): Promise<void> => {
      for await (const streamEvent of stream) {
        const parsed = parseStreamEvent(streamEvent as any[]);
        if (!parsed) continue;
        stepCount++;
        const { mode, chunk } = parsed;

        // Verbose tool call logging
        if (verbose && mode === "messages") {
          const m = chunk?.[0];
          if (m?.tool_calls?.length) {
            for (const tc of m.tool_calls) logToolCall(tc);
          }
        }

        // Check for HITL interrupt (only comes via "updates" mode)
        if (mode === "updates") {
          const companies = extractInterruptCompanies(chunk);
          if (companies && companies.length > 0) {
            if (s) s.stop("Companies discovered");

            // HITL review loop (may loop if user rejects)
            let pendingCompanies: CompanyReviewItem[] | null = companies;

            while (pendingCompanies && pendingCompanies.length > 0) {
              const { approved, feedback } = await promptUserForReview(pendingCompanies);

              const hitlResponse = approved
                ? { decisions: [{ type: "approve" }] }
                : { decisions: [{ type: "reject", message: feedback }] };

              log.debug("Sending HITL response", { hitlResponse, approved });

              // Remember approved companies for post-pipeline display
              if (approved) {
                lastApprovedCompanies = pendingCompanies;
              }

              pendingCompanies = null;

              // Show progress spinner after approval
              const resumeSpinner = !verbose ? clack.spinner() : null;
              if (approved && resumeSpinner) {
                const count = lastApprovedCompanies?.length || 0;
                resumeSpinner.start(`Processing ${count} ${count === 1 ? "company" : "companies"}...`);
              } else if (resumeSpinner) {
                resumeSpinner.start("Agent is finding new companies...");
              }

              // Resume and consume the next stream segment
              const resumeStream = await agent.stream(
                new Command({ resume: hitlResponse }),
                {
                  configurable: { thread_id: threadId },
                  recursionLimit: 200,
                  streamMode: ["messages", "updates"],
                }
              );

              for await (const resumeEvent of resumeStream) {
                const rp = parseStreamEvent(resumeEvent);
                if (!rp) continue;
                stepCount++;

                if (verbose && rp.mode === "messages") {
                  const m = rp.chunk?.[0];
                  if (m?.tool_calls?.length) {
                    for (const tc of m.tool_calls) logToolCall(tc);
                  }
                }

                if (rp.mode === "updates") {
                  const newCompanies = extractInterruptCompanies(rp.chunk);
                  if (newCompanies && newCompanies.length > 0) {
                    pendingCompanies = newCompanies;
                    log.info("New interrupt with companies for review", { count: newCompanies.length });
                    if (resumeSpinner) resumeSpinner.stop("New companies found");
                    break;
                  }
                }
              }

              // If no new interrupt, stop resume spinner
              if (!pendingCompanies && resumeSpinner) {
                resumeSpinner.stop("Done");
              }
            }

            // After HITL completes, stream is fully consumed
            return;
          }
        }
      }
    };

    // Run the main stream with interrupt handling
    const mainStream = await agent.stream(
      {
        messages: [{ role: "user", content: initMessage }],
      },
      {
        configurable: { thread_id: threadId },
        recursionLimit: 200,
        streamMode: ["messages", "updates"],
      }
    );

    await consumeStream(mainStream);

    // Stop spinner if still running (no interrupt path)
    if (s) s.stop("Done");

    const invokeDuration = Math.round(performance.now() - invokeStart);
    log.info("Agent invocation completed", { durationMs: invokeDuration, totalSteps: stepCount });

    // After completion, gather statistics
    log.debug("Gathering pipeline statistics");
    const stats = gatherPipelineStats(workDir);

    // Show per-company results read from disk (reliable, not stream-dependent)
    if (!verbose) {
      const companiesPath = join(workDir, "companies.json");
      if (existsSync(companiesPath)) {
        try {
          const companiesData = JSON.parse(readFileSync(companiesPath, "utf-8"));
          if (Array.isArray(companiesData) && companiesData.length > 0) {
            for (const c of companiesData) {
              const name = c.name || c.domain || "unknown";
              if (c.status === "SUCCESS") {
                const contacts = c.contactsFound ?? "?";
                const drafts = c.draftsGenerated ?? contacts;
                clack.log.success(`${name} -- ${contacts} contacts, ${drafts} drafts`);
              } else if (c.status === "FAILED" || c.status === "SKIPPED") {
                clack.log.warning(`${name} -- skipped`);
              } else {
                clack.log.info(`${name} -- ${c.status || "done"}`);
              }
            }
          }
        } catch {
          // companies.json may not exist or may not have per-company status -- that's fine
        }
      }

      clack.log.success(`Pipeline completed in ${Math.floor(invokeDuration / 1000)}s`);
    }
    log.info("Pipeline stats gathered", { stats });

    return {
      success: true,
      runId,
      stats,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : undefined;
    
    log.error("Pipeline execution failed", { 
      runId,
      error: errorMessage,
      stack: errorStack?.split("\n").slice(0, 5).join(" | "),
      executionContext: {
        totalSteps: stepCount,
      },
    });
    
    clack.log.error(`Pipeline failed: ${errorMessage}`);
    return {
      success: false,
      runId,
      stats: {
        companiesCandidates: 0,
        companiesSelected: 0,
        companiesResearched: 0,
        contactsFound: 0,
        contactsVerified: 0,
        draftsGenerated: 0,
      },
      error: errorMessage,
    };
  }
}

// ============================================================================
// Helper: Gather Pipeline Statistics
// ============================================================================

/**
 * Reads actual output files to gather real statistics
 */
function gatherPipelineStats(workDir: string): PipelineResult["stats"] {
  const stats: PipelineResult["stats"] = {
    companiesCandidates: 0,
    companiesSelected: 0,
    companiesResearched: 0,
    contactsFound: 0,
    contactsVerified: 0,
    draftsGenerated: 0,
  };
  
  try {
    // Read companies.json
    const companiesPath = join(workDir, "companies.json");
    if (existsSync(companiesPath)) {
      const companiesData = readFileSync(companiesPath, "utf-8");
      const companies = JSON.parse(companiesData);
      if (Array.isArray(companies)) {
        stats.companiesSelected = companies.length;
        stats.companiesResearched = companies.filter((c: any) => c.status === "SUCCESS").length;
      }
    }
    
    // Read drafts.json
    const draftsPath = join(workDir, "drafts.json");
    if (existsSync(draftsPath)) {
      const draftsData = readFileSync(draftsPath, "utf-8");
      const drafts = JSON.parse(draftsData);
      if (Array.isArray(drafts)) {
        stats.draftsGenerated = drafts.length;
        stats.contactsFound = drafts.length; // Each draft represents a contact
        stats.contactsVerified = drafts.length; // All contacts with drafts are verified
      }
    }
  } catch (error) {
    // If there's an error reading files, return zeros
    logger.orchestrator.warn("Failed to gather statistics", { 
      error: error instanceof Error ? error.message : String(error),
    });
  }
  
  return stats;
}

// ============================================================================
// Export Everything
// ============================================================================

export { SUBAGENT_DEFINITIONS, assignToolsToSubagent } from "./subagents";
export type { SubagentDefinition } from "./subagents";
