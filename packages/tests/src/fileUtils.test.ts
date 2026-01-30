import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { fileUtils, storeFileData } from "@app/node";
import type { FileStore, File } from "@app/db";

/**
 * Tests for fileUtils.ts - File storage and utility functions
 *
 * Why these tests matter:
 * - File storage is critical for user data persistence
 * - Hash calculation ensures file deduplication works correctly
 * - MIME detection affects how files are served and displayed
 */

describe("fileUtils", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "fileutils-test-"));
  });

  afterEach(() => {
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe("path utilities", () => {
    describe("basename", () => {
      it("should extract filename from path", () => {
        expect(fileUtils.basename("/path/to/file.txt")).toBe("file.txt");
        expect(fileUtils.basename("/path/to/file")).toBe("file");
        expect(fileUtils.basename("file.txt")).toBe("file.txt");
      });

      it("should remove extension when provided", () => {
        expect(fileUtils.basename("/path/to/file.txt", ".txt")).toBe("file");
        expect(fileUtils.basename("photo.jpg", ".jpg")).toBe("photo");
      });

      it("should handle paths with multiple dots", () => {
        expect(fileUtils.basename("archive.tar.gz")).toBe("archive.tar.gz");
        expect(fileUtils.basename("archive.tar.gz", ".gz")).toBe("archive.tar");
      });
    });

    describe("extname", () => {
      it("should extract extension from filename", () => {
        expect(fileUtils.extname("file.txt")).toBe(".txt");
        expect(fileUtils.extname("photo.jpg")).toBe(".jpg");
        expect(fileUtils.extname("/path/to/file.pdf")).toBe(".pdf");
      });

      it("should return empty string for files without extension", () => {
        expect(fileUtils.extname("Makefile")).toBe("");
        expect(fileUtils.extname("README")).toBe("");
      });

      it("should return last extension for multiple dots", () => {
        expect(fileUtils.extname("archive.tar.gz")).toBe(".gz");
        expect(fileUtils.extname("file.backup.txt")).toBe(".txt");
      });
    });

    describe("join", () => {
      it("should join path segments", () => {
        expect(fileUtils.join("a", "b", "c")).toBe(path.join("a", "b", "c"));
        expect(fileUtils.join("/root", "subdir", "file.txt")).toBe(
          path.join("/root", "subdir", "file.txt")
        );
      });

      it("should normalize paths", () => {
        expect(fileUtils.join("a", "..", "b")).toBe("b");
        expect(fileUtils.join("a", ".", "b")).toBe(path.join("a", "b"));
      });
    });
  });

  describe("file system utilities", () => {
    describe("existsSync", () => {
      it("should return true for existing file", () => {
        const filePath = path.join(tempDir, "exists.txt");
        fs.writeFileSync(filePath, "content");

        expect(fileUtils.existsSync(filePath)).toBe(true);
      });

      it("should return false for non-existing file", () => {
        expect(fileUtils.existsSync(path.join(tempDir, "nonexistent.txt"))).toBe(
          false
        );
      });

      it("should return true for existing directory", () => {
        expect(fileUtils.existsSync(tempDir)).toBe(true);
      });
    });

    describe("openSync, closeSync, fstatSync", () => {
      it("should open file and return file descriptor", () => {
        const filePath = path.join(tempDir, "opentest.txt");
        fs.writeFileSync(filePath, "test content");

        const fd = fileUtils.openSync(filePath, "r");
        expect(typeof fd).toBe("number");
        expect(fd).toBeGreaterThan(0);

        fileUtils.closeSync(fd);
      });

      it("should get file stats via fstatSync", () => {
        const filePath = path.join(tempDir, "stattest.txt");
        const content = "hello world";
        fs.writeFileSync(filePath, content);

        const fd = fileUtils.openSync(filePath, "r");
        try {
          const stats = fileUtils.fstatSync(fd);

          expect(stats.size).toBe(content.length);
          expect(stats.isFile()).toBe(true);
          expect(stats.isDirectory()).toBe(false);
        } finally {
          fileUtils.closeSync(fd);
        }
      });
    });

    describe("readSync and writeSync", () => {
      it("should read data from file", () => {
        const filePath = path.join(tempDir, "readtest.txt");
        const content = "test data for reading";
        fs.writeFileSync(filePath, content);

        const fd = fileUtils.openSync(filePath, "r");
        try {
          const buffer = fileUtils.allocBuffer(content.length);
          const bytesRead = fileUtils.readSync(
            fd,
            buffer,
            0,
            content.length,
            0
          );

          expect(bytesRead).toBe(content.length);
          expect(Buffer.from(buffer).toString()).toBe(content);
        } finally {
          fileUtils.closeSync(fd);
        }
      });

      it("should write data to file", () => {
        const filePath = path.join(tempDir, "writetest.txt");
        const content = "data to write";
        const buffer = new TextEncoder().encode(content);

        const fd = fileUtils.openSync(filePath, "w");
        try {
          const bytesWritten = fileUtils.writeSync(fd, buffer, 0, buffer.length);
          expect(bytesWritten).toBe(buffer.length);
        } finally {
          fileUtils.closeSync(fd);
        }

        expect(fs.readFileSync(filePath, "utf8")).toBe(content);
      });

      it("should read partial data with offset and length", () => {
        const filePath = path.join(tempDir, "partialread.txt");
        const content = "0123456789";
        fs.writeFileSync(filePath, content);

        const fd = fileUtils.openSync(filePath, "r");
        try {
          const buffer = fileUtils.allocBuffer(3);
          const bytesRead = fileUtils.readSync(fd, buffer, 0, 3, 5);

          expect(bytesRead).toBe(3);
          expect(Buffer.from(buffer).toString()).toBe("567");
        } finally {
          fileUtils.closeSync(fd);
        }
      });
    });

    describe("writeFileSync and readFileSync", () => {
      it("should write and read string content", () => {
        const filePath = path.join(tempDir, "stringfile.txt");
        const content = "Hello, World!";

        fileUtils.writeFileSync(filePath, content, "utf8");
        const result = fileUtils.readFileSync(filePath, "utf8");

        expect(result).toBe(content);
      });

      it("should write and read binary content", () => {
        const filePath = path.join(tempDir, "binaryfile.bin");
        const content = new Uint8Array([0x00, 0x01, 0x02, 0xff, 0xfe]);

        fileUtils.writeFileSync(filePath, content);
        const result = fileUtils.readFileSync(filePath);

        expect(Buffer.from(result as Buffer)).toEqual(Buffer.from(content));
      });
    });

    describe("mkdirSync", () => {
      it("should create directory", () => {
        const dirPath = path.join(tempDir, "newdir");

        fileUtils.mkdirSync(dirPath);

        expect(fs.existsSync(dirPath)).toBe(true);
        expect(fs.statSync(dirPath).isDirectory()).toBe(true);
      });

      it("should create nested directories with recursive option", () => {
        const dirPath = path.join(tempDir, "a", "b", "c");

        fileUtils.mkdirSync(dirPath, { recursive: true });

        expect(fs.existsSync(dirPath)).toBe(true);
      });
    });
  });

  describe("buffer utilities", () => {
    describe("bufferToBase64", () => {
      it("should convert buffer to base64 string", () => {
        const buffer = new Uint8Array([72, 101, 108, 108, 111]); // "Hello"

        const result = fileUtils.bufferToBase64(buffer);

        expect(result).toBe("SGVsbG8="); // Base64 of "Hello"
      });

      it("should handle empty buffer", () => {
        const buffer = new Uint8Array([]);

        const result = fileUtils.bufferToBase64(buffer);

        expect(result).toBe("");
      });

      it("should handle binary data", () => {
        const buffer = new Uint8Array([0x00, 0xff, 0x80, 0x7f]);

        const result = fileUtils.bufferToBase64(buffer);

        // Verify round-trip
        const decoded = Buffer.from(result, "base64");
        expect([...decoded]).toEqual([0x00, 0xff, 0x80, 0x7f]);
      });
    });

    describe("allocBuffer", () => {
      it("should allocate buffer of specified size", () => {
        const buffer = fileUtils.allocBuffer(100);

        expect(buffer).toBeInstanceOf(Uint8Array);
        expect(buffer.length).toBe(100);
      });

      it("should allocate zero-length buffer", () => {
        const buffer = fileUtils.allocBuffer(0);

        expect(buffer.length).toBe(0);
      });

      it("should allocate large buffer", () => {
        const buffer = fileUtils.allocBuffer(1024 * 1024); // 1MB

        expect(buffer.length).toBe(1024 * 1024);
      });
    });
  });

  describe("storeFileData", () => {
    let mockFileStore: FileStore;
    let storedFiles: Map<string, File>;

    beforeEach(() => {
      storedFiles = new Map();
      mockFileStore = {
        getFile: vi.fn(async (id: string) => storedFiles.get(id) || null),
        insertFile: vi.fn(async (file: File) => {
          storedFiles.set(file.id, file);
        }),
        updateFile: vi.fn(async (file: File) => {
          storedFiles.set(file.id, file);
        }),
      } as unknown as FileStore;
    });

    it("should store new file and calculate SHA256 hash as ID", async () => {
      const content = "test file content";
      const fileBuffer = Buffer.from(content);
      const filename = "test.txt";

      const result = await storeFileData(
        fileBuffer,
        filename,
        tempDir,
        mockFileStore
      );

      // SHA256 of "test file content"
      expect(result.id).toMatch(/^[0-9a-f]{64}$/);
      expect(result.name).toBe(filename);
      expect(result.size).toBe(content.length);
      expect(mockFileStore.insertFile).toHaveBeenCalled();
    });

    it("should create files directory if it does not exist", async () => {
      const filesDir = path.join(tempDir, "files");
      expect(fs.existsSync(filesDir)).toBe(false);

      await storeFileData(
        Buffer.from("content"),
        "file.txt",
        tempDir,
        mockFileStore
      );

      expect(fs.existsSync(filesDir)).toBe(true);
    });

    it("should write file to disk with correct extension", async () => {
      const fileBuffer = Buffer.from("hello");
      const filename = "greeting.txt";

      const result = await storeFileData(
        fileBuffer,
        filename,
        tempDir,
        mockFileStore
      );

      const expectedPath = path.join(tempDir, "files", result.path);
      expect(fs.existsSync(expectedPath)).toBe(true);
      expect(fs.readFileSync(expectedPath).toString()).toBe("hello");
      expect(result.path).toMatch(/\.txt$/);
    });

    it("should update existing file record instead of creating new", async () => {
      const content = "duplicate content";
      const fileBuffer = Buffer.from(content);

      // First store
      const first = await storeFileData(
        fileBuffer,
        "first.txt",
        tempDir,
        mockFileStore
      );

      // Store again with same content but different name
      const second = await storeFileData(
        fileBuffer,
        "second.txt",
        tempDir,
        mockFileStore
      );

      // Same hash = same ID
      expect(second.id).toBe(first.id);
      expect(second.name).toBe("second.txt");
      expect(mockFileStore.updateFile).toHaveBeenCalled();
    });

    it("should use provided MIME type", async () => {
      const fileBuffer = Buffer.from("{}");
      const filename = "data.json";
      const mimeType = "application/json";

      const result = await storeFileData(
        fileBuffer,
        filename,
        tempDir,
        mockFileStore,
        mimeType
      );

      expect(result.media_type).toBe(mimeType);
    });

    it("should auto-detect MIME type when not provided", async () => {
      // PNG magic bytes
      const pngBuffer = Buffer.from([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
        0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
      ]);
      const filename = "image.png";

      const result = await storeFileData(
        pngBuffer,
        filename,
        tempDir,
        mockFileStore
      );

      expect(result.media_type).toBe("image/png");
    });

    it("should use content-based detection even when it returns octet-stream", async () => {
      // Note: The current implementation only falls back to filename-based detection
      // when detectBufferMime returns empty string, not when it returns application/octet-stream.
      // Plain text has no magic bytes, so detectBufferMime returns application/octet-stream.
      const textBuffer = Buffer.from("plain text content");
      const filename = "readme.txt";

      const result = await storeFileData(
        textBuffer,
        filename,
        tempDir,
        mockFileStore
      );

      // Content-based detection returns application/octet-stream for text
      expect(result.media_type).toBe("application/octet-stream");
    });

    it("should use provided summary", async () => {
      const fileBuffer = Buffer.from("content");
      const summary = "This is a test file";

      const result = await storeFileData(
        fileBuffer,
        "file.txt",
        tempDir,
        mockFileStore,
        undefined,
        summary
      );

      expect(result.summary).toBe(summary);
    });

    it("should preserve existing summary when updating", async () => {
      const content = "same content";
      const fileBuffer = Buffer.from(content);
      const originalSummary = "Original summary";

      // First store with summary
      await storeFileData(
        fileBuffer,
        "first.txt",
        tempDir,
        mockFileStore,
        undefined,
        originalSummary
      );

      // Store again without summary
      const result = await storeFileData(
        fileBuffer,
        "second.txt",
        tempDir,
        mockFileStore
      );

      expect(result.summary).toBe(originalSummary);
    });

    it("should set upload_time to current timestamp", async () => {
      const before = new Date().toISOString();

      const result = await storeFileData(
        Buffer.from("content"),
        "file.txt",
        tempDir,
        mockFileStore
      );

      const after = new Date().toISOString();
      expect(result.upload_time >= before).toBe(true);
      expect(result.upload_time <= after).toBe(true);
    });

    it("should handle files without extension", async () => {
      const fileBuffer = Buffer.from("makefile content");
      const filename = "Makefile";

      const result = await storeFileData(
        fileBuffer,
        filename,
        tempDir,
        mockFileStore
      );

      // When filename has no extension and content is not detectable,
      // MIME type is application/octet-stream which maps to .bin extension
      expect(result.path).toMatch(/^[0-9a-f]{64}\.bin$/);
      expect(result.name).toBe("Makefile");
    });

    it("should derive extension from MIME type when filename has none", async () => {
      // PNG magic bytes but no extension in filename
      const pngBuffer = Buffer.from([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
        0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
      ]);

      const result = await storeFileData(
        pngBuffer,
        "screenshot",
        tempDir,
        mockFileStore
      );

      expect(result.media_type).toBe("image/png");
      expect(result.path).toMatch(/\.png$/);
    });

    it("should handle empty file", async () => {
      const emptyBuffer = Buffer.from("");
      const filename = "empty.txt";

      const result = await storeFileData(
        emptyBuffer,
        filename,
        tempDir,
        mockFileStore
      );

      expect(result.size).toBe(0);
      expect(result.id).toMatch(/^[0-9a-f]{64}$/);
    });

    it("should handle large files", async () => {
      // 1MB of data
      const largeBuffer = Buffer.alloc(1024 * 1024, "x");
      const filename = "large.bin";

      const result = await storeFileData(
        largeBuffer,
        filename,
        tempDir,
        mockFileStore
      );

      expect(result.size).toBe(1024 * 1024);
      expect(fs.existsSync(path.join(tempDir, "files", result.path))).toBe(true);
    });

    it("should produce consistent hash for same content", async () => {
      const content = "consistent content";

      const result1 = await storeFileData(
        Buffer.from(content),
        "file1.txt",
        tempDir,
        mockFileStore
      );

      // Clear stored files to simulate fresh start
      storedFiles.clear();

      const result2 = await storeFileData(
        Buffer.from(content),
        "file2.txt",
        tempDir,
        mockFileStore
      );

      expect(result1.id).toBe(result2.id);
    });
  });
});
