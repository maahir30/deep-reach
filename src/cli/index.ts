#!/usr/bin/env node
/**
 * deepreach CLI
 *
 * Commands:
 *   init  - Interactive workspace setup
 *   run   - Run the cold-email recruiting pipeline
 *   send  - Send emails from an existing run's drafts
 */

import "dotenv/config";

import { Command } from "commander";
import { mkdir, readFile, writeFile, stat } from "fs/promises";
import { existsSync, readdirSync } from "fs";
import { join, resolve } from "path";
import { MemorySaver } from "@langchain/langgraph";
import { runPipeline } from "@/agents/orchestrator";
import { initChatModel } from "langchain/chat_models/universal";
import { UserProfileSchema, IdentitySchema, PreferencesSchema } from "@/core/schemas";
import { buildTools } from "@/tools/index";
import { logger, setLogLevel } from "@/utils/logger";
import * as clack from "@clack/prompts";
import type { UserProfile } from "@/core/types";
import type { EmailResult } from "@/services/gmail";
import type { EmailMessageDraft } from "@/core/types";
import { findWorkspaceRoot, profileDir, resumePdfPath, runsDir as getRunsDir, storageDir as getStorageDir } from "./workspace";
import { runInit } from "./init";
import { runEdit } from "./edit";

// ============================================================================
// CLI Configuration
// ============================================================================

const program = new Command();

program
  .name("deepreach")
  .description("AI-powered cold-email recruiting pipeline")
  .version("0.1.0");

// ============================================================================
// Init Command
// ============================================================================

program
  .command("init")
  .description("Interactive workspace setup (profile, resume, API keys)")
  .action(async () => {
    try {
      await runInit();
    } catch (error) {
      clack.log.error(error instanceof Error ? error.message : String(error));
      clack.outro("Exiting.");
      process.exit(1);
    }
  });

// ============================================================================
// Edit Command
// ============================================================================

