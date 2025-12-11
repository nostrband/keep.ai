import { z } from "zod";
import { tool } from "ai";
import { FileStore, type File } from "@app/db";

export function makeListFilesTool(fileStore: FileStore) {
  return tool({
    description: `List files from the database with optional pagination support.
Returns file metadata ordered by upload time (most recent first).
Use this to browse through uploaded files or get an overview of what files exist.`,
    inputSchema: z
      .object({
        limit: z
          .number()
          .int()
          .min(1)
          .max(100)
          .nullable()
          .optional()
          .default(null)
          .describe(
            "Maximum number of files to return (1-100, optional, default: 20)"
          ),
        offset: z
          .number()
          .int()
          .min(0)
          .nullable()
          .optional()
          .default(null)
          .describe(
            "Number of files to skip for pagination (optional, default: 0)"
          ),
      })
      .optional()
      .nullable(),
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
      .describe("Array of file objects"),
    execute: async (context) => {
      const { limit, offset } = context || {};

      const finalLimit = limit || 20;
      const finalOffset = offset || 0;

      const files = await fileStore.listFiles(undefined, finalLimit, finalOffset);

      return files;
    },
  });
}