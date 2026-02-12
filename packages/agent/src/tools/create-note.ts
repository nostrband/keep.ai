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
      maxLength: 100,
      description: "Human-readable note ID, i.e. 'topics.diy' or 'user.profile'",
    },
    title: {
      type: "string",
      minLength: 1,
      maxLength: 500,
      description: "Title of the note (1-500 characters)",
    },
    content: {
      type: "string",
      minLength: 1,
      description: "Content/body of the note",
    },
    tags: {
      type: "array",
      items: { type: "string" },
      description: "Array of tags to categorize the note (optional)",
    },
    priority: {
      enum: ["low", "medium", "high"],
      description: "Priority level of the note (optional, default: low)",
    },
  },
  required: ["id", "title", "content"],
};

const outputSchema: JSONSchema = {
  type: "string",
  description: "ID of the created note",
};

interface Input {
  id: string;
  title: string;
  content: string;
  tags?: string[] | null;
  priority?: "low" | "medium" | "high" | null;
}

type Output = string;

/**
 * Create the Memory.createNote tool.
 */
export function makeCreateNoteTool(
  noteStore: NoteStore,
  getContext: () => EvalContext
): Tool<Input, Output> {
  return defineTool({
    namespace: "Memory",
    name: "createNote",
    description: `Create a new note with id, title, content, tags, and priority.
ALWAYS check if closely relevant note already exists and prefer updating existing one, only create new notes if no existing note fits or if asked explicitly by user.
Notes are useful for you (the assistant) to store project-specific information, reminders, ideas, or any other text-based content.
Tags help organize and categorize notes for easy retrieval later.
Maximum 500 notes, and title+content+tags size must not exceed 50KB.`,
    inputSchema,
    outputSchema,
    isReadOnly: () => false,
    execute: async (input: Input): Promise<Output> => {
      const { title, content, tags, priority, id } = input;

      // Validate input and create note directly
      const finalTags = tags || [];
      const finalPriority = priority || "low";
      await noteStore.validateCreateNote(title, content, finalTags);

      // Generate ID for the note
      const noteId = id || crypto.randomUUID();

      // Create the note directly in the database
      await noteStore.createNote(
        title,
        content,
        finalTags,
        finalPriority,
        noteId
      );

      await getContext().createEvent("create_note", {
        id: noteId,
        title,
      });

      return noteId;
    },
  }) as Tool<Input, Output>;
}
