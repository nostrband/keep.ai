import { z } from "zod";
import { FileStore } from "@app/db";
import { storeFileData } from "@app/node";
import { EvalContext } from "../sandbox/sandbox";
import debug from "debug";
import { LogicError, NetworkError, PermissionError, classifyHttpError, classifyGenericError } from "../errors";
import { defineTool, Tool } from "./types";

const debugWebDownload = debug("agent:web-download");

const inputSchema = z.object({
  url: z.string().url().describe("URL of the file to download"),
  filename: z.string().optional().describe("Name to save the file as (if not provided, will try to extract from URL and payload)"),
  summary: z.string().optional().describe("Optional summary/description of the downloaded file"),
});

const outputSchema = z.object({
  id: z.string().describe("Generated file ID (SHA256 hash)"),
  name: z.string().describe("Filename"),
  path: z.string().describe("Local file path relative to files directory"),
  summary: z.string().describe("File summary"),
  upload_time: z.string().describe("Download/upload timestamp"),
  media_type: z.string().describe("Detected MIME type from response headers"),
  size: z.number().describe("File size in bytes"),
  url: z.string().describe("Original download URL"),
});

type Input = z.infer<typeof inputSchema>;
type Output = z.infer<typeof outputSchema>;

/**
 * Create the Web.download tool.
 * This is a mutation - must be called inside Items.withItem().
 */
export function makeWebDownloadTool(
  fileStore: FileStore,
  userPath: string | undefined,
  getContext: () => EvalContext
): Tool<Input, Output> {
  return defineTool({
    namespace: "Web",
    name: "download",
    description: `Download a file from a URL and save it to local filesystem and database.
Fetches the file directly from the URL (up to 10MB), detects MIME type from response headers,
and stores the file data using the same system as Files.save.
Returns the created file record with metadata.

⚠️ MUTATION - must be called inside Items.withItem().`,
    inputSchema,
    outputSchema,
    isReadOnly: () => false,
    execute: async (input) => {
      if (!userPath) {
        throw new PermissionError("User path not configured", { source: "Web.download" });
      }

      debugWebDownload("Downloading file from URL:", input.url);

      // Fetch the file with size limit
      let response: Response;
      try {
        response = await fetch(input.url, {
          method: 'GET',
          headers: {
            'User-Agent': 'KeepAI-Agent/1.0',
          },
        });
      } catch (error) {
        // Network errors (connection refused, timeout, etc.)
        throw classifyGenericError(error instanceof Error ? error : new Error(String(error)), "Web.download");
      }

      if (!response.ok) {
        throw classifyHttpError(
          response.status,
          `Failed to download file: ${response.status} ${response.statusText}`,
          { source: "Web.download" }
        );
      }

      // Check content length if provided
      const contentLength = response.headers.get('content-length');
      const MAX_SIZE = 10 * 1024 * 1024; // 10MB

      if (contentLength && parseInt(contentLength) > MAX_SIZE) {
        throw new LogicError(`File too large: ${contentLength} bytes (max: ${MAX_SIZE} bytes)`, { source: "Web.download" });
      }

      // Get MIME type from response headers
      const contentType = response.headers.get('content-type') || '';
      const mimeType = contentType.split(';')[0].trim(); // Remove any parameters like charset

      debugWebDownload("Response headers - Content-Type:", contentType, "MIME type:", mimeType);

      // Read response as array buffer with size check
      const reader = response.body?.getReader();
      if (!reader) {
        throw new NetworkError("Failed to get response reader", { source: "Web.download" });
      }

      const chunks: Uint8Array[] = [];
      let totalSize = 0;

      try {
        while (true) {
          const { done, value } = await reader.read();
          
          if (done) break;
          
          totalSize += value.length;
          if (totalSize > MAX_SIZE) {
            throw new LogicError(`File too large: ${totalSize} bytes (max: ${MAX_SIZE} bytes)`, { source: "Web.download" });
          }
          
          chunks.push(value);
        }
      } finally {
        reader.releaseLock();
      }

      // Combine chunks into single buffer
      const fileBuffer = Buffer.concat(chunks);
      
      debugWebDownload("Downloaded file size:", fileBuffer.length, "bytes");

      // Extract filename from Content-Disposition header or URL if not provided
      let filename = input.filename;
      if (!filename) {
        // Try to get filename from Content-Disposition header first
        const contentDisposition = response.headers.get('content-disposition');
        if (contentDisposition) {
          const filenameMatch = contentDisposition.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/);
          if (filenameMatch) {
            filename = filenameMatch[1];
            // Remove surrounding quotes if present
            if ((filename.startsWith('"') && filename.endsWith('"')) ||
                (filename.startsWith("'") && filename.endsWith("'"))) {
              filename = filename.slice(1, -1);
            }
            debugWebDownload("Filename from Content-Disposition:", filename);
          }
        }
        
        // Fallback to extracting from URL
        if (!filename) {
          try {
            const urlPath = new URL(input.url).pathname;
            const pathSegments = urlPath.split('/');
            filename = pathSegments[pathSegments.length - 1] || 'downloaded-file';
            debugWebDownload("Filename from URL:", filename);
            
            // If no extension and we have a mime type, try to add appropriate extension
            if (!filename.includes('.') && mimeType) {
              // Simple mime to extension mapping
              const mimeToExtMap: { [key: string]: string } = {
                'image/jpeg': '.jpg',
                'image/png': '.png',
                'image/gif': '.gif',
                'image/webp': '.webp',
                'application/pdf': '.pdf',
                'text/plain': '.txt',
                'text/html': '.html',
                'application/json': '.json',
                'application/zip': '.zip',
                'video/mp4': '.mp4',
                'audio/mpeg': '.mp3',
              };
              const ext = mimeToExtMap[mimeType];
              if (ext) {
                filename += ext;
                debugWebDownload("Added extension from MIME type:", ext);
              }
            }
          } catch (e) {
            filename = 'downloaded-file';
          }
        }
      }

      debugWebDownload("Using filename:", filename);

      // Store the file using the existing storeFileData function
      const fileRecord = await storeFileData(
        fileBuffer,
        filename,
        userPath,
        fileStore,
        mimeType || undefined, // Use detected MIME type
        input.summary
      );

      // Create event for context tracking
      await getContext().createEvent("web_download", { 
        url: input.url, 
        filename: filename,
        size: fileBuffer.length 
      });

      debugWebDownload("File download completed successfully:", {
        url: input.url,
        filename: filename,
        size: fileBuffer.length,
        mimeType: mimeType
      });

      // Return the file record with additional URL info
      return {
        ...fileRecord,
        url: input.url,
      };
    },
  }) as Tool<Input, Output>;
}