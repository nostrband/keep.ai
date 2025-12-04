import { z } from "zod";
import { tool } from "ai";
import { NoteStore } from "@app/db";
import { EvalContext } from "../sandbox/sandbox";

export function makeDeleteNoteTool(
  noteStore: NoteStore,
  getContext: () => EvalContext
) {
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

      await getContext().createEvent("delete_note", {
        id,
        title: note.title,
      });

      // Return void - deletion successful
    },
  });
}
