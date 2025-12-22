import fs from "fs";
import path from "path";
import { createHash } from "crypto";
import debug from "debug";
import { detectBufferMime, detectFilenameMime, mimeToExt } from "./mimeUtils";
import type { FileStore, File } from "@app/db";

const debugFileUtils = debug("fileUtils");

export interface FileStats {
  size: number;
  isFile(): boolean;
  isDirectory(): boolean;
}

export interface FileReadResult {
  bytesRead: number;
  buffer: Uint8Array;
}

export const fileUtils = {
  // Path utilities
  basename: (filePath: string, ext?: string) => path.basename(filePath, ext),
  extname: (filePath: string) => path.extname(filePath),
  join: (...paths: string[]) => path.join(...paths),
  
  // File system utilities
  existsSync: (filePath: string) => fs.existsSync(filePath),
  
  openSync: (filePath: string, flags: string) => fs.openSync(filePath, flags),
  
  closeSync: (fd: number) => fs.closeSync(fd),
  
  fstatSync: (fd: number): FileStats => {
    const stats = fs.fstatSync(fd);
    return {
      size: stats.size,
      isFile: () => stats.isFile(),
      isDirectory: () => stats.isDirectory(),
    };
  },
  
  readSync: (fd: number, buffer: Uint8Array, offset: number, length: number, position: number): number => {
    return fs.readSync(fd, buffer, offset, length, position);
  },
  
  writeSync: (fd: number, buffer: Uint8Array, offset: number, length: number, position?: number): number => {
    return fs.writeSync(fd, buffer, offset, length, position);
  },

  writeFileSync: (filePath: string, data: string | Uint8Array, encoding?: BufferEncoding) => {
    fs.writeFileSync(filePath, data, encoding);
  },

  mkdirSync: (dirPath: string, options?: fs.MakeDirectoryOptions) => {
    fs.mkdirSync(dirPath, options);
  },

  readFileSync: (filePath: string, encoding?: BufferEncoding): string | Buffer => {
    return fs.readFileSync(filePath, encoding);
  },

  // Buffer/encoding utilities
  bufferToBase64: (buffer: Uint8Array) => Buffer.from(buffer).toString('base64'),
  
  allocBuffer: (size: number) => new Uint8Array(size),
};

// Store file data to disk and database (moved from apps/server)
export async function storeFileData(
  fileBuffer: Buffer,
  filename: string,
  userPath: string,
  fileStore: FileStore,
  providedMimeType?: string,
  providedSummary?: string
): Promise<File> {
  debugFileUtils("Processing file data", filename, "size:", fileBuffer.length);

  // Calculate SHA256 hash as ID
  const hash = createHash("sha256");
  hash.update(fileBuffer);
  const fileId = hash.digest("hex");
  debugFileUtils("File hash", fileId);

  // Check if file already exists
  const existingFile = await fileStore.getFile(fileId);
  debugFileUtils("Existing file", existingFile);
  if (existingFile) {
    // Update file record
    const fileRecord: File = {
      ...existingFile,
      name: filename,
      summary: providedSummary || existingFile.summary,
      media_type: providedMimeType || existingFile.media_type,
    };

    // Insert file to database
    await fileStore.updateFile(fileRecord);

    // Return updated record
    return fileRecord;
  }

  let mediaType: string = providedMimeType || "";
  
  // Only auto-detect if no mime type was provided
  if (!mediaType) {
    try {
      // Detect media type using file-type
      mediaType = await detectBufferMime(fileBuffer);
      debugFileUtils("Mime buffer", mediaType);
    } catch (e) {
      console.error("Error in detectBufferMime", e);
    }

    // Refine using filename if result is generic
    if (!mediaType && filename && filename !== "unknown") {
      try {
        mediaType = detectFilenameMime(filename, mediaType);
      } catch (e) {
        console.error("Error in detectFilenameMime", e);
      }
      debugFileUtils("Mime filename", mediaType);
    }
  }

  // Get file extension from filename, or take from media-type
  const extensionMatch = filename.match(/\.([^.]+)$/);
  const extension = extensionMatch ? extensionMatch[1] : mimeToExt(mediaType);
  debugFileUtils(
    "Filename",
    filename,
    "extension",
    extension,
    "media type",
    mediaType
  );

  // Format file path: <userPath>/files/<id>.<extension>
  const filesDir = path.join(userPath, "files");
  debugFileUtils("Files dir", filesDir);
  if (!fs.existsSync(filesDir)) {
    fs.mkdirSync(filesDir, { recursive: true });
    debugFileUtils("Files dir created");
  }

  const fileNameLocal = `${fileId}${extension ? `.${extension}` : ""}`;
  const filePathLocal = path.join(filesDir, fileNameLocal);

  // Write file to local path
  debugFileUtils("Writing to", filePathLocal);
  fs.writeFileSync(filePathLocal, fileBuffer);
  debugFileUtils("Finished writing to", filePathLocal);

  // Create file record
  const fileRecord: File = {
    id: fileId,
    name: filename,
    path: fileNameLocal,
    size: fileBuffer.length,
    summary: providedSummary || "", // Use provided summary or empty string
    upload_time: new Date().toISOString(),
    media_type: mediaType || "",
  };

  // Insert file to database
  await fileStore.insertFile(fileRecord);

  return fileRecord;
}