import { JSONSchema } from "../json-schema";
import { NoteStore, Note } from "@app/db";
import { defineReadOnlyTool, Tool } from "./types";

const inputSchema: JSONSchema = {
  type: "object",
  properties: {
    id: {
      type: "string",
      description: "The ID of the note to retrieve",
    },
  },
  required: ["id"],
};

const outputSchema: JSONSchema = {
  type: "object",
  properties: {
    id: { type: "string", description: "Unique note identifier" },
    title: { type: "string", description: "Note title" },
    content: { type: "string", description: "Full note content" },
    tags: { type: "array", items: { type: "string" }, description: "Array of tag strings" },
    priority: { enum: ["low", "medium", "high"], description: "Note priority level" },
    created: { type: "string", description: "ISO timestamp when note was created" },
    updated: { type: "string", description: "ISO timestamp when note was last updated" },
  },
  required: ["id", "title", "content", "tags", "priority", "created", "updated"],
};

interface Input {
  id: string;
}

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
