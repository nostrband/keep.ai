import { fileTypeFromBuffer } from 'file-type';
import { lookup as mimeLookup, extension as getExtension } from 'mime-types';

/**
 * Detects MIME type from a buffer using content-based detection
 * Replaces detectBufferMime from mime-detect package
 */
export async function detectBufferMime(buffer: Buffer | Uint8Array): Promise<string> {
  const result = await fileTypeFromBuffer(buffer);
  return result?.mime || 'application/octet-stream';
}

/**
 * Detects MIME type from filename with fallback support
 * Replaces detectFilenameMime from mime-detect package
 */
export function detectFilenameMime(filename: string, fallbackMime?: string): string {
  const mime = mimeLookup(filename);
  if (mime) return mime as string;
  
  return fallbackMime || 'application/octet-stream';
}

/**
 * Converts MIME type to file extension
 * Replaces mimeToExt from mime-detect package
 */
export function mimeToExt(mimeType: string): string {
  const ext = getExtension(mimeType);
  return ext ? ext : '';
}

/**
 * Combined function for comprehensive MIME detection with both
 * content-based detection and filename fallback
 */
export async function detectMime(buffer: Buffer | Uint8Array, filename?: string): Promise<string> {
  // Try content-based detection first
  const ft = await fileTypeFromBuffer(buffer);
  if (ft?.mime) return ft.mime;

  // Fallback to filename-based detection
  if (filename) {
    const mime = mimeLookup(filename);
    if (mime) return mime as string;
  }

  return 'application/octet-stream';
}