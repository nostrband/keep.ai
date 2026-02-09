import { JSONSchema } from "../json-schema";
import { NoteStore } from "@app/db";
import { EvalContext } from "../sandbox/sandbox";
import { defineTool, Tool } from "./types";

const inputSchema: JSONSchema = {
  type: "object",
  properties: {
    id: {
      type: "string",
      minLength: 1,
      description: "ID of the note to update",
    },
    title: {
      type: "string",
      minLength: 1,
      maxLength: 500,
      description: "New title for the note (1-500 characters, optional)",
    },
    content: {
      type: "string",
      minLength: 1,
      description: "New content/body for the note (optional)",
    },
    tags: {
      type: "array",
      items: { type: "string" },
      description: "New array of tags to categorize the note (optional)",
    },
    priority: {
      enum: ["low", "medium", "high"],
      description: "New priority level of the note (optional)",
    },
  },
  required: ["id"],
};

const outputSchema: JSONSchema = {
  type: "string",
  description: "ID of the updated note",
};

interface Input {
  id: string;
  title?: string | null;
  content?: string | null;
  tags?: string[] | null;
  priority?: "low" | "medium" | "high" | null;
}

type Output = string;

/**
 * Create the Memory.updateNote tool.
 * This is a mutation - must be called inside Items.withItem().
 */
export function makeUpdateNoteTool(
  noteStore: NoteStore,
  getContext: () => EvalContext
): Tool<Input, Output> {
  return defineTool({
    namespace: "Memory",
    name: "updateNote",
    description: `Update an existing note by ID. You can modify title, content, tags, and/or priority.
Only the fields you specify will be updated - other fields remain unchanged.
Title+content+tags size must not exceed 50KB after update.

⚠️ MUTATION - must be called inside Items.withItem().`,
    inputSchema,
    outputSchema,
    isReadOnly: () => false,
    execute: async (input: Input): Promise<Output> => {
      const { id, title, content, tags, priority } = input;

      // Prepare updates object
      const updates: {
        title?: string;
        content?: string;
        tags?: string[];
        priority?: "low" | "medium" | "high";
      } = {};
      if (title !== null && title !== undefined) updates.title = title;
      if (content !== null && content !== undefined) updates.content = content;
      if (tags !== null && tags !== undefined) updates.tags = tags;
      if (priority !== null && priority !== undefined) updates.priority = priority;

      if (Object.keys(updates).length === 0) {
        throw new Error(
          "No updates provided. Specify at least one field to update."
        );
      }

      // Validate against database and get existing note
      const validationResult = await noteStore.validateUpdateNote(id, updates);
      const existing = validationResult.existing;

      // Prepare updated values
      const newTitle = validationResult.newTitle;
      const newContent = validationResult.newContent;
      const newTags = validationResult.newTags;
      const newPriority = validationResult.newPriority;

      // Update the note directly in the database
      await noteStore.updateNote(
        id,
        newTitle,
        newContent,
        newTags,
        newPriority,
        existing.created
      );

      await getContext().createEvent("update_note", {
        id,
        title: newTitle,
      });

      return id;
    },
  }) as Tool<Input, Output>;
}
