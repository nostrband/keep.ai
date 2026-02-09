import { JSONSchema } from "../json-schema";
import { NoteStore } from "@app/db";
import { defineReadOnlyTool, Tool } from "./types";

const inputSchema: JSONSchema = {
  type: "object",
  properties: {
    keywords: {
      type: "array",
      items: { type: "string" },
      description: "Array of keywords to search for in title and content (optional, case-insensitive)",
    },
    tags: {
      type: "array",
      items: { type: "string" },
      description: "Array of tags to filter by (optional, partial matches allowed, case-insensitive)",
    },
    regexp: {
      type: "string",
      description: "Regular expression pattern to search in title and content (optional, case-insensitive)",
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
      snippet: { type: "string", description: "Content snippet if content matched the search" },
    },
    required: ["id", "title", "tags", "priority", "created", "updated"],
  },
};

interface SearchNoteResult {
  id: string;
  title: string;
  tags: string[];
  priority: "low" | "medium" | "high";
  created: string;
  updated: string;
  snippet?: string;
}

interface Input {
  keywords?: string[] | null;
  tags?: string[] | null;
  regexp?: string | null;
}

type Output = SearchNoteResult[];

/**
 * Create the Memory.searchNotes tool.
 * This is a read-only tool - can be used outside Items.withItem().
 */
export function makeSearchNotesTool(noteStore: NoteStore): Tool<Input, Output> {
  return defineReadOnlyTool({
    namespace: "Memory",
    name: "searchNotes",
    description: `Search through notes using keywords, tags, or regular expressions.
Returns note metadata (everything except content field) but includes content snippets when content matches.
Results are ordered by updated time (most recent first).
You can combine multiple search criteria - all must match for a note to be included.

ℹ️ Not a mutation - can be used outside Items.withItem().`,
    inputSchema,
    outputSchema,
    execute: async (input: Input): Promise<Output> => {
      const { keywords, tags, regexp } = input || {};

      // Validate that at least one search criteria is provided
      if (!keywords?.length && !tags?.length && !regexp) {
        throw new Error("At least one search criteria must be provided (keywords, tags, or regexp)");
      }

      // Build query object
      const query: {
        keywords?: string[];
        tags?: string[];
        regexp?: string;
      } = {};
      if (keywords?.length) query.keywords = keywords;
      if (tags?.length) query.tags = tags;
      if (regexp) query.regexp = regexp;

      const notes = await noteStore.searchNotes(query);

      return notes.map((note) => ({
        id: note.id,
        title: note.title,
        tags: note.tags,
        priority: note.priority,
        created: note.created,
        updated: note.updated,
        snippet: note.snippet,
      }));
    },
  }) as Tool<Input, Output>;
}
