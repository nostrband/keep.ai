import { JSONSchema } from "../json-schema";
import { FileStore, type File } from "@app/db";
import { defineReadOnlyTool, Tool } from "./types";

const inputSchema: JSONSchema = {
  type: "object",
  properties: {
    query: {
      type: "string",
      minLength: 1,
      description: "Search query string to match against file name, path, and summary",
    },
    limit: {
      type: "integer",
      minimum: 1,
      maximum: 100,
      description: "Maximum number of files to return (1-100, default: 50)",
    },
    offset: {
      type: "integer",
      minimum: 0,
      description: "Number of files to skip for pagination (default: 0)",
    },
  },
  required: ["query"],
};

const outputSchema: JSONSchema = {
  type: "array",
  items: {
    type: "object",
    properties: {
      id: { type: "string", description: "File ID" },
      name: { type: "string", description: "Original filename" },
      path: { type: "string", description: "Local file path" },
      summary: { type: "string", description: "File summary" },
      upload_time: { type: "string", description: "Upload timestamp" },
      media_type: { type: "string", description: "MIME type" },
      size: { type: "number", description: "File size in bytes" },
    },
    required: ["id", "name", "path", "summary", "upload_time", "media_type", "size"],
  },
  description: "Array of file objects matching the search query",
};

interface Input {
  query: string;
  limit?: number;
  offset?: number;
}

type Output = File[];

/**
 * Create the Files.search tool.
 */
export function makeSearchFilesTool(fileStore: FileStore): Tool<Input, Output> {
  return defineReadOnlyTool({
    namespace: "Files",
    name: "search",
    description: `Search through files using query string.
Returns file metadata ordered by upload time (most recent first).
Searches across file id, name, path, and summary fields.`,
    inputSchema,
    outputSchema,
    execute: async (input: Input): Promise<Output> => {
      const { query, limit = 50, offset = 0 } = input;

      const files = await fileStore.searchFiles(query, limit);

      // Apply offset manually since the FileStore searchFiles doesn't support it
      return files.slice(offset);
    },
  }) as Tool<Input, Output>;
}
