import { z } from "zod";
import { tool } from "ai";
import { NoteStore } from "@app/db";

export function makeListNotesTool(noteStore: NoteStore) {
  return tool({
    description: `List notes with optional filtering by priority and pagination support.
Returns note metadata (everything except content field) ordered by updated time (most recent first).
Use this to browse through notes or get an overview of what notes exist.`,
    inputSchema: z.object({
      priority: z
        .enum(["low", "medium", "high"])
        .nullable()
        .optional()
        .default(null)
        .describe("Filter notes by priority level (optional)"),
      limit: z
        .number()
        .int()
        .min(1)
        .max(100)
        .nullable()
        .optional()
        .default(null)
        .describe(
          "Maximum number of notes to return (1-100, optional, default: 20)"
        ),
      offset: z
        .number()
        .int()
        .min(0)
        .nullable()
        .optional()
        .default(null)
        .describe(
          "Number of notes to skip for pagination (optional, default: 0)"
        ),
    }),
    execute: async (context) => {
      const { priority, limit, offset } = context;

      try {
        const options: {
          priority?: "low" | "medium" | "high";
          limit?: number;
          offset?: number;
        } = {};
        if (priority) options.priority = priority;
        const finalLimit = limit || 20;
        const finalOffset = offset || 0;
        options.limit = finalLimit;
        options.offset = finalOffset;

        const notes = await noteStore.listNotes(options);

        // Convert notes to the expected format (excluding content)
        const formattedNotes = notes.map((note) => ({
          id: note.id,
          title: note.title,
          tags: note.tags,
          priority: note.priority,
          created: note.created,
          updated: note.updated,
        }));

        return {
          success: true,
          notes: formattedNotes,
          total_count: formattedNotes.length,
          pagination: {
            limit: finalLimit,
            offset: finalOffset,
            has_more: formattedNotes.length === finalLimit, // Simplified check
          },
          filters: {
            priority,
          },
        };
      } catch (error) {
        console.error("Error listing notes:", error);
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
