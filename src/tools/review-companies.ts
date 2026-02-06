import { tool, type StructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { logger } from "@/utils/logger";

const log = logger.tools;

/**
 * Creates a tool for human review of discovered companies.
 * This tool is used with interrupt_on to pause execution for human approval.
 */
export function createReviewCompaniesTool(): StructuredTool {
  return tool(
    async ({ companies }) => {
      // Tool returns approval status - interrupt_on handles the pause
      // After approval, the agent should proceed to Stage 2
      log.info("Companies approved by human", { count: companies.length });
      return { 
        approved: true,
        approved_companies: companies,
        instruction: `Human has APPROVED ${companies.length} company/companies for outreach. Now proceed IMMEDIATELY to Stage 2: invoke task("company-flow", ...) for EACH approved company. Do NOT stop here.`
      };
    },
    {
      name: "review_companies",
      description: "Present discovered companies for human review. After human approval, returns instruction to proceed to Stage 2 company processing.",
      schema: z.object({
        companies: z.array(z.object({
          name: z.string().describe("Company name"),
          domain: z.string().describe("Company domain"),
          description: z.string().optional().describe("Brief company description"),
          why_good_fit: z.string().optional().describe("Why this company matches preferences"),
        }))
      }),
    }
  );
}
