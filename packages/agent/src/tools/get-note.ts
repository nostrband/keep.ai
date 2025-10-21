import { z } from "zod";
import { tool } from "ai";
import { NoteStore } from "@app/db";

export function makeGetNoteTool(noteStore: NoteStore) {
  return tool({
    description:
      "Get a specific note by its ID, including full content. Returns the complete note data.",
    inputSchema: z.object({
      noteId: z.string().describe("The ID of the note to retrieve"),
    }),
    execute: async (context) => {
      const { noteId } = context;

      try {
        // Get note from database
        const note = await noteStore.getNote(noteId);
        if (!note) {
          return {
            success: false,
            error: "Note not found",
          };
        }

        return {
          success: true,
          note: note,
        };
      } catch (error) {
        console.error("Error getting note:", error);
        return {
          success: false,
          error:
            error instanceof Error ? error.message : "Unknown error occurred",
        };
      }
    },
  });
}
