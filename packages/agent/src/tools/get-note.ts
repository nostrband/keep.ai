import { z } from "zod";
import { NoteStore, Note } from "@app/db";
import { defineReadOnlyTool, Tool } from "./types";

const inputSchema = z.object({
  id: z.string().describe("The ID of the note to retrieve"),
});

const outputSchema = z.object({
  id: z.string().describe("Unique note identifier"),
  title: z.string().describe("Note title"),
  content: z.string().describe("Full note content"),
  tags: z.array(z.string()).describe("Array of tag strings"),
  priority: z.enum(["low", "medium", "high"]).describe("Note priority level"),
  created: z.string().describe("ISO timestamp when note was created"),
  updated: z.string().describe("ISO timestamp when note was last updated"),
});

type Input = z.infer<typeof inputSchema>;
type Output = Note;

/**
 * Create the Memory.getNote tool.
 * This is a read-only tool - can be used outside Items.withItem().
 */
export function makeGetNoteTool(noteStore: NoteStore): Tool<Input, Output> {
  return defineReadOnlyTool({
    namespace: "Memory",
    name: "getNote",
    description: `Get a specific note by its ID, including full content. Returns the complete note data.

ℹ️ Not a mutation - can be used outside Items.withItem().`,
    inputSchema,
    outputSchema,
    execute: async (input: Input): Promise<Output> => {
      const { id } = input;
      if (!id) throw new Error("Param 'id' required");

      // Get note from database
      const note = await noteStore.getNote(id);
      if (!note) {
        throw new Error("Note not found");
      }

      return note;
    },
  }) as Tool<Input, Output>;
}
