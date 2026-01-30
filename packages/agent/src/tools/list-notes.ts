import { z } from "zod";
import { NoteStore, NoteListItem } from "@app/db";
import { defineReadOnlyTool, Tool } from "./types";

const inputSchema = z.object({
  priority: z
    .enum(["low", "medium", "high"])
    .nullable()
    .optional()
    .describe("Filter notes by priority level (optional)"),
  limit: z
    .number()
    .int()
    .min(1)
    .max(100)
    .nullable()
    .optional()
    .describe("Maximum number of notes to return (1-100, optional, default: 20)"),
  offset: z
    .number()
    .int()
    .min(0)
    .nullable()
    .optional()
    .describe("Number of notes to skip for pagination (optional, default: 0)"),
});

const outputSchema = z.array(
  z.object({
    id: z.string().describe("Unique note identifier"),
    title: z.string().describe("Note title"),
    tags: z.array(z.string()).describe("Array of tag strings"),
    priority: z.enum(["low", "medium", "high"]).describe("Note priority level"),
    created: z.string().describe("ISO timestamp when note was created"),
    updated: z.string().describe("ISO timestamp when note was last updated"),
  })
).describe("Array of note objects (metadata only, no content)");

type Input = z.infer<typeof inputSchema>;
type Output = NoteListItem[];

/**
 * Create the Memory.listNotesMetadata tool.
 * This is a read-only tool - can be used outside Items.withItem().
 */
export function makeListNotesTool(noteStore: NoteStore): Tool<Input, Output> {
  return defineReadOnlyTool({
    namespace: "Memory",
    name: "listNotesMetadata",
    description: `List notes with optional filtering by priority and pagination support.
Returns note metadata (everything except content field) ordered by updated time (most recent first).
Use this to browse through notes or get an overview of what notes exist.

ℹ️ Not a mutation - can be used outside Items.withItem().`,
    inputSchema,
    outputSchema,
    execute: async (input: Input): Promise<Output> => {
      const { priority, limit, offset } = input || {};

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

      return formattedNotes;
    },
  }) as Tool<Input, Output>;
}
