import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DBInterface, KeepDb, FileStore, File } from "@app/db";
import { createDBNode } from "@app/node";

/**
 * Helper to create files table without full migration system.
 * This allows testing the store in isolation without CR-SQLite dependencies.
 * Schema matches v10.ts migration.
 */
async function createFilesTable(db: DBInterface): Promise<void> {
  await db.exec(`
    CREATE TABLE files (
      id text not null primary key,
      name text not null default '',
      path text not null default '',
      summary text not null default '',
      upload_time text not null default '',
      media_type text not null default '',
      size int not null default 0
    )
  `);
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_files_media_type ON files(media_type)`);
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_files_upload_time ON files(upload_time)`);
}

/**
 * Helper to create a valid File object.
 */
function createFile(
  id: string,
  overrides: Partial<File> = {}
): File {
  return {
    id,
    name: `file-${id}.txt`,
    path: `/uploads/${id}.txt`,
    summary: `Summary for ${id}`,
    upload_time: new Date().toISOString(),
    media_type: "text/plain",
    size: 1024,
    ...overrides,
  };
}

describe("FileStore", () => {
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
    if (db) {
      await db.close();
    }
  });

  describe("insertFile and getFile", () => {
    it("should insert and retrieve a file", async () => {
      const file: File = {
        id: "file-1",
        name: "document.pdf",
        path: "/uploads/document.pdf",
        summary: "An important document",
        upload_time: "2024-01-01T00:00:00Z",
        media_type: "application/pdf",
        size: 12345,
      };

      await fileStore.insertFile(file);
      const retrieved = await fileStore.getFile("file-1");

      expect(retrieved).not.toBeNull();
      expect(retrieved).toEqual(file);
    });

    it("should return null for non-existent file", async () => {
      const retrieved = await fileStore.getFile("non-existent");
      expect(retrieved).toBeNull();
    });

    it("should handle files with zero size", async () => {
      const file = createFile("file-empty", { size: 0 });
      await fileStore.insertFile(file);
      const retrieved = await fileStore.getFile("file-empty");

      expect(retrieved).not.toBeNull();
      expect(retrieved?.size).toBe(0);
    });

    it("should handle various media types", async () => {
      const mediaTypes = [
        "image/jpeg",
        "image/png",
        "video/mp4",
        "audio/mpeg",
        "application/json",
        "text/html",
      ];

      for (const mediaType of mediaTypes) {
        const file = createFile(`file-${mediaType.replace("/", "-")}`, {
          media_type: mediaType,
        });
        await fileStore.insertFile(file);
        const retrieved = await fileStore.getFile(file.id);
        expect(retrieved?.media_type).toBe(mediaType);
      }
    });
  });

  describe("updateFile", () => {
    it("should update an existing file", async () => {
      const file = createFile("file-1");
      await fileStore.insertFile(file);

      const updatedFile: File = {
        ...file,
        name: "updated-name.txt",
        summary: "Updated summary",
        size: 2048,
      };
      await fileStore.updateFile(updatedFile);

      const retrieved = await fileStore.getFile("file-1");
      expect(retrieved?.name).toBe("updated-name.txt");
      expect(retrieved?.summary).toBe("Updated summary");
      expect(retrieved?.size).toBe(2048);
    });

    it("should update all fields except id", async () => {
      const file = createFile("file-1", {
        name: "original.txt",
        path: "/original/path.txt",
        summary: "Original summary",
        upload_time: "2024-01-01T00:00:00Z",
        media_type: "text/plain",
        size: 100,
      });
      await fileStore.insertFile(file);

      const updatedFile: File = {
        id: "file-1",
        name: "updated.txt",
        path: "/updated/path.txt",
        summary: "Updated summary",
        upload_time: "2024-02-01T00:00:00Z",
        media_type: "text/markdown",
        size: 200,
      };
      await fileStore.updateFile(updatedFile);

      const retrieved = await fileStore.getFile("file-1");
      expect(retrieved).toEqual(updatedFile);
    });

    it("should not throw when updating non-existent file", async () => {
      const file = createFile("non-existent");
      // Should not throw
      await fileStore.updateFile(file);

      // File should not exist
      const retrieved = await fileStore.getFile("non-existent");
      expect(retrieved).toBeNull();
    });
  });

  describe("deleteFile", () => {
    it("should delete an existing file", async () => {
      const file = createFile("file-to-delete");
      await fileStore.insertFile(file);
      expect(await fileStore.getFile("file-to-delete")).not.toBeNull();

      await fileStore.deleteFile("file-to-delete");
      expect(await fileStore.getFile("file-to-delete")).toBeNull();
    });

    it("should not throw when deleting non-existent file", async () => {
      // Should not throw
      await fileStore.deleteFile("non-existent");
    });
  });

  describe("getFiles", () => {
    let files: File[];

    beforeEach(async () => {
      files = [
        createFile("file-1", { upload_time: "2024-01-01T00:00:00Z" }),
        createFile("file-2", { upload_time: "2024-01-02T00:00:00Z" }),
        createFile("file-3", { upload_time: "2024-01-03T00:00:00Z" }),
      ];

      for (const file of files) {
        await fileStore.insertFile(file);
      }
    });

    it("should get multiple files by IDs", async () => {
      const result = await fileStore.getFiles(["file-1", "file-3"]);

      expect(result).toHaveLength(2);
      expect(result.map((f) => f.id).sort()).toEqual(["file-1", "file-3"]);
    });

    it("should return files ordered by upload_time DESC", async () => {
      const result = await fileStore.getFiles(["file-1", "file-2", "file-3"]);

      expect(result).toHaveLength(3);
      // Newest first
      expect(result[0].id).toBe("file-3");
      expect(result[1].id).toBe("file-2");
      expect(result[2].id).toBe("file-1");
    });

    it("should return empty array for empty IDs array", async () => {
      const result = await fileStore.getFiles([]);
      expect(result).toHaveLength(0);
    });

    it("should return only existing files", async () => {
      const result = await fileStore.getFiles(["file-1", "non-existent", "file-2"]);
      expect(result).toHaveLength(2);
    });

    it("should return empty array when no files match", async () => {
      const result = await fileStore.getFiles(["non-existent-1", "non-existent-2"]);
      expect(result).toHaveLength(0);
    });
  });

  describe("listFiles", () => {
    let files: File[];

    beforeEach(async () => {
      files = [
        createFile("img-1", { media_type: "image/jpeg", upload_time: "2024-01-01T00:00:00Z" }),
        createFile("img-2", { media_type: "image/png", upload_time: "2024-01-02T00:00:00Z" }),
        createFile("doc-1", { media_type: "application/pdf", upload_time: "2024-01-03T00:00:00Z" }),
        createFile("vid-1", { media_type: "video/mp4", upload_time: "2024-01-04T00:00:00Z" }),
        createFile("doc-2", { media_type: "application/pdf", upload_time: "2024-01-05T00:00:00Z" }),
      ];

      for (const file of files) {
        await fileStore.insertFile(file);
      }
    });

    it("should list all files ordered by upload_time DESC", async () => {
      const result = await fileStore.listFiles();

      expect(result).toHaveLength(5);
      // Newest first
      expect(result[0].id).toBe("doc-2");
      expect(result[4].id).toBe("img-1");
    });

    it("should filter by media_type", async () => {
      const pdfFiles = await fileStore.listFiles("application/pdf");
      expect(pdfFiles).toHaveLength(2);
      expect(pdfFiles.every((f) => f.media_type === "application/pdf")).toBe(true);
    });

    it("should respect limit parameter", async () => {
      const result = await fileStore.listFiles(undefined, 2);
      expect(result).toHaveLength(2);
      // Should be newest 2
      expect(result[0].id).toBe("doc-2");
      expect(result[1].id).toBe("vid-1");
    });

    it("should respect offset parameter", async () => {
      const result = await fileStore.listFiles(undefined, 2, 2);
      expect(result).toHaveLength(2);
      // Should skip first 2, get items 3 and 4
      expect(result[0].id).toBe("doc-1");
      expect(result[1].id).toBe("img-2");
    });

    it("should combine media_type filter with pagination", async () => {
      const result = await fileStore.listFiles("application/pdf", 1, 0);
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("doc-2"); // Newest PDF
    });

    it("should return empty array when no files match media_type", async () => {
      const result = await fileStore.listFiles("audio/mpeg");
      expect(result).toHaveLength(0);
    });

    it("should return empty array when offset exceeds total", async () => {
      const result = await fileStore.listFiles(undefined, 10, 100);
      expect(result).toHaveLength(0);
    });

    it("should use default limit of 100", async () => {
      // Add more files to test default limit
      for (let i = 0; i < 50; i++) {
        await fileStore.insertFile(
          createFile(`bulk-file-${i}`, {
            upload_time: new Date(Date.now() + i * 1000).toISOString(),
          })
        );
      }

      const result = await fileStore.listFiles();
      // 5 original + 50 bulk = 55, default limit is 100 so should get all
      expect(result).toHaveLength(55);
    });
  });

  describe("searchFiles", () => {
    beforeEach(async () => {
      const files = [
        createFile("file-1", {
          name: "quarterly-report.pdf",
          path: "/documents/reports/quarterly-report.pdf",
          summary: "Q1 2024 financial summary",
        }),
        createFile("file-2", {
          name: "team-photo.jpg",
          path: "/images/team-photo.jpg",
          summary: "Engineering team photo from offsite",
        }),
        createFile("file-3", {
          name: "meeting-notes.txt",
          path: "/notes/meeting-notes.txt",
          summary: "Notes from quarterly planning meeting",
        }),
        createFile("file-4", {
          name: "logo.png",
          path: "/brand/logo.png",
          summary: "Company logo high resolution",
        }),
      ];

      for (const file of files) {
        await fileStore.insertFile(file);
      }
    });

    it("should search by name", async () => {
      const result = await fileStore.searchFiles("report");
      expect(result.some((f) => f.name.includes("report"))).toBe(true);
    });

    it("should search by path", async () => {
      const result = await fileStore.searchFiles("documents");
      expect(result.some((f) => f.path.includes("documents"))).toBe(true);
    });

    it("should search by summary", async () => {
      const result = await fileStore.searchFiles("financial");
      expect(result).toHaveLength(1);
      expect(result[0].summary).toContain("financial");
    });

    it("should search by id", async () => {
      const result = await fileStore.searchFiles("file-2");
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("file-2");
    });

    it("should search case-insensitively", async () => {
      // SQLite LIKE is case-insensitive for ASCII by default
      const result = await fileStore.searchFiles("QUARTERLY");
      expect(result.length).toBeGreaterThan(0);
    });

    it("should return results ordered by upload_time DESC", async () => {
      // Search for "meeting" - should appear in file-3 summary
      const result = await fileStore.searchFiles("meeting");
      expect(result).toHaveLength(1);
    });

    it("should respect limit parameter", async () => {
      // Add more files that match the query
      await fileStore.insertFile(
        createFile("file-5", {
          name: "quarterly-budget.xlsx",
          summary: "Quarterly budget spreadsheet",
        })
      );

      const result = await fileStore.searchFiles("quarterly", 1);
      expect(result).toHaveLength(1);
    });

    it("should return empty array when no matches found", async () => {
      const result = await fileStore.searchFiles("nonexistent");
      expect(result).toHaveLength(0);
    });

    it("should handle special characters in search query", async () => {
      // Add a file with special characters
      await fileStore.insertFile(
        createFile("file-special", {
          name: "file-with-dash.txt",
          summary: "Contains special chars: test@example.com",
        })
      );

      const result = await fileStore.searchFiles("test@example");
      expect(result).toHaveLength(1);
    });
  });

  describe("countFiles", () => {
    beforeEach(async () => {
      const files = [
        createFile("img-1", { media_type: "image/jpeg" }),
        createFile("img-2", { media_type: "image/png" }),
        createFile("doc-1", { media_type: "application/pdf" }),
        createFile("vid-1", { media_type: "video/mp4" }),
      ];

      for (const file of files) {
        await fileStore.insertFile(file);
      }
    });

    it("should count all files", async () => {
      const count = await fileStore.countFiles();
      expect(count).toBe(4);
    });

    it("should count files by media_type", async () => {
      const imageCount = await fileStore.countFiles("image/jpeg");
      expect(imageCount).toBe(1);

      const pdfCount = await fileStore.countFiles("application/pdf");
      expect(pdfCount).toBe(1);
    });

    it("should return 0 for non-existent media_type", async () => {
      const count = await fileStore.countFiles("audio/mpeg");
      expect(count).toBe(0);
    });

    it("should return 0 when no files exist", async () => {
      // Create new database without files
      await db.close();
      db = await createDBNode(":memory:");
      keepDb = new KeepDb(db);
      await createFilesTable(db);
      fileStore = new FileStore(keepDb);

      const count = await fileStore.countFiles();
      expect(count).toBe(0);
    });
  });

  describe("getFilesByMediaTypePattern", () => {
    beforeEach(async () => {
      const files = [
        createFile("img-1", { media_type: "image/jpeg", upload_time: "2024-01-01T00:00:00Z" }),
        createFile("img-2", { media_type: "image/png", upload_time: "2024-01-02T00:00:00Z" }),
        createFile("img-3", { media_type: "image/gif", upload_time: "2024-01-03T00:00:00Z" }),
        createFile("doc-1", { media_type: "application/pdf", upload_time: "2024-01-04T00:00:00Z" }),
        createFile("vid-1", { media_type: "video/mp4", upload_time: "2024-01-05T00:00:00Z" }),
        createFile("vid-2", { media_type: "video/webm", upload_time: "2024-01-06T00:00:00Z" }),
      ];

      for (const file of files) {
        await fileStore.insertFile(file);
      }
    });

    it("should match image/* pattern", async () => {
      const result = await fileStore.getFilesByMediaTypePattern("image/%");
      expect(result).toHaveLength(3);
      expect(result.every((f) => f.media_type.startsWith("image/"))).toBe(true);
    });

    it("should match video/* pattern", async () => {
      const result = await fileStore.getFilesByMediaTypePattern("video/%");
      expect(result).toHaveLength(2);
      expect(result.every((f) => f.media_type.startsWith("video/"))).toBe(true);
    });

    it("should return results ordered by upload_time DESC", async () => {
      const result = await fileStore.getFilesByMediaTypePattern("image/%");
      // Newest first
      expect(result[0].id).toBe("img-3");
      expect(result[1].id).toBe("img-2");
      expect(result[2].id).toBe("img-1");
    });

    it("should respect limit parameter", async () => {
      const result = await fileStore.getFilesByMediaTypePattern("image/%", 2);
      expect(result).toHaveLength(2);
    });

    it("should return empty array for non-matching pattern", async () => {
      const result = await fileStore.getFilesByMediaTypePattern("audio/%");
      expect(result).toHaveLength(0);
    });

    it("should handle exact match pattern", async () => {
      const result = await fileStore.getFilesByMediaTypePattern("application/pdf");
      expect(result).toHaveLength(1);
      expect(result[0].media_type).toBe("application/pdf");
    });
  });

  describe("edge cases", () => {
    it("should handle unicode in file name and path", async () => {
      const file = createFile("file-unicode", {
        name: "文档.pdf",
        path: "/uploads/中文路径/文档.pdf",
        summary: "Document with Chinese characters 文档",
      });

      await fileStore.insertFile(file);
      const retrieved = await fileStore.getFile("file-unicode");

      expect(retrieved?.name).toBe("文档.pdf");
      expect(retrieved?.path).toBe("/uploads/中文路径/文档.pdf");
      expect(retrieved?.summary).toContain("文档");
    });

    it("should handle very long file names", async () => {
      const longName = "a".repeat(500) + ".txt";
      const file = createFile("file-long-name", { name: longName });

      await fileStore.insertFile(file);
      const retrieved = await fileStore.getFile("file-long-name");

      expect(retrieved?.name).toBe(longName);
    });

    it("should handle very large file sizes", async () => {
      // 10 GB file
      const file = createFile("file-large", { size: 10 * 1024 * 1024 * 1024 });

      await fileStore.insertFile(file);
      const retrieved = await fileStore.getFile("file-large");

      expect(retrieved?.size).toBe(10 * 1024 * 1024 * 1024);
    });

    it("should handle empty summary", async () => {
      const file = createFile("file-no-summary", { summary: "" });

      await fileStore.insertFile(file);
      const retrieved = await fileStore.getFile("file-no-summary");

      expect(retrieved?.summary).toBe("");
    });

    it("should handle special characters in path", async () => {
      const file = createFile("file-special-path", {
        path: "/uploads/folder with spaces/file (1).txt",
      });

      await fileStore.insertFile(file);
      const retrieved = await fileStore.getFile("file-special-path");

      expect(retrieved?.path).toBe("/uploads/folder with spaces/file (1).txt");
    });
  });
});
