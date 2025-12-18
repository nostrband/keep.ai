import { z } from "zod";
import { tool } from "ai";
import { FileStore } from "@app/db";
import { storeFileData } from "@app/node";

export function makeSaveFileTool(fileStore: FileStore, userPath?: string) {
  return tool({
    description: `Save file data to local filesystem and database.
Accepts either plain text content, raw bytes, or base64-encoded data.
File will be stored in <userPath>/files/ with SHA256 hash as filename and added to the database.
Returns the created file record with metadata.`,
    inputSchema: z.object({
      filename: z.string().describe("Name of the file to save"),
      content: z.string().optional().describe("Plain text content (mutually exclusive with bytes/base64)"),
      bytes: z.instanceof(Uint8Array).optional().describe("Raw file bytes (mutually exclusive with content/base64)"),
      base64: z.string().optional().describe("Base64-encoded file content (mutually exclusive with content/bytes)"),
      mimeType: z.string().optional().describe("MIME type of the file (optional, will be auto-detected if not provided)"),
      summary: z.string().optional().describe("Optional summary/description of the file"),
    }).refine(
      (data) => {
        const contentFields = [data.content, data.bytes, data.base64].filter(Boolean);
        return contentFields.length === 1;
      },
      {
        message: "Exactly one of 'content', 'bytes', or 'base64' must be provided",
      }
    ),
    outputSchema: z.object({
      id: z.string().describe("Generated file ID (SHA256 hash)"),
      name: z.string().describe("Original filename"),
      path: z.string().describe("Local file path relative to files directory"),
      summary: z.string().describe("File summary"),
      upload_time: z.string().describe("Upload timestamp"),
      media_type: z.string().describe("Detected or provided MIME type"),
      size: z.number().describe("File size in bytes"),
    }),
    execute: async (input) => {
      if (!userPath) {
        throw new Error("User path not configured");
      }

      let fileBuffer: Buffer;

      // Convert input data to Buffer based on the type provided
      if (input.content !== undefined) {
        fileBuffer = Buffer.from(input.content, 'utf8');
      } else if (input.bytes !== undefined) {
        fileBuffer = Buffer.from(input.bytes);
      } else if (input.base64 !== undefined) {
        fileBuffer = Buffer.from(input.base64, 'base64');
      } else {
        throw new Error("No file content provided");
      }

      // Use the moved storeFileData function with optional parameters
      const fileRecord = await storeFileData(
        fileBuffer,
        input.filename,
        userPath,
        fileStore,
        input.mimeType,
        input.summary
      );

      return fileRecord;
    },
  });
}