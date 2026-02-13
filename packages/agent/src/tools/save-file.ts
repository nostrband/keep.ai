import { JSONSchema } from "../json-schema";
import { FileStore, File } from "@app/db";
import { storeFileData } from "@app/node";
import { EvalContext } from "../sandbox/sandbox";
import { LogicError, PermissionError } from "../errors";
import { defineTool, Tool } from "./types";

const inputSchema: JSONSchema = {
  type: "object",
  properties: {
    filename: {
      type: "string",
      description: "Name of the file to save",
    },
    content: {
      type: "string",
      description: "Plain text content (mutually exclusive with bytes/base64)",
    },
    bytes: {
      description: "Raw file bytes (mutually exclusive with content/base64)",
    },
    base64: {
      type: "string",
      description: "Base64-encoded file content (mutually exclusive with content/bytes)",
    },
    mimeType: {
      type: "string",
      description: "MIME type of the file (optional, will be auto-detected if not provided)",
    },
    summary: {
      type: "string",
      description: "Optional summary/description of the file",
    },
  },
  required: ["filename"],
};

const outputSchema: JSONSchema = {
  type: "object",
  properties: {
    id: { type: "string", description: "Generated file ID (SHA256 hash)" },
    name: { type: "string", description: "Original filename" },
    path: { type: "string", description: "Local file path relative to files directory" },
    summary: { type: "string", description: "File summary" },
    upload_time: { type: "string", description: "Upload timestamp" },
    media_type: { type: "string", description: "Detected or provided MIME type" },
    size: { type: "number", description: "File size in bytes" },
  },
  required: ["id", "name", "path", "summary", "upload_time", "media_type", "size"],
};

interface Input {
  filename: string;
  content?: string;
  bytes?: Uint8Array;
  base64?: string;
  mimeType?: string;
  summary?: string;
}

type Output = File;

/**
 * Create the Files.save tool.
 */
export function makeSaveFileTool(
  fileStore: FileStore,
  userPath: string | undefined,
  getContext: () => EvalContext
): Tool<Input, Output> {
  return defineTool({
    namespace: "Files",
    name: "save",
    description: `Save file data to local filesystem and database.
Accepts either plain text content, raw bytes, or base64-encoded data.
File will be stored in <userPath>/files/ with SHA256 hash as filename and added to the database.
Returns the created file record with metadata.`,
    inputSchema,
    outputSchema,
    execute: async (input: Input): Promise<Output> => {
      if (!userPath) {
        throw new PermissionError("User path not configured", { source: "Files.save" });
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
        throw new LogicError("No file content provided", { source: "Files.save" });
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

      // Create event for context tracking
      await getContext().createEvent("file_save", {
        filename: input.filename,
        size: fileBuffer.length,
        mimeType: input.mimeType || fileRecord.media_type
      });

      return fileRecord;
    },
  }) as Tool<Input, Output>;
}
