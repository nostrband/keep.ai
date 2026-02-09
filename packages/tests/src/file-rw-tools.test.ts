import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { DBInterface, KeepDb, FileStore } from "@app/db";
import { createDBNode, storeFileData } from "@app/node";
import { makeReadFileTool, makeSaveFileTool, type EvalContext } from "@app/agent";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

function createMockContext(): EvalContext {
  return {
    taskThreadId: "test-thread",
    step: 0,
    type: "workflow",
    taskId: "test-task",
    cost: 0,
    createEvent: vi.fn().mockResolvedValue(undefined),
    onLog: vi.fn().mockResolvedValue(undefined),
  };
}

async function createFilesTable(db: DBInterface): Promise<void> {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS files (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL DEFAULT '',
      path TEXT NOT NULL DEFAULT '',
      summary TEXT NOT NULL DEFAULT '',
      upload_time TEXT NOT NULL DEFAULT '',
      media_type TEXT NOT NULL DEFAULT '',
      size INTEGER NOT NULL DEFAULT 0
    )
  `);
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_files_upload_time ON files(upload_time DESC)`);
}

describe("File Read/Write Tools", () => {
  let db: DBInterface;
  let keepDb: KeepDb;
  let fileStore: FileStore;
  let tmpDir: string;
  let mockContext: EvalContext;

  beforeEach(async () => {
    db = await createDBNode(":memory:");
    keepDb = new KeepDb(db);
    await createFilesTable(db);
    fileStore = new FileStore(keepDb);
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "keepai-test-"));
    mockContext = createMockContext();
  });

  afterEach(async () => {
    if (db) await db.close();
    // Clean up temp dir
    if (tmpDir && fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  describe("Files.save (makeSaveFileTool)", () => {
    it("should save text content to file", async () => {
      const tool = makeSaveFileTool(fileStore, tmpDir, () => mockContext);

      const result = await tool.execute({
        filename: "hello.txt",
        content: "Hello, World!",
      } as any);

      expect(result.name).toBe("hello.txt");
      expect(result.size).toBe(13);
      expect(result.id).toBeTruthy();
      expect(result.path).toBeTruthy();

      // Verify file exists on disk
      const filePath = path.join(tmpDir, "files", result.path);
      expect(fs.existsSync(filePath)).toBe(true);

      // Verify file content
      const savedContent = fs.readFileSync(filePath, "utf8");
      expect(savedContent).toBe("Hello, World!");

      // Verify event was created
      expect(mockContext.createEvent).toHaveBeenCalledWith("file_save", expect.objectContaining({
        filename: "hello.txt",
        size: 13,
      }));
    });

    it("should save base64 content", async () => {
      const content = "Base64 encoded content";
      const base64 = Buffer.from(content).toString("base64");

      const tool = makeSaveFileTool(fileStore, tmpDir, () => mockContext);

      const result = await tool.execute({
        filename: "encoded.txt",
        base64,
      } as any);

      expect(result.name).toBe("encoded.txt");
      expect(result.size).toBe(content.length);

      // Verify file content
      const filePath = path.join(tmpDir, "files", result.path);
      const savedContent = fs.readFileSync(filePath, "utf8");
      expect(savedContent).toBe(content);
    });

    it("should save with custom mime type", async () => {
      const tool = makeSaveFileTool(fileStore, tmpDir, () => mockContext);

      const result = await tool.execute({
        filename: "data.json",
        content: '{"key": "value"}',
        mimeType: "application/json",
      } as any);

      expect(result.media_type).toBe("application/json");
    });

    it("should save with summary", async () => {
      const tool = makeSaveFileTool(fileStore, tmpDir, () => mockContext);

      const result = await tool.execute({
        filename: "report.txt",
        content: "Report content",
        summary: "Monthly report for January",
      } as any);

      expect(result.summary).toBe("Monthly report for January");
    });

    it("should deduplicate files by SHA256 hash", async () => {
      const tool = makeSaveFileTool(fileStore, tmpDir, () => mockContext);

      const result1 = await tool.execute({
        filename: "copy1.txt",
        content: "Identical content",
      } as any);

      const result2 = await tool.execute({
        filename: "copy2.txt",
        content: "Identical content",
      } as any);

      // Same hash for same content
      expect(result1.id).toBe(result2.id);
      // Second save updates the name
      expect(result2.name).toBe("copy2.txt");
    });

    it("should throw PermissionError when userPath is not configured", async () => {
      const tool = makeSaveFileTool(fileStore, undefined, () => mockContext);

      await expect(
        tool.execute({
          filename: "test.txt",
          content: "test",
        } as any)
      ).rejects.toThrow("User path not configured");
    });

    it("should be a mutation tool (not read-only)", () => {
      const tool = makeSaveFileTool(fileStore, tmpDir, () => mockContext);
      expect(tool.isReadOnly?.({} as any)).toBe(false);
    });
  });

  describe("Files.read (makeReadFileTool)", () => {
    async function setupTestFile(content: string, filename: string = "test.txt") {
      const fileBuffer = Buffer.from(content);
      return storeFileData(fileBuffer, filename, tmpDir, fileStore);
    }

    it("should read a saved file by path", async () => {
      const savedFile = await setupTestFile("Hello from file!", "greeting.txt");

      const tool = makeReadFileTool(fileStore, tmpDir);
      const result = await tool.execute({ path: savedFile.id + ".txt" });

      expect(result.info.id).toBe(savedFile.id);
      expect(result.info.name).toBe("greeting.txt");
      expect(result.length).toBe(16);
      expect(result.offset).toBe(0);

      // Decode base64 content
      const decoded = Buffer.from(result.bytes, "base64").toString("utf8");
      expect(decoded).toBe("Hello from file!");
    });

    it("should read file with offset", async () => {
      const savedFile = await setupTestFile("0123456789", "numbers.txt");

      const tool = makeReadFileTool(fileStore, tmpDir);
      const result = await tool.execute({ path: savedFile.id + ".txt", offset: 5 });

      expect(result.offset).toBe(5);
      expect(result.length).toBe(5);

      const decoded = Buffer.from(result.bytes, "base64").toString("utf8");
      expect(decoded).toBe("56789");
    });

    it("should read file with length limit", async () => {
      const savedFile = await setupTestFile("0123456789", "numbers.txt");

      const tool = makeReadFileTool(fileStore, tmpDir);
      const result = await tool.execute({ path: savedFile.id + ".txt", length: 3 });

      expect(result.length).toBe(3);

      const decoded = Buffer.from(result.bytes, "base64").toString("utf8");
      expect(decoded).toBe("012");
    });

    it("should read file with both offset and length", async () => {
      const savedFile = await setupTestFile("0123456789", "numbers.txt");

      const tool = makeReadFileTool(fileStore, tmpDir);
      const result = await tool.execute({ path: savedFile.id + ".txt", offset: 2, length: 4 });

      expect(result.offset).toBe(2);
      expect(result.length).toBe(4);

      const decoded = Buffer.from(result.bytes, "base64").toString("utf8");
      expect(decoded).toBe("2345");
    });

    it("should throw LogicError for non-existent file", async () => {
      const tool = makeReadFileTool(fileStore, tmpDir);

      await expect(
        tool.execute({ path: "nonexistent.txt" })
      ).rejects.toThrow("File not found with ID: nonexistent");
    });

    it("should throw LogicError when offset exceeds file size", async () => {
      const savedFile = await setupTestFile("short", "short.txt");

      const tool = makeReadFileTool(fileStore, tmpDir);

      await expect(
        tool.execute({ path: savedFile.id + ".txt", offset: 1000 })
      ).rejects.toThrow("Offset 1000 is beyond file size");
    });

    it("should throw PermissionError when userPath is not configured", async () => {
      const tool = makeReadFileTool(fileStore, undefined);

      await expect(
        tool.execute({ path: "test.txt" })
      ).rejects.toThrow("User path not configured");
    });

    it("should clamp length to available bytes", async () => {
      const savedFile = await setupTestFile("short", "short.txt");

      const tool = makeReadFileTool(fileStore, tmpDir);
      const result = await tool.execute({ path: savedFile.id + ".txt", length: 1000 });

      // Should read only available bytes (5), not 1000
      expect(result.length).toBe(5);
    });

    it("should be a read-only tool", () => {
      const tool = makeReadFileTool(fileStore, tmpDir);
      expect(tool.isReadOnly?.({} as any)).toBe(true);
    });

    it("should include full file metadata in info", async () => {
      const savedFile = await setupTestFile("test content", "doc.txt");

      const tool = makeReadFileTool(fileStore, tmpDir);
      const result = await tool.execute({ path: savedFile.id + ".txt" });

      expect(result.info.id).toBe(savedFile.id);
      expect(result.info.name).toBe("doc.txt");
      expect(result.info.size).toBe(12);
      expect(result.info.upload_time).toBeTruthy();
    });
  });
});
