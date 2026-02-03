import { z } from "zod";
import { NoteStore } from "@app/db";
import { EvalContext } from "../sandbox/sandbox";
import { defineTool, Tool } from "./types";

const inputSchema = z.object({
  id: z.string().describe("The ID of the note to delete"),
});

const outputSchema = z.void().describe("No return value - deletion successful");

type Input = z.infer<typeof inputSchema>;
type Output = void;

/**
 * Create the Memory.deleteNote tool.
 * This is a mutation - must be called inside Items.withItem().
 */
export function makeDeleteNoteTool(
  noteStore: NoteStore,
  getContext: () => EvalContext
): Tool<Input, Output> {
  return defineTool({
    namespace: "Memory",
    name: "deleteNote",
    description: `Delete a note by its ID. Returns an error if the note doesn't exist.

⚠️ MUTATION - must be called inside Items.withItem().`,
    inputSchema,
    outputSchema,
    isReadOnly: () => false,
    execute: async (input: Input): Promise<Output> => {
      const { id } = input;
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
  }) as Tool<Input, Output>;
}
