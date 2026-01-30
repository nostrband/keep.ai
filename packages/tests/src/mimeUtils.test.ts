import { describe, it, expect } from "vitest";
import {
  detectBufferMime,
  detectFilenameMime,
  mimeToExt,
  detectMime,
} from "@app/node";

/**
 * Tests for mimeUtils.ts - MIME type detection utilities
 *
 * Why these tests matter:
 * - MIME type detection is critical for proper file handling
 * - Incorrect MIME types can cause security issues or file corruption
 * - Tests verify both content-based and filename-based detection work correctly
 */

describe("mimeUtils", () => {
  describe("detectBufferMime", () => {
    it("should detect PNG from magic bytes", async () => {
      // PNG magic bytes: 89 50 4E 47 0D 0A 1A 0A
      const pngBuffer = Buffer.from([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
        // Minimal IHDR chunk
        0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
      ]);

      const result = await detectBufferMime(pngBuffer);
      expect(result).toBe("image/png");
    });

    it("should detect JPEG from magic bytes", async () => {
      // JPEG magic bytes: FF D8 FF
      const jpegBuffer = Buffer.from([
        0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46,
        0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01,
      ]);

      const result = await detectBufferMime(jpegBuffer);
      expect(result).toBe("image/jpeg");
    });

    it("should detect GIF from magic bytes", async () => {
      // GIF89a magic bytes
      const gifBuffer = Buffer.from("GIF89a");

      const result = await detectBufferMime(gifBuffer);
      expect(result).toBe("image/gif");
    });

    it("should detect PDF from magic bytes", async () => {
      // PDF magic bytes: %PDF-
      const pdfBuffer = Buffer.from("%PDF-1.4");

      const result = await detectBufferMime(pdfBuffer);
      expect(result).toBe("application/pdf");
    });

    it("should detect ZIP from magic bytes", async () => {
      // ZIP magic bytes: 50 4B 03 04 (PK..)
      const zipBuffer = Buffer.from([
        0x50, 0x4b, 0x03, 0x04, 0x0a, 0x00, 0x00, 0x00,
      ]);

      const result = await detectBufferMime(zipBuffer);
      expect(result).toBe("application/zip");
    });

    it("should detect WebP from magic bytes", async () => {
      // WebP: RIFF....WEBP
      const webpBuffer = Buffer.from([
        0x52, 0x49, 0x46, 0x46, // RIFF
        0x00, 0x00, 0x00, 0x00, // size placeholder
        0x57, 0x45, 0x42, 0x50, // WEBP
        0x56, 0x50, 0x38, 0x20, // VP8 space
      ]);

      const result = await detectBufferMime(webpBuffer);
      expect(result).toBe("image/webp");
    });

    it("should return application/octet-stream for unknown binary", async () => {
      // Random bytes that don't match any known format
      const unknownBuffer = Buffer.from([0x01, 0x02, 0x03, 0x04, 0x05]);

      const result = await detectBufferMime(unknownBuffer);
      expect(result).toBe("application/octet-stream");
    });

    it("should return application/octet-stream for empty buffer", async () => {
      const emptyBuffer = Buffer.from([]);

      const result = await detectBufferMime(emptyBuffer);
      expect(result).toBe("application/octet-stream");
    });

    it("should work with Uint8Array input", async () => {
      // PNG magic bytes as Uint8Array
      const pngArray = new Uint8Array([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
        0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
      ]);

      const result = await detectBufferMime(pngArray);
      expect(result).toBe("image/png");
    });

    it("should return application/octet-stream for plain text (not detectable from bytes)", async () => {
      // Plain text doesn't have magic bytes
      const textBuffer = Buffer.from("Hello, world!");

      const result = await detectBufferMime(textBuffer);
      expect(result).toBe("application/octet-stream");
    });
  });

  describe("detectFilenameMime", () => {
    it("should detect common image types", () => {
      expect(detectFilenameMime("photo.jpg")).toBe("image/jpeg");
      expect(detectFilenameMime("photo.jpeg")).toBe("image/jpeg");
      expect(detectFilenameMime("image.png")).toBe("image/png");
      expect(detectFilenameMime("animation.gif")).toBe("image/gif");
      expect(detectFilenameMime("vector.svg")).toBe("image/svg+xml");
      expect(detectFilenameMime("photo.webp")).toBe("image/webp");
    });

    it("should detect common document types", () => {
      expect(detectFilenameMime("document.pdf")).toBe("application/pdf");
      expect(detectFilenameMime("readme.txt")).toBe("text/plain");
      expect(detectFilenameMime("data.json")).toBe("application/json");
      expect(detectFilenameMime("page.html")).toBe("text/html");
      expect(detectFilenameMime("styles.css")).toBe("text/css");
    });

    it("should detect programming language files", () => {
      // Note: mime-types library returns text/javascript for .js (both are valid)
      expect(detectFilenameMime("script.js")).toBe("text/javascript");
      expect(detectFilenameMime("app.ts")).toBe("video/mp2t"); // Note: ts is often misdetected as MPEG transport stream
      expect(detectFilenameMime("style.css")).toBe("text/css");
      // Note: mime-types library doesn't recognize .py files
      expect(detectFilenameMime("code.py")).toBe("application/octet-stream");
    });

    it("should detect audio/video types", () => {
      expect(detectFilenameMime("song.mp3")).toBe("audio/mpeg");
      expect(detectFilenameMime("video.mp4")).toBe("video/mp4");
      expect(detectFilenameMime("movie.webm")).toBe("video/webm");
      expect(detectFilenameMime("audio.wav")).toBe("audio/wav");
    });

    it("should detect archive types", () => {
      expect(detectFilenameMime("archive.zip")).toBe("application/zip");
      expect(detectFilenameMime("archive.tar")).toBe("application/x-tar");
      expect(detectFilenameMime("archive.gz")).toBe("application/gzip");
    });

    it("should be case insensitive", () => {
      expect(detectFilenameMime("PHOTO.JPG")).toBe("image/jpeg");
      expect(detectFilenameMime("Document.PDF")).toBe("application/pdf");
      expect(detectFilenameMime("IMAGE.PNG")).toBe("image/png");
    });

    it("should handle filenames with multiple dots", () => {
      expect(detectFilenameMime("my.photo.backup.jpg")).toBe("image/jpeg");
      expect(detectFilenameMime("archive.tar.gz")).toBe("application/gzip");
    });

    it("should return application/octet-stream for unknown extensions", () => {
      // Note: .xyz is a known MIME type (chemical/x-xyz for XYZ chemical files)
      // Testing with truly unknown extensions
      expect(detectFilenameMime("file.unknownext123")).toBe("application/octet-stream");
      expect(detectFilenameMime("file.qwertyuiop")).toBe("application/octet-stream");
    });

    it("should return application/octet-stream for files without extension", () => {
      expect(detectFilenameMime("Makefile")).toBe("application/octet-stream");
      expect(detectFilenameMime("README")).toBe("application/octet-stream");
    });

    it("should use fallback when provided and extension is unknown", () => {
      // Use truly unknown extensions to test fallback
      expect(detectFilenameMime("file.unknownext123", "text/plain")).toBe("text/plain");
      expect(detectFilenameMime("noext", "application/json")).toBe("application/json");
    });

    it("should not use fallback when extension is known", () => {
      expect(detectFilenameMime("photo.jpg", "text/plain")).toBe("image/jpeg");
      expect(detectFilenameMime("doc.pdf", "text/html")).toBe("application/pdf");
    });

    it("should handle paths, not just filenames", () => {
      expect(detectFilenameMime("/path/to/photo.jpg")).toBe("image/jpeg");
      expect(detectFilenameMime("./relative/path/doc.pdf")).toBe("application/pdf");
      expect(detectFilenameMime("C:\\Windows\\file.txt")).toBe("text/plain");
    });
  });

  describe("mimeToExt", () => {
    it("should convert common MIME types to extensions", () => {
      // Note: mime-types library returns "jpg" for image/jpeg (both are valid)
      expect(mimeToExt("image/jpeg")).toBe("jpg");
      expect(mimeToExt("image/png")).toBe("png");
      expect(mimeToExt("image/gif")).toBe("gif");
      expect(mimeToExt("application/pdf")).toBe("pdf");
      expect(mimeToExt("text/plain")).toBe("txt");
      expect(mimeToExt("application/json")).toBe("json");
    });

    it("should handle text types", () => {
      expect(mimeToExt("text/html")).toBe("html");
      expect(mimeToExt("text/css")).toBe("css");
      expect(mimeToExt("text/javascript")).toBe("js");
    });

    it("should handle audio/video types", () => {
      // Note: mime-types library returns "mpga" for audio/mpeg (MPEG audio generic)
      expect(mimeToExt("audio/mpeg")).toBe("mpga");
      expect(mimeToExt("video/mp4")).toBe("mp4");
      expect(mimeToExt("video/webm")).toBe("webm");
    });

    it("should handle archive types", () => {
      expect(mimeToExt("application/zip")).toBe("zip");
      expect(mimeToExt("application/gzip")).toBe("gz");
    });

    it("should return empty string for unknown MIME types", () => {
      expect(mimeToExt("application/x-unknown")).toBe("");
      expect(mimeToExt("fake/mimetype")).toBe("");
    });

    it("should return empty string for invalid input", () => {
      expect(mimeToExt("")).toBe("");
      expect(mimeToExt("notamimetype")).toBe("");
    });
  });

  describe("detectMime", () => {
    it("should prefer content-based detection over filename", async () => {
      // PNG magic bytes but wrong filename extension
      const pngBuffer = Buffer.from([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
        0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
      ]);

      const result = await detectMime(pngBuffer, "wrongname.jpg");
      expect(result).toBe("image/png");
    });

    it("should fall back to filename when content detection fails", async () => {
      // Plain text has no magic bytes
      const textBuffer = Buffer.from("Hello, world!");

      const result = await detectMime(textBuffer, "readme.txt");
      expect(result).toBe("text/plain");
    });

    it("should return application/octet-stream when both methods fail", async () => {
      const unknownBuffer = Buffer.from([0x01, 0x02, 0x03, 0x04]);

      // Use truly unknown extension
      const result = await detectMime(unknownBuffer, "file.unknownext123");
      expect(result).toBe("application/octet-stream");
    });

    it("should work without filename (content only)", async () => {
      const pngBuffer = Buffer.from([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
        0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
      ]);

      const result = await detectMime(pngBuffer);
      expect(result).toBe("image/png");
    });

    it("should return application/octet-stream for empty buffer without filename", async () => {
      const emptyBuffer = Buffer.from([]);

      const result = await detectMime(emptyBuffer);
      expect(result).toBe("application/octet-stream");
    });

    it("should handle JSON files (detectable by filename, not content)", async () => {
      const jsonBuffer = Buffer.from('{"key": "value"}');

      // JSON doesn't have magic bytes, so content detection fails
      const resultWithName = await detectMime(jsonBuffer, "data.json");
      expect(resultWithName).toBe("application/json");

      const resultWithoutName = await detectMime(jsonBuffer);
      expect(resultWithoutName).toBe("application/octet-stream");
    });

    it("should handle CSS files (detectable by filename, not content)", async () => {
      const cssBuffer = Buffer.from("body { color: red; }");

      const result = await detectMime(cssBuffer, "styles.css");
      expect(result).toBe("text/css");
    });

    it("should work with Uint8Array input", async () => {
      // PDF magic bytes as Uint8Array
      const pdfArray = new Uint8Array(
        Buffer.from("%PDF-1.4\n")
      );

      const result = await detectMime(pdfArray, "doc.pdf");
      expect(result).toBe("application/pdf");
    });
  });
});
