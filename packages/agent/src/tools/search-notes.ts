import { z } from "zod";
import { tool } from "ai";
import { NoteStore } from "@app/db";

export function makeSearchNotesTool(noteStore: NoteStore) {
  return tool({
    description: `Search through notes using keywords, tags, or regular expressions.
Returns note metadata (everything except content field) but includes content snippets when content matches.
Results are ordered by updated time (most recent first).
You can combine multiple search criteria - all must match for a note to be included.`,
    inputSchema: z.object({
      keywords: z
        .array(z.string())
        .nullable()
        .optional()
        .describe(
          "Array of keywords to search for in title and content (optional, case-insensitive)"
        ),
      tags: z
        .array(z.string())
        .nullable()
        .optional()
        .describe(
          "Array of tags to filter by (optional, partial matches allowed, case-insensitive)"
        ),
      regexp: z
        .string()
        .nullable()
        .optional()
        .describe(
          "Regular expression pattern to search in title and content (optional, case-insensitive), will use new RegExp(regexp, 'i') in JS to match"
        ),
    }),
    execute: async (context) => {
      const { keywords, tags, regexp } = context;

      try {
        // Validate that at least one search criteria is provided
        if (!keywords?.length && !tags?.length && !regexp) {
          return {
            success: false,
            error:
              "At least one search criteria must be provided (keywords, tags, or regexp)",
            notes: [],
            total_count: 0,
          };
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

        return {
          success: true,
          notes: notes.map((note) => ({
            id: note.id,
            title: note.title,
            tags: note.tags,
            priority: note.priority,
            created: note.created,
            updated: note.updated,
            snippet: note.snippet, // Content snippet if content matched
          })),
          total_count: notes.length,
          search_criteria: {
            keywords,
            tags,
            regexp,
          },
        };
      } catch (error) {
        console.error("Error searching notes:", error);
        return {
          success: false,
          error:
            error instanceof Error ? error.message : "Unknown error occurred",
          notes: [],
          total_count: 0,
        };
      }
    },
  });
}
