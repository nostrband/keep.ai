import { JSONSchema } from "../json-schema";
import { NoteStore, NoteListItem } from "@app/db";
import { defineReadOnlyTool, Tool } from "./types";

const inputSchema: JSONSchema = {
  type: "object",
  properties: {
    priority: {
      enum: ["low", "medium", "high"],
      description: "Filter notes by priority level (optional)",
    },
    limit: {
      type: "integer",
      minimum: 1,
      maximum: 100,
      description: "Maximum number of notes to return (1-100, optional, default: 20)",
    },
    offset: {
      type: "integer",
      minimum: 0,
      description: "Number of notes to skip for pagination (optional, default: 0)",
    },
  },
  required: [],
};

const outputSchema: JSONSchema = {
  type: "array",
  items: {
    type: "object",
    properties: {
      id: { type: "string", description: "Unique note identifier" },
      title: { type: "string", description: "Note title" },
      tags: { type: "array", items: { type: "string" }, description: "Array of tag strings" },
      priority: { enum: ["low", "medium", "high"], description: "Note priority level" },
      created: { type: "string", description: "ISO timestamp when note was created" },
      updated: { type: "string", description: "ISO timestamp when note was last updated" },
    },
    required: ["id", "title", "tags", "priority", "created", "updated"],
  },
  description: "Array of note objects (metadata only, no content)",
};

interface Input {
  priority?: "low" | "medium" | "high" | null;
  limit?: number | null;
  offset?: number | null;
}

type Output = NoteListItem[];

/**
 * Create the Memory.listNotesMetadata tool.
 * This is a read-only tool - can be used outside Items.withItem().
 */
export function makeListNotesTool(noteStore: NoteStore): Tool<Input, Output> {
  return defineReadOnlyTool({
    namespace: "Memory",
    name: "listNotesMetadata",
    description: `List notes with optional filtering by priority and pagination support.
Returns note metadata (everything except content field) ordered by updated time (most recent first).
Use this to browse through notes or get an overview of what notes exist.

ℹ️ Not a mutation - can be used outside Items.withItem().`,
    inputSchema,
    outputSchema,
    execute: async (input: Input): Promise<Output> => {
      const { priority, limit, offset } = input || {};

      const options: {
        priority?: "low" | "medium" | "high";
        limit?: number;
        offset?: number;
      } = {};
      if (priority) options.priority = priority;
      const finalLimit = limit || 20;
      const finalOffset = offset || 0;
      options.limit = finalLimit;
      options.offset = finalOffset;

      const notes = await noteStore.listNotes(options);

      // Convert notes to the expected format (excluding content)
      const formattedNotes = notes.map((note) => ({
        id: note.id,
        title: note.title,
        tags: note.tags,
        priority: note.priority,
        created: note.created,
        updated: note.updated,
      }));

      return formattedNotes;
    },
  }) as Tool<Input, Output>;
}
