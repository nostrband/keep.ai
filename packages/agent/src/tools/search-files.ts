import { z } from "zod";
import { tool } from "ai";
import { FileStore, type File } from "@app/db";

export function makeSearchFilesTool(fileStore: FileStore) {
  return tool({
    description: `Search through files using query string.
Returns file metadata ordered by upload time (most recent first).
Searches across file id, name, path, and summary fields.`,
    inputSchema: z.object({
      query: z.string().min(1).describe("Search query string to match against file name, path, and summary"),
      limit: z
        .number()
        .int()
        .min(1)
        .max(100)
        .optional()
        .default(50)
        .describe("Maximum number of files to return (1-100, default: 50)"),
      offset: z
        .number()
        .int()
        .min(0)
        .optional()
        .default(0)
        .describe("Number of files to skip for pagination (default: 0)"),
    }),
    outputSchema: z
      .array(
        z.object({
          id: z.string().describe("File ID"),
          name: z.string().describe("Original filename"),
          path: z.string().describe("Local file path"),
          summary: z.string().describe("File summary"),
          upload_time: z.string().describe("Upload timestamp"),
          media_type: z.string().describe("MIME type"),
          size: z.number().describe("File size in bytes"),
        })
      )
      .describe("Array of file objects matching the search query"),
    execute: async (input) => {
      const { query, limit, offset } = input;

      const files = await fileStore.searchFiles(query, limit);

      // Apply offset manually since the FileStore searchFiles doesn't support it
      return files.slice(offset);
    },
  });
}