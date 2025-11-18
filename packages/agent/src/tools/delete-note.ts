import { z } from "zod";
import { tool } from "ai";
import { NoteStore } from "@app/db";

export function makeDeleteNoteTool(noteStore: NoteStore) {
  return tool({
    description:
      "Delete a note by its ID. Returns an error if the note doesn't exist.",
    inputSchema: z.string().describe("The ID of the note to delete"),
    execute: async (id) => {
      if (!id) throw new Error("Specify note id");

      // Check if note exists in database
      const note = await noteStore.getNote(id);
      if (!note) {
        throw new Error("Note not found");
      }

      // Delete the note directly from the database
      await noteStore.deleteNote(id);

      // Return void - deletion successful
    },
  });
}
