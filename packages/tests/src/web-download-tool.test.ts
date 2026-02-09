import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { DBInterface, KeepDb, FileStore } from "@app/db";
import { createDBNode } from "@app/node";
import { makeWebDownloadTool, type EvalContext } from "@app/agent";
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

// Helper to create mock fetch response
function createMockResponse(
  body: Uint8Array | string,
  options: {
    status?: number;
    statusText?: string;
    headers?: Record<string, string>;
  } = {}
): Response {
  const { status = 200, statusText = "OK", headers = {} } = options;

  const buffer = typeof body === "string" ? Buffer.from(body) : body;

  // Create a readable stream from the buffer
  const chunks = [buffer];
  let index = 0;
  const stream = new ReadableStream({
    pull(controller) {
      if (index < chunks.length) {
        controller.enqueue(chunks[index]);
        index++;
      } else {
        controller.close();
      }
    },
  });

  return {
    ok: status >= 200 && status < 300,
    status,
    statusText,
    headers: new Headers(headers),
    body: stream,
  } as Response;
}

describe("Web.download Tool", () => {
  let db: DBInterface;
  let keepDb: KeepDb;
  let fileStore: FileStore;
  let tmpDir: string;
  let mockContext: EvalContext;
  let originalFetch: typeof globalThis.fetch;

  beforeEach(async () => {
    db = await createDBNode(":memory:");
    keepDb = new KeepDb(db);
    await createFilesTable(db);
    fileStore = new FileStore(keepDb);
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "keepai-test-"));
    mockContext = createMockContext();

    // Save original fetch
    originalFetch = globalThis.fetch;
  });

  afterEach(async () => {
    // Restore original fetch
    globalThis.fetch = originalFetch;

    if (db) await db.close();
    // Clean up temp dir
    if (tmpDir && fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("should download and save a file from URL", async () => {
    const fileContent = "Test file content";
    globalThis.fetch = vi.fn().mockResolvedValue(
      createMockResponse(fileContent, {
        headers: {
          "content-type": "text/plain",
          "content-length": fileContent.length.toString(),
        },
      })
    );

    const tool = makeWebDownloadTool(fileStore, tmpDir, () => mockContext);
    const result = await tool.execute({
      url: "https://example.com/test.txt",
    } as any);

    expect(result.name).toBe("test.txt");
    expect(result.size).toBe(fileContent.length);
    expect(result.media_type).toBe("text/plain");
    expect(result.url).toBe("https://example.com/test.txt");
    expect(result.id).toBeTruthy();
    expect(result.path).toBeTruthy();

    // Verify file exists on disk
    const filePath = path.join(tmpDir, "files", result.path);
    expect(fs.existsSync(filePath)).toBe(true);

    // Verify file content
    const savedContent = fs.readFileSync(filePath, "utf8");
    expect(savedContent).toBe(fileContent);

    // Verify event was created
    expect(mockContext.createEvent).toHaveBeenCalledWith("web_download", {
      url: "https://example.com/test.txt",
      filename: "test.txt",
      size: fileContent.length,
    });

    // Verify fetch was called correctly
    expect(globalThis.fetch).toHaveBeenCalledWith("https://example.com/test.txt", {
      method: "GET",
      headers: {
        "User-Agent": "KeepAI-Agent/1.0",
      },
    });
  });

  it("should extract filename from Content-Disposition header", async () => {
    const fileContent = "PDF content";
    globalThis.fetch = vi.fn().mockResolvedValue(
      createMockResponse(fileContent, {
        headers: {
          "content-type": "application/pdf",
          "content-disposition": 'attachment; filename="report.pdf"',
        },
      })
    );

    const tool = makeWebDownloadTool(fileStore, tmpDir, () => mockContext);
    const result = await tool.execute({
      url: "https://example.com/download/12345",
    } as any);

    expect(result.name).toBe("report.pdf");
    expect(result.media_type).toBe("application/pdf");
  });

  it("should extract filename from Content-Disposition without quotes", async () => {
    const fileContent = "Image content";
    globalThis.fetch = vi.fn().mockResolvedValue(
      createMockResponse(fileContent, {
        headers: {
          "content-type": "image/png",
          "content-disposition": "attachment; filename=image.png",
        },
      })
    );

    const tool = makeWebDownloadTool(fileStore, tmpDir, () => mockContext);
    const result = await tool.execute({
      url: "https://example.com/download/image",
    } as any);

    expect(result.name).toBe("image.png");
  });

  it("should extract filename from URL path", async () => {
    const fileContent = "JSON data";
    globalThis.fetch = vi.fn().mockResolvedValue(
      createMockResponse(fileContent, {
        headers: {
          "content-type": "application/json",
        },
      })
    );

    const tool = makeWebDownloadTool(fileStore, tmpDir, () => mockContext);
    const result = await tool.execute({
      url: "https://api.example.com/data/export.json",
    } as any);

    expect(result.name).toBe("export.json");
  });

  it("should use provided filename parameter", async () => {
    const fileContent = "Custom named file";
    globalThis.fetch = vi.fn().mockResolvedValue(
      createMockResponse(fileContent, {
        headers: {
          "content-type": "text/plain",
          "content-disposition": 'attachment; filename="ignored.txt"',
        },
      })
    );

    const tool = makeWebDownloadTool(fileStore, tmpDir, () => mockContext);
    const result = await tool.execute({
      url: "https://example.com/file",
      filename: "custom-name.txt",
    } as any);

    expect(result.name).toBe("custom-name.txt");
  });

  it("should add extension from MIME type when filename has none", async () => {
    const fileContent = "PNG image data";
    globalThis.fetch = vi.fn().mockResolvedValue(
      createMockResponse(fileContent, {
        headers: {
          "content-type": "image/png",
        },
      })
    );

    const tool = makeWebDownloadTool(fileStore, tmpDir, () => mockContext);
    const result = await tool.execute({
      url: "https://example.com/download/12345",
    } as any);

    expect(result.name).toBe("12345.png");
    expect(result.media_type).toBe("image/png");
  });

  it("should add .jpg extension for JPEG MIME type", async () => {
    const fileContent = "JPEG image data";
    globalThis.fetch = vi.fn().mockResolvedValue(
      createMockResponse(fileContent, {
        headers: {
          "content-type": "image/jpeg",
        },
      })
    );

    const tool = makeWebDownloadTool(fileStore, tmpDir, () => mockContext);
    const result = await tool.execute({
      url: "https://example.com/photo",
    } as any);

    expect(result.name).toBe("photo.jpg");
  });

  it("should add .pdf extension for PDF MIME type", async () => {
    const fileContent = "PDF document";
    globalThis.fetch = vi.fn().mockResolvedValue(
      createMockResponse(fileContent, {
        headers: {
          "content-type": "application/pdf",
        },
      })
    );

    const tool = makeWebDownloadTool(fileStore, tmpDir, () => mockContext);
    const result = await tool.execute({
      url: "https://example.com/document",
    } as any);

    expect(result.name).toBe("document.pdf");
  });

  it("should throw PermissionError when userPath is not configured", async () => {
    const tool = makeWebDownloadTool(fileStore, undefined, () => mockContext);

    await expect(
      tool.execute({
        url: "https://example.com/test.txt",
      } as any)
    ).rejects.toThrow("User path not configured");
  });

  it("should throw on HTTP 404 error", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      createMockResponse("Not Found", {
        status: 404,
        statusText: "Not Found",
      })
    );

    const tool = makeWebDownloadTool(fileStore, tmpDir, () => mockContext);

    await expect(
      tool.execute({
        url: "https://example.com/nonexistent.txt",
      } as any)
    ).rejects.toThrow("Failed to download file: 404 Not Found");
  });

  it("should throw on HTTP 500 error", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      createMockResponse("Internal Server Error", {
        status: 500,
        statusText: "Internal Server Error",
      })
    );

    const tool = makeWebDownloadTool(fileStore, tmpDir, () => mockContext);

    await expect(
      tool.execute({
        url: "https://example.com/error.txt",
      } as any)
    ).rejects.toThrow("Failed to download file: 500 Internal Server Error");
  });

  it("should throw on network errors", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("Network connection failed"));

    const tool = makeWebDownloadTool(fileStore, tmpDir, () => mockContext);

    await expect(
      tool.execute({
        url: "https://example.com/test.txt",
      } as any)
    ).rejects.toThrow("Network connection failed");
  });

  it("should throw LogicError when Content-Length exceeds 10MB", async () => {
    const largeSize = 11 * 1024 * 1024; // 11MB
    globalThis.fetch = vi.fn().mockResolvedValue(
      createMockResponse("", {
        headers: {
          "content-type": "application/octet-stream",
          "content-length": largeSize.toString(),
        },
      })
    );

    const tool = makeWebDownloadTool(fileStore, tmpDir, () => mockContext);

    await expect(
      tool.execute({
        url: "https://example.com/large-file.bin",
      } as any)
    ).rejects.toThrow(`File too large: ${largeSize} bytes`);
  });

  it("should throw LogicError when streamed content exceeds 10MB", async () => {
    // Create a buffer larger than 10MB
    const chunkSize = 1024 * 1024; // 1MB
    const numChunks = 11; // 11MB total
    const chunks: Uint8Array[] = [];
    for (let i = 0; i < numChunks; i++) {
      chunks.push(new Uint8Array(chunkSize).fill(65)); // Fill with 'A'
    }

    let chunkIndex = 0;
    const stream = new ReadableStream({
      pull(controller) {
        if (chunkIndex < chunks.length) {
          controller.enqueue(chunks[chunkIndex]);
          chunkIndex++;
        } else {
          controller.close();
        }
      },
    });

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      headers: new Headers({
        "content-type": "application/octet-stream",
      }),
      body: stream,
    } as Response);

    const tool = makeWebDownloadTool(fileStore, tmpDir, () => mockContext);

    await expect(
      tool.execute({
        url: "https://example.com/large-stream.bin",
      } as any)
    ).rejects.toThrow("File too large");
  });

  it("should create web_download event", async () => {
    const fileContent = "Event test content";
    globalThis.fetch = vi.fn().mockResolvedValue(
      createMockResponse(fileContent, {
        headers: {
          "content-type": "text/plain",
        },
      })
    );

    const tool = makeWebDownloadTool(fileStore, tmpDir, () => mockContext);
    await tool.execute({
      url: "https://example.com/event-test.txt",
    } as any);

    expect(mockContext.createEvent).toHaveBeenCalledWith("web_download", {
      url: "https://example.com/event-test.txt",
      filename: "event-test.txt",
      size: fileContent.length,
    });
  });

  it("should handle missing Content-Type header", async () => {
    const fileContent = "No content type";
    globalThis.fetch = vi.fn().mockResolvedValue(
      createMockResponse(fileContent, {
        headers: {}, // No content-type header
      })
    );

    const tool = makeWebDownloadTool(fileStore, tmpDir, () => mockContext);
    const result = await tool.execute({
      url: "https://example.com/no-type.txt",
    } as any);

    expect(result.name).toBe("no-type.txt");
    expect(result.size).toBe(fileContent.length);
    // media_type is auto-detected from buffer content when Content-Type header is missing
    expect(typeof result.media_type).toBe("string");
  });

  it("should strip charset from Content-Type header", async () => {
    const fileContent = "Text with charset";
    globalThis.fetch = vi.fn().mockResolvedValue(
      createMockResponse(fileContent, {
        headers: {
          "content-type": "text/plain; charset=utf-8",
        },
      })
    );

    const tool = makeWebDownloadTool(fileStore, tmpDir, () => mockContext);
    const result = await tool.execute({
      url: "https://example.com/charset-test.txt",
    } as any);

    expect(result.media_type).toBe("text/plain");
  });

  it("should save file with custom summary", async () => {
    const fileContent = "Summary test";
    globalThis.fetch = vi.fn().mockResolvedValue(
      createMockResponse(fileContent, {
        headers: {
          "content-type": "text/plain",
        },
      })
    );

    const tool = makeWebDownloadTool(fileStore, tmpDir, () => mockContext);
    const result = await tool.execute({
      url: "https://example.com/summary.txt",
      summary: "Important test file for validation",
    } as any);

    expect(result.summary).toBe("Important test file for validation");
  });

  it("should use default filename when URL has no path", async () => {
    const fileContent = "Root download";
    globalThis.fetch = vi.fn().mockResolvedValue(
      createMockResponse(fileContent, {
        headers: {
          "content-type": "text/plain",
        },
      })
    );

    const tool = makeWebDownloadTool(fileStore, tmpDir, () => mockContext);
    const result = await tool.execute({
      url: "https://example.com/",
    } as any);

    expect(result.name).toBe("downloaded-file.txt");
  });

  it("should handle binary data correctly", async () => {
    // Create binary data (a simple PNG header)
    const binaryData = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, // PNG signature
      0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52, // IHDR chunk
    ]);

    globalThis.fetch = vi.fn().mockResolvedValue(
      createMockResponse(binaryData, {
        headers: {
          "content-type": "image/png",
        },
      })
    );

    const tool = makeWebDownloadTool(fileStore, tmpDir, () => mockContext);
    const result = await tool.execute({
      url: "https://example.com/image.png",
    } as any);

    expect(result.size).toBe(binaryData.length);
    expect(result.media_type).toBe("image/png");

    // Verify binary content is preserved
    const filePath = path.join(tmpDir, "files", result.path);
    const savedData = fs.readFileSync(filePath);
    expect(savedData).toEqual(Buffer.from(binaryData));
  });

  it("isReadOnly should return false", () => {
    const tool = makeWebDownloadTool(fileStore, tmpDir, () => mockContext);
    expect(tool.isReadOnly?.({} as any)).toBe(false);
  });

  it("should deduplicate files with same content", async () => {
    const fileContent = "Duplicate content";
    globalThis.fetch = vi.fn().mockResolvedValue(
      createMockResponse(fileContent, {
        headers: {
          "content-type": "text/plain",
        },
      })
    );

    const tool = makeWebDownloadTool(fileStore, tmpDir, () => mockContext);

    const result1 = await tool.execute({
      url: "https://example.com/file1.txt",
    } as any);

    // Reset the mock for second call
    globalThis.fetch = vi.fn().mockResolvedValue(
      createMockResponse(fileContent, {
        headers: {
          "content-type": "text/plain",
        },
      })
    );

    const result2 = await tool.execute({
      url: "https://example.com/file2.txt",
    } as any);

    // Same hash for same content
    expect(result1.id).toBe(result2.id);
    // Second download updates the name
    expect(result2.name).toBe("file2.txt");
  });

  it("should handle URL with query parameters in filename extraction", async () => {
    const fileContent = "Query params test";
    globalThis.fetch = vi.fn().mockResolvedValue(
      createMockResponse(fileContent, {
        headers: {
          "content-type": "application/json",
        },
      })
    );

    const tool = makeWebDownloadTool(fileStore, tmpDir, () => mockContext);
    const result = await tool.execute({
      url: "https://api.example.com/export.json?token=abc123&format=json",
    } as any);

    expect(result.name).toBe("export.json");
  });

  it("should handle Content-Disposition with single quotes", async () => {
    const fileContent = "Single quotes test";
    globalThis.fetch = vi.fn().mockResolvedValue(
      createMockResponse(fileContent, {
        headers: {
          "content-type": "text/plain",
          "content-disposition": "attachment; filename='quoted-file.txt'",
        },
      })
    );

    const tool = makeWebDownloadTool(fileStore, tmpDir, () => mockContext);
    const result = await tool.execute({
      url: "https://example.com/download",
    } as any);

    expect(result.name).toBe("quoted-file.txt");
  });

  it("should accept files up to 10MB", async () => {
    // Create exactly 10MB of data
    const tenMB = 10 * 1024 * 1024;
    const buffer = Buffer.alloc(tenMB, 65); // Fill with 'A'

    globalThis.fetch = vi.fn().mockResolvedValue(
      createMockResponse(buffer, {
        headers: {
          "content-type": "application/octet-stream",
          "content-length": tenMB.toString(),
        },
      })
    );

    const tool = makeWebDownloadTool(fileStore, tmpDir, () => mockContext);
    const result = await tool.execute({
      url: "https://example.com/max-size.bin",
    } as any);

    expect(result.size).toBe(tenMB);
  });

  it("should handle URLs with special characters in filename", async () => {
    const fileContent = "Special chars test";
    globalThis.fetch = vi.fn().mockResolvedValue(
      createMockResponse(fileContent, {
        headers: {
          "content-type": "text/plain",
        },
      })
    );

    const tool = makeWebDownloadTool(fileStore, tmpDir, () => mockContext);
    const result = await tool.execute({
      url: "https://example.com/files/my%20document%20(1).txt",
    } as any);

    expect(result.name).toBe("my%20document%20(1).txt");
  });

  it("should include all file metadata in result", async () => {
    const fileContent = "Metadata test";
    globalThis.fetch = vi.fn().mockResolvedValue(
      createMockResponse(fileContent, {
        headers: {
          "content-type": "text/plain",
        },
      })
    );

    const tool = makeWebDownloadTool(fileStore, tmpDir, () => mockContext);
    const result = await tool.execute({
      url: "https://example.com/metadata.txt",
      summary: "Test summary",
    } as any);

    expect(result.id).toBeTruthy();
    expect(result.name).toBe("metadata.txt");
    expect(result.path).toBeTruthy();
    expect(result.summary).toBe("Test summary");
    expect(result.upload_time).toBeTruthy();
    expect(result.media_type).toBe("text/plain");
    expect(result.size).toBe(fileContent.length);
    expect(result.url).toBe("https://example.com/metadata.txt");
  });
});
