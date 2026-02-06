import { type StructuredTool } from "@langchain/core/tools";
import { createHunterDomainSearchTool } from "./hunter";
import { createWebSearchTool } from "./web-search";
import { createReviewCompaniesTool } from "./review-companies";

export interface ToolsConfig {
  /** Max contacts to return per company from Hunter.io (1-100, default: 10) */
  contactsPerCompany?: number;
}

/**
 * Build all tools for the recruiting pipeline.
 */
export function buildTools(config: ToolsConfig = {}): StructuredTool[] {
  const { contactsPerCompany = 10 } = config;
  
  return [
    createWebSearchTool(),                              // web_search - for company research
    createHunterDomainSearchTool(contactsPerCompany),   // people_lookup - find contacts at domain
    createReviewCompaniesTool(),                         // review_companies - human-in-the-loop review
  ];
}