program
  .command("edit")
  .description("Open a config file in your editor (profile, preferences, resume, env)")
  .argument("<target>", "File to edit: profile, preferences, resume, or env")
  .option("--dir <path>", "Explicit workspace root")
  .action(async (target: string, options: { dir?: string }) => {
    try {
      await runEdit(target, options);
    } catch (error) {
      clack.log.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

// ============================================================================
// Run Command
// ============================================================================

program
  .command("run")
  .description("Run the cold-email recruiting pipeline")
  .option(
    "--profile <path>",
    "Path to profile directory (defaults to .deepreach/ in workspace)"
  )
  .option(
    "--dir <path>",
    "Explicit workspace root (skips auto-discovery)"
  )
  .option(
    "--prompt <text>",
    "Free-response run-specific instructions (e.g., 'Focus on Series A AI startups in SF')"
  )
  .option(
    "--run-id <id>",
    "Run ID (default: auto-generated timestamp)"
  )
  .option(
    "--yes",
    "Skip confirmation prompt and run immediately",
    false
  )
  .option(
    "--dry-run",
    "Run without executing pipeline (validates inputs only)",
    false
  )
  .option(
    "--send",
    "Send emails via Gmail after drafts are generated",
    false
  )
  .option(
    "--model <name>",
    "Chat model to use, e.g. 'openai:gpt-4o', 'anthropic:claude-opus-4-6'"
  )
  .option(
    "--verbose",
    "Show detailed tool-by-tool logging",
    false
  )
  .action(async (options) => {
    try {
      await runColdEmailPipeline(options);
    } catch (error) {
      clack.log.error(error instanceof Error ? error.message : String(error));
      clack.outro("Exiting.");
      process.exit(1);
    }
  });

// ============================================================================
// Pipeline Execution
// ============================================================================

interface RunOptions {
  profile?: string;
  dir?: string;
  prompt?: string;
  runId?: string;
  model?: string;
  yes: boolean;
  dryRun: boolean;
  send: boolean;
  verbose: boolean;
}

async function runColdEmailPipeline(options: RunOptions) {
  const log = logger.cli;
  
  // Set log level based on verbose flag
  setLogLevel(options.verbose ? "debug" : "warn");
  
  // Resolve workspace root
  const root = options.dir
    ? resolve(options.dir)
    : findWorkspaceRoot();

  if (!root) {
    throw new Error(
      "No deepreach workspace found.\nRun `npx deepreach init` to set one up, or use --dir to point to one."
    );
  }

  // Load .env from workspace root (in case dotenv/config didn't find it)
  const { config: loadEnv } = await import("dotenv");
  loadEnv({ path: join(root, ".env") });

  clack.intro("deepreach v0.1.0");
  log.info("Pipeline started", { 
    workspaceRoot: root,
    dryRun: options.dryRun, 
    sendEnabled: options.send,
    hasPrompt: !!options.prompt,
    verbose: options.verbose,
  });

  // 1. Generate or use provided run ID
  const runId = options.runId || generateRunId(root);
  log.debug("Run ID generated", { runId, wasProvided: !!options.runId });

  // 2. Load and validate profile
  const profilePath = options.profile
    ? resolve(options.profile)
    : profileDir(root);
  log.debug("Resolving profile path", { profilePath });

  if (!existsSync(profilePath)) {
    log.error("Profile path not found", { path: profilePath });
    throw new Error(`Profile path not found: ${profilePath}`);
  }

  log.debug("Checking if path is directory or file");
  const pathStat = await stat(profilePath);
  let profile: UserProfile;

  if (pathStat.isDirectory()) {
    // Load from directory: profile.json + preferences.json
    log.debug("Loading from directory structure");
    const identityPath = join(profilePath, "profile.json");
    const preferencesPath = join(profilePath, "preferences.json");

    if (!existsSync(identityPath)) {
      log.error("profile.json not found in directory", { path: identityPath });
      throw new Error(`profile.json not found in: ${profilePath}`);
    }
    if (!existsSync(preferencesPath)) {
      log.error("preferences.json not found in directory", { path: preferencesPath });
      throw new Error(`preferences.json not found in: ${profilePath}`);
    }

    const identityData = JSON.parse(await readFile(identityPath, "utf-8"));
    const preferencesData = JSON.parse(await readFile(preferencesPath, "utf-8"));

    // Validate separately with friendly errors
    const identityResult = IdentitySchema.safeParse(identityData);
    if (!identityResult.success) {
      throwValidationError("profile.json", identityResult.error);
    }

    const preferencesResult = PreferencesSchema.safeParse(preferencesData);
    if (!preferencesResult.success) {
      throwValidationError("preferences.json", preferencesResult.error);
    }

    // Merge into single profile
    profile = { ...identityResult.data, ...preferencesResult.data };
    log.info("Profile loaded from directory", { 
      name: profile.name,
      email: profile.email,
      defaultRoles: profile.defaultRoles,
    });
  } else {
    // Load from single file (backward compatibility)
    log.debug("Loading from single profile file");
    const profileData = JSON.parse(await readFile(profilePath, "utf-8"));
    const profileResult = UserProfileSchema.safeParse(profileData);
    if (!profileResult.success) {
      throwValidationError("profile", profileResult.error);
    }
    profile = profileResult.data;
    log.info("Profile loaded from file", { 
      name: profile.name,
      email: profile.email,
      defaultRoles: profile.defaultRoles,
    });
  }

  // Show profile as a compact note
  clack.log.success(`Profile loaded: ${profile.name} (${profile.email})`);

  const profileLines: string[] = [];
  profileLines.push(`Roles: ${profile.defaultRoles.join(", ")}`);
  if (profile.defaultIndustries && profile.defaultIndustries.length > 0) {
    profileLines.push(`Industries: ${profile.defaultIndustries.join(", ")}`);
  }
  if (profile.defaultLocations && profile.defaultLocations.length > 0) {
    profileLines.push(`Locations: ${profile.defaultLocations.join(", ")}`);
  }
  profileLines.push(`Max outreach: ${profile.defaultMaxOutreachPerRun || 10} companies`);
  profileLines.push(`Contacts per company: ${profile.defaultContactsPerCompany || 10}`);
  profileLines.push(`Tone: ${profile.defaultTone || "professional"}`);
  if (profile.hardExclusions && profile.hardExclusions.length > 0) {
    profileLines.push(`Excluded: ${profile.hardExclusions.join(", ")}`);
  }
  clack.note(profileLines.join("\n"), "Defaults");

  // 3. Initialize model (needed for interpretation)
  const temperature = 0.7;
  const modelName = options.model
    || process.env.CHAT_MODEL
    || `anthropic:${process.env.ANTHROPIC_MODEL || "claude-opus-4-6"}`;
  log.info("Initializing model", { model: modelName, temperature });

  const model = await initChatModel(modelName, {
    temperature,
  });

  // 4. Get prompt (from flag or interactive input)
  let userPrompt = options.prompt;
  
  if (!userPrompt && !options.yes) {
    const promptResult = await clack.text({
      message: "Any preferences for this run?",
      placeholder: "e.g. Focus on Series A AI startups in SF (Enter to skip)",
    });
    
    if (clack.isCancel(promptResult)) {
      clack.outro("Run cancelled.");
      return;
    }
    
    userPrompt = promptResult || undefined;
  }

  // 5. Show config summary and get confirmation
  const summaryLines: string[] = [];
  summaryLines.push(`Run ID: ${runId}`);
  summaryLines.push(`Model: ${modelName}`);
  summaryLines.push(`Roles: ${profile.defaultRoles.join(", ")}`);
  if (profile.defaultIndustries && profile.defaultIndustries.length > 0) {
    summaryLines.push(`Industries: ${profile.defaultIndustries.join(", ")}`);
  }
  if (profile.defaultLocations && profile.defaultLocations.length > 0) {
    summaryLines.push(`Locations: ${profile.defaultLocations.join(", ")}`);
  }
  summaryLines.push(`Max outreach: ${profile.defaultMaxOutreachPerRun || 10} companies`);
  if (userPrompt) {
    summaryLines.push("");
    summaryLines.push(`Request: "${userPrompt}"`);
    summaryLines.push("(Your request takes priority; defaults fill in the rest)");
  }
  clack.note(summaryLines.join("\n"), "Run Configuration");

  if (!options.yes && !options.dryRun) {
    const confirmed = await clack.confirm({ message: "Proceed with this configuration?" });
    if (clack.isCancel(confirmed) || !confirmed) {
      log.info("Run cancelled by user");
      clack.outro("Run cancelled.");
      return;
    }
  }

  // 6. Create run folder structure
  const runDir = join(getRunsDir(root), runId);
  const storageDir = getStorageDir(root);

  log.debug("Creating directory structure", { runDir, storageDir });
  
  const directories = [
    runDir,
    join(runDir, "contacts"),
    storageDir,
  ];
  
  for (const dir of directories) {
    await mkdir(dir, { recursive: true });
    log.debug("Created directory", { path: dir });
  }

  clack.log.step(`Run directory: runs/${runId}`);
  log.info("Directory structure created", { totalDirs: directories.length });

  // 7. Save consolidated config (profile + metadata)
  const runConfig = {
    runId,
    createdAt: new Date().toISOString(),
    profilePath,
    userPrompt: userPrompt || null,
    dryRun: options.dryRun,
    sendEnabled: options.send,
    profile, // embed profile directly
  };
  
  await writeFile(
    join(runDir, "config.json"),
    JSON.stringify(runConfig, null, 2)
  );

  log.debug("Configuration saved", { path: join(runDir, "config.json") });

  if (options.dryRun) {
    log.info("Dry run mode - skipping pipeline execution");
    clack.log.success("Validation successful! (dry run)");
    clack.outro(`Run directory ready: runs/${runId}`);
    return;
  }

  // 8. Execute pipeline
  clack.log.step("Starting pipeline...");

  log.info("Starting pipeline execution", { 
    runId,
  });

  const tools = buildTools({ 
    contactsPerCompany: profile.defaultContactsPerCompany,
  });
  log.debug("Built tools", { toolNames: tools.map(t => t.name), contactsPerCompany: profile.defaultContactsPerCompany });

  const pipelineStart = performance.now();
  const result = await runPipeline(runId, profile, userPrompt, {
    model,
    tools,
    checkpointer: new MemorySaver(),
    projectRoot: root,
    verbose: options.verbose,
  });
  const pipelineDuration = Math.round(performance.now() - pipelineStart);

  // 9. Print summary
  if (result.success) {
    log.info("Pipeline completed successfully", { 
      runId,
      durationMs: pipelineDuration,
      stats: result.stats,
    });
    printSuccessSummary(runId, runDir, result.stats);
    if (options.send) {
      log.info("Starting email send process");
      await sendPendingQueue(runDir, root);
    }
  } else {
    log.error("Pipeline failed", { runId, error: result.error, durationMs: pipelineDuration });
    printFailureSummary(runId, result.error);
    process.exit(1);
  }
}

// ============================================================================
// Helpers
// ============================================================================

function throwValidationError(fileName: string, error: import("zod").ZodError): never {
  const lines = error.issues.map((issue) => {
    const path = issue.path.length > 0 ? issue.path.join(".") : "(root)";
    return `  ${path}: ${issue.message}`;
  });
  throw new Error(
    `Invalid ${fileName}:\n${lines.join("\n")}\n\nFix with: npx deepreach edit ${fileName.replace(".json", "")}`
  );
}

function generateRunId(root: string): string {
  const runsPath = getRunsDir(root);
  let maxNum = 0;

  if (existsSync(runsPath)) {
    const entries = readdirSync(runsPath, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const match = entry.name.match(/^run(\d{4})$/);
        if (match) {
          const num = parseInt(match[1], 10);
          if (num > maxNum) maxNum = num;
        }
      }
    }
  }

  const nextNum = maxNum + 1;
  return `run${nextNum.toString().padStart(4, "0")}`;
}

function printSuccessSummary(
  runId: string,
  _runDir: string,
  stats: {
    companiesCandidates: number;
    companiesSelected: number;
    companiesResearched: number;
    contactsFound: number;
    contactsVerified: number;
    draftsGenerated: number;
  }
) {
  const relDir = `runs/${runId}`;
  
  const statsLines = [
    `Companies processed: ${stats.companiesResearched}/${stats.companiesSelected}`,
    `Contacts found: ${stats.contactsFound}`,
    `Drafts generated: ${stats.draftsGenerated}`,
    "",
    `Outputs:`,
    `  ${relDir}/companies.json`,
    `  ${relDir}/contacts/`,
    `  ${relDir}/drafts.json`,
  ];
  
  clack.note(statsLines.join("\n"), "Pipeline Complete");
  
  if (!stats.draftsGenerated) {
    clack.outro("No drafts generated. Check companies.json for details.");
  } else {
    clack.outro(`Review drafts at ${relDir}/drafts.json\n\n  When ready:  npx deepreach send ${runId}`);
  }
}

function printFailureSummary(runId: string, error?: string) {
  clack.log.error(`Pipeline failed for ${runId}${error ? `: ${error}` : ""}`);
  clack.outro("Check logs for details.");
}

// ============================================================================
// Email Sending (Post-Run)
// ============================================================================

async function sendPendingQueue(runDir: string, workspaceRoot: string, opts: { skipConfirm?: boolean } = {}) {
  const log = logger.cli;
  
  // Dynamic import of Gmail service
  const { sendEmails } = await import("@/services/gmail");
  
  // Load drafts from drafts.json file
  const draftsPath = join(runDir, "drafts.json");
  
  if (!existsSync(draftsPath)) {
    clack.log.warning("No drafts.json file found. Skipping email send.");
    return;
  }

  const draftsContent = await readFile(draftsPath, "utf-8");
  const drafts = JSON.parse(draftsContent);
  
  if (!Array.isArray(drafts) || drafts.length === 0) {
    clack.log.warning("No drafts found. Skipping email send.");
    return;
  }

  const pendingDrafts = drafts.filter((d: any) => d.status === "draft");
  
  if (pendingDrafts.length === 0) {
    clack.log.warning("No pending drafts — all already sent or failed.");
    return;
  }

  // Check for resume PDF in workspace
  const resumePath = resumePdfPath(workspaceRoot);
  const hasResume = existsSync(resumePath);

  // Single status line: count + resume info
  clack.log.success(
    `Loaded ${pendingDrafts.length} pending draft${pendingDrafts.length !== 1 ? "s" : ""}` +
    (hasResume ? " (resume attached)" : " (no resume)")
  );

  // Build messages + show recipient table
  const messages: EmailMessageDraft[] = [];
  const skipped: { draftId: string; reason: string }[] = [];
  const recipientLines: string[] = [];
  
  // Calculate column widths for alignment
  const validDrafts = pendingDrafts.filter((d: any) => d.contact?.email && d.subject && d.body);
  const maxName = Math.max(...validDrafts.map((d: any) => (d.contact.name || "").length), 4);
  const maxEmail = Math.max(...validDrafts.map((d: any) => d.contact.email.length), 5);
  
  for (const draft of pendingDrafts) {
    try {
      if (!draft.contact?.email || !draft.subject || !draft.body) {
        log.warn("Skipping draft with missing fields", { draftId: draft.id });
        skipped.push({ draftId: draft.id, reason: "Missing required fields" });
        continue;
      }
      
      const message: EmailMessageDraft = {
        to: draft.contact.email,
        toName: draft.contact.name,
        subject: draft.subject,
        textBody: draft.body,
        customId: `${runDir.split("/").pop()}_${draft.id}`,
      };
      
      if (hasResume) {
        message.attachments = [{ filename: "resume.pdf", path: resumePath }];
      }
      
      messages.push(message);
      
      // Build table row
      const name = (draft.contact.name || "").padEnd(maxName + 2);
      const email = draft.contact.email.padEnd(maxEmail + 2);
      const title = draft.contact.title || "";
      recipientLines.push(`  ${name}${email}${title}`);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      log.error("Failed to prepare draft", { draftId: draft.id, error: errorMsg });
      skipped.push({ draftId: draft.id, reason: errorMsg });
    }
  }

  if (messages.length === 0) {
    clack.log.warning(`No valid drafts to send.${skipped.length > 0 ? ` Skipped ${skipped.length} due to errors.` : ""}`);
    return;
  }

  // Show recipients and ask for confirmation
  clack.note(recipientLines.join("\n"), `${messages.length} Recipients`);
  
  if (!opts.skipConfirm) {
    const confirmed = await clack.confirm({ message: `Send ${messages.length} email${messages.length !== 1 ? "s" : ""}?` });
    if (clack.isCancel(confirmed) || !confirmed) {
      clack.outro("Cancelled.");
      return;
    }
  }

  // Send with per-email progress
  const sendStart = performance.now();
  
  try {
    const results = await sendEmails(messages, (result, _idx, _total) => {
      if (result.success) {
        clack.log.success(result.email);
      } else {
        clack.log.error(`${result.email}  ${result.error || "failed"}`);
      }
    });
    
    const totalDuration = ((performance.now() - sendStart) / 1000).toFixed(1);
    
    // Update drafts.json with send results
    const timestamp = new Date().toISOString();
    const updatedDrafts = drafts.map((draft: any) => {
      const pendingIndex = pendingDrafts.findIndex((pd: any) => pd.id === draft.id);
      if (pendingIndex === -1) return draft;
      
      const result = results[pendingIndex];
      if (result.success) {
        return { ...draft, status: "sent", sentAt: timestamp, messageId: result.messageId };
      } else {
        return { ...draft, status: "failed", error: result.error || "Unknown error" };
      }
    });
    
    await writeFile(draftsPath, JSON.stringify(updatedDrafts, null, 2));
    
    // Clean outro
    const sentCount = results.filter((r: EmailResult) => r.success).length;
    const failedCount = results.filter((r: EmailResult) => !r.success).length;
    
    if (failedCount === 0) {
      clack.outro(`All ${sentCount} emails sent (${totalDuration}s)`);
    } else {
      clack.outro(`${sentCount} sent, ${failedCount} failed — check drafts.json for details`);
    }
    
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    log.error("Failed to send emails", { error: errorMsg });
    clack.log.error(`Failed to send emails: ${errorMsg}`);
    throw error;
  }
}

// ============================================================================
// Send Command (Standalone)
// ============================================================================

program
  .command("send")
  .description("Send emails from an existing run's drafts")
  .argument("<run-id>", "Run ID to send emails from (e.g., run0001)")
  .option(
    "--dir <path>",
    "Explicit workspace root (skips auto-discovery)"
  )
  .option(
    "--yes",
    "Skip confirmation prompt and send immediately",
    false
  )
  .option(
    "--verbose",
    "Show detailed logging",
    false
  )
  .action(async (runId: string, options: { dir?: string; yes: boolean; verbose: boolean }) => {
    try {
      // Suppress structured logs so they don't garble the UI
      setLogLevel(options.verbose ? "debug" : "warn");

      // Resolve workspace root
      const root = options.dir
        ? resolve(options.dir)
        : findWorkspaceRoot();

      if (!root) {
        clack.log.error(
          "No deepreach workspace found.\nRun `npx deepreach init` to set one up, or use --dir to point to one."
        );
        process.exit(1);
      }

      // Load .env from workspace root
      const { config: loadEnv } = await import("dotenv");
      loadEnv({ path: join(root, ".env") });
      
      const runDirPath = join(getRunsDir(root), runId);
      
      if (!existsSync(runDirPath)) {
        clack.log.error(`Run directory not found: runs/${runId}`);
        process.exit(1);
      }
      
      const draftsPath = join(runDirPath, "drafts.json");
      if (!existsSync(draftsPath)) {
        clack.log.error(`No drafts.json found in runs/${runId}`);
        process.exit(1);
      }
      
      clack.intro(`Send Emails - ${runId}`);
      
      await sendPendingQueue(runDirPath, root, { skipConfirm: options.yes });
    } catch (error) {
      clack.log.error(error instanceof Error ? error.message : String(error));
      clack.outro("Exiting.");
      process.exit(1);
    }
  });

// ============================================================================
// Start CLI
// ============================================================================

program.parse();
