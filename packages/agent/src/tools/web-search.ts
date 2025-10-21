import { z } from "zod";
import Exa from "exa-js";
import { tool } from "ai";
import { getEnv } from "../env";
import debug from "debug";

const debugWebSearch = debug("agent:web-search");

export function makeWebSearchTool() {
  return tool({
    description:
      "Search the web using Exa API and get content from relevant web pages. Returns search results with full text content. Text content is usually cached, use live: true to get up to date results for time-sensitive data (prices, latest news, etc)",
    inputSchema: z.object({
      query: z
        .string()
        .min(1)
        .describe("The search query to find relevant web content"),
      type: z
        .enum(["neural", "keyword", "auto"])
        .optional()
        .default("auto")
        .describe(
          "Search type: 'neural' for semantic search, 'keyword' for exact matches, 'auto' for best results"
        ),
      numResults: z
        .number()
        .int()
        .min(1)
        .max(20)
        .optional()
        .default(5)
        .describe("Number of search results to return (1-20, default: 5)"),
      includeDomains: z
        .array(z.string())
        .optional()
        .describe(
          "Array of domains to include in search (e.g., ['reddit.com', 'stackoverflow.com'])"
        ),
      excludeDomains: z
        .array(z.string())
        .optional()
        .describe("Array of domains to exclude from search"),
      startPublishedDate: z
        .string()
        .optional()
        .describe(
          "Start date for content published date filter (ISO format: YYYY-MM-DD)"
        ),
      endPublishedDate: z
        .string()
        .optional()
        .describe(
          "End date for content published date filter (ISO format: YYYY-MM-DD)"
        ),
      live: z
        .boolean()
        .optional()
        .default(false)
        .describe(
          "If true, ensures results are 100% up to date and not cached"
        ),
    }),
    execute: async (context) => {
      const {
        query,
        type = "auto",
        numResults = 5,
        includeDomains,
        excludeDomains,
        startPublishedDate,
        endPublishedDate,
        live = false,
      } = context;

      try {
        if (!query || typeof query !== "string") {
          throw new Error("query must be a non-empty string");
        }

        const apiKey = getEnv().EXA_API_KEY;
        if (!apiKey) {
          throw new Error("EXA_API_KEY environment variable is not set");
        }

        const exa = new Exa(apiKey);

        // Build search options
        const searchOptions: Record<string, unknown> = {
          text: true,
          type: type as "neural" | "keyword" | "auto",
          numResults: Math.max(1, Math.min(Number(numResults) || 5, 20)),
        };

        if (includeDomains && includeDomains.length > 0) {
          searchOptions.includeDomains = includeDomains;
        }

        if (excludeDomains && excludeDomains.length > 0) {
          searchOptions.excludeDomains = excludeDomains;
        }

        if (startPublishedDate) {
          searchOptions.startPublishedDate = startPublishedDate;
        }

        if (endPublishedDate) {
          searchOptions.endPublishedDate = endPublishedDate;
        }

        if (live) {
          searchOptions.livecrawl = "always";
        }

        debugWebSearch("Performing web search with options:", {
          query,
          ...searchOptions,
        });

        const result = await exa.searchAndContents(query, searchOptions);

        // Format the results for better readability
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const formattedResults = result.results.map(
          (item: any, index: number) => ({
            rank: index + 1,
            title: item.title || "",
            url: item.url || "",
            publishedDate: item.publishedDate || null,
            author: item.author || null,
            score: item.score || 0,
            text: item.text
              ? item.text.substring(0, 2000) +
                (item.text.length > 2000 ? "..." : "")
              : null,
            summary: item.text
              ? item.text.substring(0, 300) +
                (item.text.length > 300 ? "..." : "")
              : null,
          })
        );

        const searchResult = {
          success: true,
          query,
          searchType: type,
          totalResults: result.results.length,
          requestedResults: numResults,
          results: formattedResults,
          searchOptions: {
            includeDomains,
            excludeDomains,
            startPublishedDate,
            endPublishedDate,
            live,
          },
        };

        debugWebSearch("Web search completed successfully:", {
          query,
          totalResults: result.results.length,
        });

        return searchResult;
      } catch (error) {
        console.error("Error performing web search:", error);
        return {
          success: false,
          error:
            error instanceof Error ? error.message : "Unknown error occurred",
          query,
          results: [],
        };
      }
    },
  });
}
