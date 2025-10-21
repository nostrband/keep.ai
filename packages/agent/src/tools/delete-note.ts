import { z } from "zod";
import { tool } from "ai";
import { NoteStore } from "@app/db";

export function makeDeleteNoteTool(noteStore: NoteStore) {
  return tool({
    description:
      "Delete a note by its ID. Returns an error if the note doesn't exist.",
    inputSchema: z.object({
      noteId: z.string().describe("The ID of the note to delete"),
    }),
    execute: async (context) => {
      const { noteId } = context;

      try {
        // Check if note exists in database
        const note = await noteStore.getNote(noteId);
        if (!note) {
          return {
            success: false,
            error: "Note not found",
          };
        }

        // Delete the note directly from the database
        await noteStore.deleteNote(noteId);

        return {
          success: true,
          message: `Note with ID '${noteId}' has been deleted successfully`,
          deleted_note_id: noteId,
        };
      } catch (error) {
        console.error("Error deleting note:", error);
        return {
          success: false,
          error:
            error instanceof Error ? error.message : "Unknown error occurred",
        };
      }
    },
  });
}
