import { z } from "zod";
import { tool } from "ai";
import { NoteStore } from "@app/db";

export function makeGetNoteTool(noteStore: NoteStore) {
  return tool({
    description:
      "Get a specific note by its ID, including full content. Returns the complete note data.",
    inputSchema: z.string().describe("The ID of the note to retrieve"),
    outputSchema: z.object({
      id: z.string().describe("Unique note identifier"),
      title: z.string().describe("Note title"),
      content: z.string().describe("Full note content"),
      tags: z.array(z.string()).describe("Array of tag strings"),
      priority: z.enum(["low", "medium", "high"]).describe("Note priority level"),
      created: z.string().describe("ISO timestamp when note was created"),
      updated: z.string().describe("ISO timestamp when note was last updated"),
    }),
    execute: async (id) => {
      if (!id) throw new Error("Param 'id' required");

      // Get note from database
      const note = await noteStore.getNote(id);
      if (!note) {
        throw new Error("Note not found");
      }

      return note;
    },
  });
}
