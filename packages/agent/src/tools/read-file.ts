import { JSONSchema } from "../json-schema";
import { FileStore, type File } from "@app/db";
import { fileUtils } from "@app/node";
import { LogicError, PermissionError, classifyFileError } from "../errors";
import { defineReadOnlyTool, Tool } from "./types";

const inputSchema: JSONSchema = {
  type: "object",
  properties: {
    path: {
      type: "string",
      description: "File path to read - filename (without extension) will be used as ID",
    },
    length: {
      type: "integer",
      minimum: 1,
      description: "Number of bytes to read (optional, reads entire file if not specified)",
    },
    offset: {
      type: "integer",
      minimum: 0,
      description: "Byte offset to start reading from (default: 0)",
    },
  },
  required: ["path"],
};

const outputSchema: JSONSchema = {
  type: "object",
  properties: {
    info: {
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
      description: "File metadata from database",
    },
    offset: { type: "number", description: "Byte offset that was used for reading" },
    length: { type: "number", description: "Number of bytes actually read" },
    bytes: { type: "string", description: "File content as base64-encoded string" },
  },
  required: ["info", "offset", "length", "bytes"],
};

interface Input {
  path: string;
  length?: number;
  offset?: number;
}

interface Output {
  info: File;
  offset: number;
  length: number;
  bytes: string;
}

/**
 * Create the Files.read tool.
 * This is a read-only tool - can be used outside Items.withItem().
 */
export function makeReadFileTool(fileStore: FileStore, userPath?: string): Tool<Input, Output> {
  return defineReadOnlyTool({
    namespace: "Files",
    name: "read",
    description: `Read file content from local filesystem using file ID from database.
Takes a file path, extracts the filename (without extension) to use as ID to look up the file in the database.
If found, reads the actual file content from <userPath>/files/<db_file.path> and returns file info with content bytes.

ℹ️ Not a mutation - can be used outside Items.withItem().`,
    inputSchema,
    outputSchema,
    execute: async (input: Input): Promise<Output> => {
      if (!userPath) {
        throw new PermissionError("User path not configured", { source: "Files.read" });
      }

      // Extract filename without extension to use as ID
      const filename = fileUtils.basename(input.path, fileUtils.extname(input.path));

      // Get file record from database
      const fileRecord = await fileStore.getFile(filename);
      if (!fileRecord) {
        throw new LogicError(`File not found with ID: ${filename}`, { source: "Files.read" });
      }

      // Construct full path to actual file
      const fullPath = fileUtils.join(userPath, "files", fileRecord.path);

      // Check if file exists
      if (!fileUtils.existsSync(fullPath)) {
        throw new LogicError(`File not found on disk: ${fullPath}`, { source: "Files.read" });
      }

      // Read file with offset and length
      let fd: number;
      try {
        fd = fileUtils.openSync(fullPath, 'r');
      } catch (error) {
        throw classifyFileError(error as NodeJS.ErrnoException, "Files.read");
      }
      try {
        const stats = fileUtils.fstatSync(fd);
        const fileSize = stats.size;

        const startOffset = input.offset || 0;
        if (startOffset >= fileSize) {
          throw new LogicError(`Offset ${startOffset} is beyond file size ${fileSize}`, { source: "Files.read" });
        }

        const maxLength = fileSize - startOffset;
        const actualLength = input.length ? Math.min(input.length, maxLength) : maxLength;

        const buffer = fileUtils.allocBuffer(actualLength);
        const bytesRead = fileUtils.readSync(fd, buffer, 0, actualLength, startOffset);

        return {
          info: fileRecord,
          offset: startOffset,
          length: bytesRead,
          bytes: fileUtils.bufferToBase64(buffer.slice(0, bytesRead)),
        };
      } finally {
        fileUtils.closeSync(fd);
      }
    },
  }) as Tool<Input, Output>;
}
