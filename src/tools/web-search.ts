import { tool, type StructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { logger } from "@/utils/logger";

const log = logger.tools;

/**
 * Creates a web search tool using Tavily.
 * Requires TAVILY_API_KEY environment variable.
 * 
 * Based on deepagents quickstart example:
 * https://docs.langchain.com/oss/javascript/deepagents/quickstart
 */
export function createWebSearchTool(): StructuredTool {
  return tool(
    async ({
      query,
      maxResults = 3,
      topic = "general",
    }: {
      query: string;
      maxResults?: number;
      topic?: "general" | "news" | "finance";
    }) => {
      const apiKey = process.env.TAVILY_API_KEY;
      if (!apiKey) {
        log.error("Web search failed - missing API key");
        return "Error: TAVILY_API_KEY environment variable not set. Cannot perform web search.";
      }
      
      log.info("Web search started", { query, maxResults, topic });
      const start = performance.now();
      
      try {
        // Dynamic import to handle missing dependency gracefully
        const { TavilySearch } = await import("@langchain/tavily");
        const tavilySearch = new TavilySearch({
          maxResults,
          tavilyApiKey: apiKey,
          topic,
          searchDepth: "basic", // Use basic search for faster results
        });
        const result = await tavilySearch._call({ query });
        const duration = Math.round(performance.now() - start);
        
        // Handle different result types
        if (!result) {
          log.warn("Web search returned empty result", { query, durationMs: duration });
          return "No results found for this search query.";
        }
        
        // Convert result to string if it's not already
        const resultStr = typeof result === 'string' ? result : JSON.stringify(result);
        
        // Count results in the response
        const resultCount = resultStr ? (resultStr.match(/\n\n/g) || []).length + 1 : 0;
        log.info("Web search completed", { 
          query, 
          resultCount,
          durationMs: duration,
        });
        
        return resultStr;
      } catch (error) {
        const duration = Math.round(performance.now() - start);
        const msg = error instanceof Error ? error.message : String(error);
        
        if (msg.includes("Cannot find package")) {
          log.error("Web search failed - package not installed", { durationMs: duration });
          return "Error: @langchain/tavily package not installed. Run: bun add @langchain/tavily";
        }
        
        log.error("Web search failed", { 
          query,
          error: msg,
          durationMs: duration,
        });
        return `Error performing web search: ${msg}`;
      }
    },
    {
      name: "web_search",
      description: "Search the web for any information - companies, people, news, backgrounds, etc. Use for both company research AND person research (e.g., finding someone's education, past roles, projects).",
      schema: z.object({
        query: z.string().describe("The search query"),
        maxResults: z.number().optional().default(3).describe("Maximum number of results (1-5, default: 3)"),
        topic: z.enum(["general", "news", "finance"]).optional().default("general").describe("Search category"),
      }),
    }
  );
}
