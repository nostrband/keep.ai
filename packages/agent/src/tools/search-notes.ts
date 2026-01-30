import { z } from "zod";
import { NoteStore } from "@app/db";
import { defineReadOnlyTool, Tool } from "./types";

const inputSchema = z.object({
  keywords: z
    .array(z.string())
    .nullable()
    .optional()
    .describe("Array of keywords to search for in title and content (optional, case-insensitive)"),
  tags: z
    .array(z.string())
    .nullable()
    .optional()
    .describe("Array of tags to filter by (optional, partial matches allowed, case-insensitive)"),
  regexp: z
    .string()
    .nullable()
    .optional()
    .describe("Regular expression pattern to search in title and content (optional, case-insensitive)"),
});

const outputSchema = z.array(z.object({
  id: z.string().describe("Unique note identifier"),
  title: z.string().describe("Note title"),
  tags: z.array(z.string()).describe("Array of tag strings"),
  priority: z.enum(["low", "medium", "high"]).describe("Note priority level"),
  created: z.string().describe("ISO timestamp when note was created"),
  updated: z.string().describe("ISO timestamp when note was last updated"),
  snippet: z.string().optional().describe("Content snippet if content matched the search"),
}));

type Input = z.infer<typeof inputSchema>;
type Output = z.infer<typeof outputSchema>;

/**
 * Create the Memory.searchNotes tool.
 * This is a read-only tool - can be used outside Items.withItem().
 */
export function makeSearchNotesTool(noteStore: NoteStore): Tool<Input, Output> {
  return defineReadOnlyTool({
    namespace: "Memory",
    name: "searchNotes",
    description: `Search through notes using keywords, tags, or regular expressions.
Returns note metadata (everything except content field) but includes content snippets when content matches.
Results are ordered by updated time (most recent first).
You can combine multiple search criteria - all must match for a note to be included.

ℹ️ Not a mutation - can be used outside Items.withItem().`,
    inputSchema,
    outputSchema,
    execute: async (input: Input): Promise<Output> => {
      const { keywords, tags, regexp } = input || {};

      // Validate that at least one search criteria is provided
      if (!keywords?.length && !tags?.length && !regexp) {
        throw new Error("At least one search criteria must be provided (keywords, tags, or regexp)");
      }

      // Build query object
      const query: {
        keywords?: string[];
        tags?: string[];
        regexp?: string;
      } = {};
      if (keywords?.length) query.keywords = keywords;
      if (tags?.length) query.tags = tags;
      if (regexp) query.regexp = regexp;

      const notes = await noteStore.searchNotes(query);

      return notes.map((note) => ({
        id: note.id,
        title: note.title,
        tags: note.tags,
        priority: note.priority,
        created: note.created,
        updated: note.updated,
        snippet: note.snippet,
      }));
    },
  }) as Tool<Input, Output>;
}
