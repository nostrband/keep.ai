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
    outputSchema: z.object({
      success: z.boolean().describe("Whether the operation succeeded"),
      note: z.object({
        id: z.string().describe("Unique note identifier"),
        title: z.string().describe("Note title"),
        content: z.string().describe("Full note content"),
        tags: z.array(z.string()).describe("Array of tag strings"),
        priority: z.enum(["low", "medium", "high"]).describe("Note priority level"),
        created: z.string().describe("ISO timestamp when note was created"),
        updated: z.string().describe("ISO timestamp when note was last updated"),
      }).optional().describe("Complete note object including content (only present when success is true)"),
      error: z.string().optional().describe("Error message if success is false"),
    }),
    execute: async (context) => {
      let { noteId } = context;
      if (typeof context === 'string') noteId = context;
      if (!noteId) throw new Error("Param 'noteId' required");

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
