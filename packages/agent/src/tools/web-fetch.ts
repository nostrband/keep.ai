import { JSONSchema } from "../json-schema";
import { Exa } from "exa-js";
import { getEnv } from "../env";
import debug from "debug";
import { EvalContext } from "../sandbox/sandbox";
import { AuthError, LogicError, NetworkError, InternalError } from "../errors";
import { defineReadOnlyTool, Tool } from "./types";

const debugWebFetch = debug("agent:web-fetch");

const inputSchema: JSONSchema = {
  anyOf: [
    {
      type: "object",
      properties: {
        url: {
          type: "string",
          format: "uri",
          description: "The URL to fetch content from",
        },
        live: {
          type: "boolean",
          default: true,
          description: "If false, allows cached not up-to-date content",
        },
        maxCharacters: {
          type: "integer",
          minimum: 1000,
          maximum: 100000,
          default: 100000,
          description:
            "Maximum number of characters to fetch (1000-100000, default: 100000)",
        },
        includeHtmlTags: {
          type: "boolean",
          default: false,
          description: "Whether to include HTML tags in the content",
        },
      },
      required: ["url"],
    },
    {
      type: "string",
      format: "uri",
      description: "URL to fetch content from (shorthand for { url: string })",
    },
  ],
};

const outputSchema: JSONSchema = {
  type: "object",
  properties: {
    url: { type: "string", description: "The actual URL that was fetched" },
    title: { type: "string", description: "Page title" },
    author: { type: "string", nullable: true, description: "Page author if available" },
    publishedDate: {
      type: "string",
      nullable: true,
      description: "Published date if available",
    },
    text: { type: "string", description: "Full text content of the page" },
    textLength: { type: "number", description: "Length of the text content" },
    summary: {
      type: "string",
      nullable: true,
      description: "Brief summary of the content",
    },
    fetchOptions: {
      type: "object",
      properties: {
        live: { type: "boolean" },
        maxCharacters: { type: "number" },
        includeHtmlTags: { type: "boolean" },
      },
      required: ["live", "maxCharacters", "includeHtmlTags"],
      description: "Options used for fetching",
    },
  },
  required: [
    "url",
    "title",
    "text",
    "textLength",
    "fetchOptions",
  ],
};

interface InputObject {
  url: string;
  live?: boolean;
  maxCharacters?: number;
  includeHtmlTags?: boolean;
}

type Input = InputObject | string;

interface Output {
  url: string;
  title: string;
  author: string | null;
  publishedDate: string | null;
  text: string;
  textLength: number;
  summary: string | null;
  fetchOptions: {
    live: boolean;
    maxCharacters: number;
    includeHtmlTags: boolean;
  };
}

/**
 * Create the Web.fetchParse tool.
 */
export function makeWebFetchTool(getContext: () => EvalContext): Tool<Input, Output> {
  return defineReadOnlyTool({
    namespace: "Web",
    name: "fetchParse",
    description: `Fetch content from a specific URL using Exa API. Returns the full text content of the webpage or API endpoint. Use live: true to get up-to-date content for time-sensitive data.`,
    inputSchema,
    outputSchema,
    execute: async (params) => {
      let url: string;
      let live: boolean = false;
      let maxCharacters: number = 100000;
      let includeHtmlTags: boolean = false;

      if (typeof params === "string") {
        url = params;
      } else {
        ({
          url,
          live = false,
          maxCharacters = 100000,
          includeHtmlTags = false,
        } = params || {});
      }

      if (!url || typeof url !== "string") {
        throw new LogicError("url must be a valid URL string", { source: "Web.fetchParse" });
      }

      const apiKey = getEnv().EXA_API_KEY;
      if (!apiKey) {
        throw new AuthError("EXA_API_KEY environment variable is not set. Web fetch is not configured.", { source: "Web.fetchParse" });
      }

      const exa = new Exa(apiKey);

      // Build content options
      const contentOptions = {
        text: {
          maxCharacters: Math.max(
            1000,
            Math.min(Number(maxCharacters) || 100000, 100000)
          ),
          includeHtmlTags,
        },
        livecrawl: live ? ("preferred" as const) : ("fallback" as const),
      };

      debugWebFetch("Fetching web content with options:", {
        url,
        ...contentOptions,
      });

      let result;
      try {
        result = await exa.getContents([url], contentOptions);
      } catch (error) {
        // Unclassified error from Exa SDK is an internal bug (SDK should classify)
        throw new InternalError(error instanceof Error ? error.message : String(error), { cause: error instanceof Error ? error : undefined, source: "Web.fetchParse" });
      }

      if (!result.results || result.results.length === 0) {
        throw new NetworkError("No content could be fetched from the provided URL", { source: "Web.fetchParse" });
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const content: any = result.results[0];

      // Format the result for better readability
      const formattedResult = {
        url: content.url || url,
        title: content.title || "",
        author: content.author || null,
        publishedDate: content.publishedDate || null,
        text: content.text || "",
        textLength: content.text ? content.text.length : 0,
        summary: content.text
          ? content.text.substring(0, 500) +
            (content.text.length > 500 ? "..." : "")
          : null,
        fetchOptions: {
          live,
          maxCharacters,
          includeHtmlTags,
        },
      };

      await getContext().createEvent("web_fetch", { url });

      debugWebFetch("Web fetch completed successfully:", {
        url,
        textLength: formattedResult.textLength,
      });

      return formattedResult;
    },
  }) as Tool<Input, Output>;
}
