import { z } from "zod";
import { FileStore, type File } from "@app/db";
import { defineReadOnlyTool, Tool } from "./types";

const inputSchema = z.object({
  limit: z
    .number()
    .int()
    .min(1)
    .max(100)
    .nullable()
    .optional()
    .describe("Maximum number of files to return (1-100, optional, default: 20)"),
  offset: z
    .number()
    .int()
    .min(0)
    .nullable()
    .optional()
    .describe("Number of files to skip for pagination (optional, default: 0)"),
});

const outputSchema = z.array(
  z.object({
    id: z.string().describe("File ID"),
    name: z.string().describe("Original filename"),
    path: z.string().describe("Local file path"),
    summary: z.string().describe("File summary"),
    upload_time: z.string().describe("Upload timestamp"),
    media_type: z.string().describe("MIME type"),
    size: z.number().describe("File size in bytes"),
  })
).describe("Array of file objects");

type Input = z.infer<typeof inputSchema>;
type Output = File[];

/**
 * Create the Files.list tool.
 * This is a read-only tool - can be used outside Items.withItem().
 */
export function makeListFilesTool(fileStore: FileStore): Tool<Input, Output> {
  return defineReadOnlyTool({
    namespace: "Files",
    name: "list",
    description: `List files from the database with optional pagination support.
Returns file metadata ordered by upload time (most recent first).
Use this to browse through uploaded files or get an overview of what files exist.

ℹ️ Not a mutation - can be used outside Items.withItem().`,
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
