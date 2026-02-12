import { JSONSchema } from "../json-schema";
import { Exa } from "exa-js";
import { getEnv } from "../env";
import debug from "debug";
import { EvalContext } from "../sandbox/sandbox";
import { AuthError, LogicError, InternalError } from "../errors";
import { defineReadOnlyTool, Tool } from "./types";

const debugWebSearch = debug("agent:web-search");

const inputSchema: JSONSchema = {
  anyOf: [
    {
      type: "object",
      properties: {
        query: {
          type: "string",
          minLength: 1,
          description: "The search query to find relevant web content",
        },
        type: {
          enum: ["neural", "keyword", "auto"],
          default: "auto",
          description:
            "Search type: 'neural' for semantic search, 'keyword' for exact matches, 'auto' for best results",
        },
        numResults: {
          type: "integer",
          minimum: 1,
          maximum: 20,
          default: 5,
          description: "Number of search results to return (1-20, default: 5)",
        },
        includeDomains: {
          type: "array",
          items: { type: "string" },
          description:
            "Array of domains to include in search (e.g., ['reddit.com', 'stackoverflow.com'])",
        },
        excludeDomains: {
          type: "array",
          items: { type: "string" },
          description: "Array of domains to exclude from search",
        },
        startPublishedDate: {
          type: "string",
          description:
            "Start date for content published date filter (ISO format: YYYY-MM-DD)",
        },
        endPublishedDate: {
          type: "string",
          description:
            "End date for content published date filter (ISO format: YYYY-MM-DD)",
        },
        live: {
          type: "boolean",
          default: false,
          description:
            "If true, ensures results are 100% up to date and not cached",
        },
      },
      required: ["query"],
    },
    {
      type: "string",
      minLength: 1,
      description: "Search query string (shorthand for { query: string })",
    },
  ],
};

interface InputObject {
  query: string;
  type?: "neural" | "keyword" | "auto";
  numResults?: number;
  includeDomains?: string[];
  excludeDomains?: string[];
  startPublishedDate?: string;
  endPublishedDate?: string;
  live?: boolean;
}

type Input = InputObject | string;

/**
 * Create the Web.search tool.
 */
export function makeWebSearchTool(getContext: () => EvalContext): Tool<Input, unknown> {
  return defineReadOnlyTool({
    namespace: "Web",
    name: "search",
    description: `Search the web using Exa API and get content from relevant web pages. Returns search results with full text content. Text content is usually cached, use live: true to get up to date results for time-sensitive data (prices, latest news, etc).`,
    inputSchema,
    execute: async (context) => {
      let query: string;
      let type: "neural" | "keyword" | "auto" = "auto";
      let numResults: number = 5;
      let includeDomains: string[] | undefined;
      let excludeDomains: string[] | undefined;
      let startPublishedDate: string | undefined;
      let endPublishedDate: string | undefined;
      let live: boolean = false;

      if (typeof context === "string") {
        query = context;
      } else {
        ({
          query,
          type = "auto",
          numResults = 5,
          includeDomains,
          excludeDomains,
          startPublishedDate,
          endPublishedDate,
          live = false,
        } = context);
      }

      if (!query || typeof query !== "string") {
        throw new LogicError("query must be a non-empty string", { source: "Web.search" });
      }

      const apiKey = getEnv().EXA_API_KEY;
      if (!apiKey) {
        throw new AuthError("EXA_API_KEY environment variable is not set. Web search is not configured.", { source: "Web.search" });
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

      let result;
      try {
        result = await exa.search(query, searchOptions);
      } catch (error) {
        // Unclassified error from Exa SDK is an internal bug (SDK should classify)
        throw new InternalError(error instanceof Error ? error.message : String(error), { cause: error instanceof Error ? error : undefined, source: "Web.search" });
      }

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

      await getContext().createEvent("web_search", { query });

      debugWebSearch("Web search completed successfully:", {
        query,
        totalResults: result.results.length,
      });

      return searchResult;
    },
  }) as Tool<Input, unknown>;
}
