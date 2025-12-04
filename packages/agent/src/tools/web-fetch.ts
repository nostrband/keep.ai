import { z } from "zod";
import { Exa } from "exa-js";
import { tool } from "ai";
import { getEnv } from "../env";
import debug from "debug";
import { EvalContext } from "../sandbox/sandbox";

const debugWebFetch = debug("agent:web-fetch");

export function makeWebFetchTool(getContext: () => EvalContext) {
  return tool({
    description:
      "Fetch content from a specific URL using Exa API. Returns the full text content of the webpage or API endpoint. Use live: true to get up-to-date content for time-sensitive data.",
    inputSchema: z.union([
      z.object({
        url: z.string().url().describe("The URL to fetch content from"),
        live: z
          .boolean()
          .optional()
          .default(true)
          .describe("If false, allows cached not up-to-date content"),
        maxCharacters: z
          .number()
          .int()
          .min(1000)
          .max(100000)
          .optional()
          .default(100000)
          .describe(
            "Maximum number of characters to fetch (1000-100000, default: 100000)"
          ),
        includeHtmlTags: z
          .boolean()
          .optional()
          .default(false)
          .describe("Whether to include HTML tags in the content"),
      }),
      z
        .string()
        .url()
        .describe("URL to fetch content from (shorthand for { url: string })"),
    ]),
    outputSchema: z.object({
      url: z.string().describe("The actual URL that was fetched"),
      title: z.string().describe("Page title"),
      author: z.string().nullable().describe("Page author if available"),
      publishedDate: z
        .string()
        .nullable()
        .describe("Published date if available"),
      text: z.string().describe("Full text content of the page"),
      textLength: z.number().describe("Length of the text content"),
      summary: z.string().nullable().describe("Brief summary of the content"),
      fetchOptions: z
        .object({
          live: z.boolean(),
          maxCharacters: z.number(),
          includeHtmlTags: z.boolean(),
        })
        .describe("Options used for fetching"),
    }),
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
        throw new Error("url must be a valid URL string");
      }

      const apiKey = getEnv().EXA_API_KEY;
      if (!apiKey) {
        throw new Error("EXA_API_KEY environment variable is not set");
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

      const result = await exa.getContents([url], contentOptions);

      if (!result.results || result.results.length === 0) {
        throw new Error("No content could be fetched from the provided URL");
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
  });
}
