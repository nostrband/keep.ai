import { JSONSchema } from "../json-schema";
import { FileStore, type File } from "@app/db";
import { defineReadOnlyTool, Tool } from "./types";

const inputSchema: JSONSchema = {
  type: "object",
  properties: {
    limit: {
      type: "integer",
      minimum: 1,
      maximum: 100,
      description: "Maximum number of files to return (1-100, optional, default: 20)",
    },
    offset: {
      type: "integer",
      minimum: 0,
      description: "Number of files to skip for pagination (optional, default: 0)",
    },
  },
  required: [],
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
  description: "Array of file objects",
};

interface Input {
  limit?: number | null;
  offset?: number | null;
}

type Output = File[];

/**
 * Create the Files.list tool.
 */
export function makeListFilesTool(fileStore: FileStore): Tool<Input, Output> {
  return defineReadOnlyTool({
    namespace: "Files",
    name: "list",
    description: `List files from the database with optional pagination support.
Returns file metadata ordered by upload time (most recent first).
Use this to browse through uploaded files or get an overview of what files exist.`,
    inputSchema,
    outputSchema,
    execute: async (input: Input): Promise<Output> => {
      const { limit, offset } = input || {};

      const finalLimit = limit || 20;
      const finalOffset = offset || 0;

      const files = await fileStore.listFiles(undefined, finalLimit, finalOffset);

      return files;
    },
  }) as Tool<Input, Output>;
}
