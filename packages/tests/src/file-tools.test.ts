import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DBInterface, KeepDb, FileStore } from "@app/db";
import { createDBNode } from "@app/node";
import { makeListFilesTool, makeSearchFilesTool } from "@app/agent";

/**
 * Helper to create files table without full migration system.
 */
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

describe("File Tools", () => {
  let db: DBInterface;
  let keepDb: KeepDb;
  let fileStore: FileStore;

  beforeEach(async () => {
    db = await createDBNode(":memory:");
    keepDb = new KeepDb(db);
    await createFilesTable(db);
    fileStore = new FileStore(keepDb);
  });

  afterEach(async () => {
    if (db) await db.close();
  });

  const insertTestFile = async (overrides: Partial<{
    id: string;
    name: string;
    path: string;
    summary: string;
    upload_time: string;
    media_type: string;
    size: number;
  }> = {}) => {
    const file = {
      id: overrides.id || "file-1",
      name: overrides.name || "test.txt",
      path: overrides.path || "/data/test.txt",
      summary: overrides.summary || "A test file",
      upload_time: overrides.upload_time || "2025-01-01T00:00:00.000Z",
      media_type: overrides.media_type || "text/plain",
      size: overrides.size || 1024,
    };
    await fileStore.insertFile(file);
    return file;
  };

  describe("makeListFilesTool", () => {
    it("should list files with default pagination", async () => {
      await insertTestFile({ id: "f1", name: "file1.txt" });
      await insertTestFile({ id: "f2", name: "file2.txt" });

      const tool = makeListFilesTool(fileStore);
      const result = await tool.execute!({ limit: null, offset: null });

      expect(result).toHaveLength(2);
    });

    it("should return empty array when no files exist", async () => {
      const tool = makeListFilesTool(fileStore);
      const result = await tool.execute!({ limit: null, offset: null });

      expect(result).toHaveLength(0);
    });

    it("should respect limit parameter", async () => {
      for (let i = 0; i < 5; i++) {
        await insertTestFile({
          id: `f-${i}`,
          name: `file${i}.txt`,
          upload_time: `2025-01-0${i + 1}T00:00:00.000Z`,
        });
      }

      const tool = makeListFilesTool(fileStore);
      const result = await tool.execute!({ limit: 3, offset: null });

      expect(result).toHaveLength(3);
    });

    it("should respect offset parameter", async () => {
      for (let i = 0; i < 5; i++) {
        await insertTestFile({
          id: `f-${i}`,
          name: `file${i}.txt`,
          upload_time: `2025-01-0${i + 1}T00:00:00.000Z`,
        });
      }

      const tool = makeListFilesTool(fileStore);
      const result = await tool.execute!({ limit: 2, offset: 2 });

      expect(result).toHaveLength(2);
    });

    it("should return files ordered by upload_time descending", async () => {
      await insertTestFile({
        id: "f-old",
        name: "old.txt",
        upload_time: "2025-01-01T00:00:00.000Z",
      });
      await insertTestFile({
        id: "f-new",
        name: "new.txt",
        upload_time: "2025-06-01T00:00:00.000Z",
      });

      const tool = makeListFilesTool(fileStore);
      const result = await tool.execute!({ limit: null, offset: null });

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe("f-new");
      expect(result[1].id).toBe("f-old");
    });

    it("should include all file metadata fields", async () => {
      await insertTestFile({
        id: "f-meta",
        name: "report.pdf",
        path: "/data/report.pdf",
        summary: "Monthly report",
        media_type: "application/pdf",
        size: 5000,
      });

      const tool = makeListFilesTool(fileStore);
      const result = await tool.execute!({ limit: null, offset: null });

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("f-meta");
      expect(result[0].name).toBe("report.pdf");
      expect(result[0].path).toBe("/data/report.pdf");
      expect(result[0].summary).toBe("Monthly report");
      expect(result[0].media_type).toBe("application/pdf");
      expect(result[0].size).toBe(5000);
    });

    it("should default to limit of 20", async () => {
      for (let i = 0; i < 25; i++) {
        await insertTestFile({
          id: `f-${i}`,
          name: `file${i}.txt`,
          upload_time: `2025-01-${String(i + 1).padStart(2, "0")}T00:00:00.000Z`,
        });
      }

      const tool = makeListFilesTool(fileStore);
      const result = await tool.execute!({});

      expect(result).toHaveLength(20);
    });

    it("should handle empty object input", async () => {
      await insertTestFile();

      const tool = makeListFilesTool(fileStore);
      const result = await tool.execute!({});

      expect(result).toHaveLength(1);
    });
  });

  describe("makeSearchFilesTool", () => {
    beforeEach(async () => {
      await insertTestFile({
        id: "f-report",
        name: "quarterly-report.pdf",
        path: "/data/reports/quarterly.pdf",
        summary: "Q1 financial results",
        media_type: "application/pdf",
        size: 10000,
      });
      await insertTestFile({
        id: "f-photo",
        name: "vacation-photo.jpg",
        path: "/data/images/vacation.jpg",
        summary: "Beach sunset photo",
        media_type: "image/jpeg",
        size: 2000000,
      });
      await insertTestFile({
        id: "f-notes",
        name: "meeting-notes.txt",
        path: "/data/notes/meeting.txt",
        summary: "Notes from quarterly planning meeting",
        media_type: "text/plain",
        size: 500,
      });
    });

    it("should search files by name", async () => {
      const tool = makeSearchFilesTool(fileStore);
      const result = await tool.execute!({ query: "report" });

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("f-report");
    });

    it("should search files by summary", async () => {
      const tool = makeSearchFilesTool(fileStore);
      const result = await tool.execute!({ query: "sunset" });

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("f-photo");
    });

    it("should search files by path", async () => {
      const tool = makeSearchFilesTool(fileStore);
      const result = await tool.execute!({ query: "images" });

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("f-photo");
    });

    it("should match across multiple fields", async () => {
      const tool = makeSearchFilesTool(fileStore);
      const result = await tool.execute!({ query: "quarterly" });

      // Matches both: report (name) and notes (summary)
      expect(result).toHaveLength(2);
    });

    it("should return empty array when no matches", async () => {
      const tool = makeSearchFilesTool(fileStore);
      const result = await tool.execute!({ query: "nonexistent-xyz" });

      expect(result).toHaveLength(0);
    });

    it("should respect limit parameter", async () => {
      const tool = makeSearchFilesTool(fileStore);
      const result = await tool.execute!({ query: "data", limit: 1 });

      expect(result).toHaveLength(1);
    });

    it("should respect offset parameter", async () => {
      const tool = makeSearchFilesTool(fileStore);
      const allResults = await tool.execute!({ query: "data" });
      const offsetResults = await tool.execute!({ query: "data", offset: 1 });

      expect(offsetResults).toHaveLength(allResults.length - 1);
    });

    it("should search by file ID", async () => {
      const tool = makeSearchFilesTool(fileStore);
      const result = await tool.execute!({ query: "f-photo" });

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("f-photo");
    });

    it("should be case-insensitive in search", async () => {
      const tool = makeSearchFilesTool(fileStore);
      const result = await tool.execute!({ query: "REPORT" });

      // SQLite LIKE is case-insensitive for ASCII
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("f-report");
    });
  });
});
