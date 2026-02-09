import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { DBInterface, KeepDb, FileStore } from "@app/db";
import { createDBNode } from "@app/node";
import {
  makeImagesExplainTool,
  makeImagesGenerateTool,
  makeImagesTransformTool,
  makeAudioExplainTool,
  makePdfExplainTool,
  setEnv,
  type EvalContext,
} from "@app/agent";
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
  await db.exec(
    `CREATE INDEX IF NOT EXISTS idx_files_upload_time ON files(upload_time DESC)`
  );
}

function mockChatResponse(content: string, usage = {}) {
  return new Response(
    JSON.stringify({
      choices: [{ message: { content } }],
      usage,
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
}

function mockImageGenerateResponse(
  imageUrls: string[],
  reasoning = "test reasoning"
) {
  return new Response(
    JSON.stringify({
      choices: [
        {
          message: {
            images: imageUrls.map((url) => ({ image_url: { url } })),
            reasoning,
          },
        },
      ],
      usage: {},
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
}

describe("Media Tools", () => {
  let db: DBInterface;
  let keepDb: KeepDb;
  let fileStore: FileStore;
  let tempDir: string;
  let userPath: string;
  let originalFetch: typeof globalThis.fetch;

  beforeEach(async () => {
    // Create temp directory structure matching what the tools expect
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "media-tools-test-"));
    userPath = tempDir;
    // Tools look for files at userPath/files/<path>
    fs.mkdirSync(path.join(userPath, "files"), { recursive: true });

    // Create in-memory database with manual table creation
    db = await createDBNode(":memory:");
    keepDb = new KeepDb(db);
    await createFilesTable(db);
    fileStore = new FileStore(keepDb);

    // Set environment variable
    setEnv({ OPENROUTER_API_KEY: "test-api-key" });

    // Save original fetch
    originalFetch = globalThis.fetch;
  });

  afterEach(async () => {
    // Restore original fetch
    globalThis.fetch = originalFetch;

    // Clean up temp directory
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }

    // Clear environment
    setEnv({ OPENROUTER_API_KEY: "" });

    if (db) await db.close();
  });

  // =====================================================================
  // Images.explain
  // =====================================================================
  describe("Images.explain", () => {
    it("should throw PermissionError when userPath not configured", async () => {
      const tool = makeImagesExplainTool(fileStore, "", () =>
        createMockContext()
      );

      await expect(
        tool.execute({ file_path: "test.png", question: "What is this?" })
      ).rejects.toThrow("User path not configured");
    });

    it("should throw AuthError when API key not set", async () => {
      setEnv({ OPENROUTER_API_KEY: "" });
      const tool = makeImagesExplainTool(fileStore, userPath, () =>
        createMockContext()
      );

      await expect(
        tool.execute({ file_path: "test.png", question: "What is this?" })
      ).rejects.toThrow("OpenRouter API key not configured");
    });

    it("should throw LogicError for file not found", async () => {
      const tool = makeImagesExplainTool(fileStore, userPath, () =>
        createMockContext()
      );

      await expect(
        tool.execute({
          file_path: "nonexistent.png",
          question: "What is this?",
        })
      ).rejects.toThrow("File not found");
    });

    it("should throw LogicError for unsupported image format", async () => {
      await fileStore.insertFile({
        id: "text-file-id",
        name: "test.txt",
        path: "text-file-id.txt",
        summary: "",
        upload_time: new Date().toISOString(),
        media_type: "text/plain",
        size: 100,
      });
      fs.writeFileSync(
        path.join(userPath, "files", "text-file-id.txt"),
        "test content"
      );

      const tool = makeImagesExplainTool(fileStore, userPath, () =>
        createMockContext()
      );

      await expect(
        tool.execute({
          file_path: "text-file-id.txt",
          question: "What is this?",
        })
      ).rejects.toThrow("Unsupported image format");
    });

    it("should successfully analyze an image and return structured result", async () => {
      await fileStore.insertFile({
        id: "test-image-id",
        name: "test.png",
        path: "test-image-id.png",
        summary: "",
        upload_time: new Date().toISOString(),
        media_type: "image/png",
        size: 100,
      });
      fs.writeFileSync(
        path.join(userPath, "files", "test-image-id.png"),
        Buffer.from("fake-png-data")
      );

      globalThis.fetch = vi
        .fn()
        .mockResolvedValue(
          mockChatResponse("This is a test image showing a cat.")
        );

      const tool = makeImagesExplainTool(fileStore, userPath, () =>
        createMockContext()
      );
      const result = await tool.execute({
        file_path: "test-image-id.png",
        question: "What is in this image?",
      });

      // Returns { explanation, file_info } object
      expect(result.explanation).toBe(
        "This is a test image showing a cat."
      );
      expect(result.file_info).toEqual({
        id: "test-image-id",
        name: "test.png",
        media_type: "image/png",
        size: 100,
      });
      expect(globalThis.fetch).toHaveBeenCalledWith(
        "https://openrouter.ai/api/v1/chat/completions",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            Authorization: "Bearer test-api-key",
          }),
        })
      );
    });

    it("should be read-only", () => {
      const tool = makeImagesExplainTool(fileStore, userPath, () =>
        createMockContext()
      );
      // defineReadOnlyTool always returns true for isReadOnly
      expect(tool.isReadOnly?.({ file_path: "test.png", question: "test" })).toBe(true);
    });

    it("should create images_explain event", async () => {
      await fileStore.insertFile({
        id: "test-image-id",
        name: "test.png",
        path: "test-image-id.png",
        summary: "",
        upload_time: new Date().toISOString(),
        media_type: "image/png",
        size: 100,
      });
      fs.writeFileSync(
        path.join(userPath, "files", "test-image-id.png"),
        Buffer.from("fake-png-data")
      );

      globalThis.fetch = vi
        .fn()
        .mockResolvedValue(mockChatResponse("Analysis result"));

      const mockContext = createMockContext();
      const tool = makeImagesExplainTool(
        fileStore,
        userPath,
        () => mockContext
      );

      await tool.execute({
        file_path: "test-image-id.png",
        question: "What is this?",
      });

      expect(mockContext.createEvent).toHaveBeenCalledWith(
        "images_explain",
        expect.objectContaining({
          file: "test.png",
          question: "What is this?",
        })
      );
    });
  });

  // =====================================================================
  // Images.generate
  // =====================================================================
  describe("Images.generate", () => {
    it("should throw PermissionError when userPath not configured", async () => {
      const tool = makeImagesGenerateTool(fileStore, "", () =>
        createMockContext()
      );

      await expect(
        tool.execute({ prompt: "A cat", file_prefix: "cat" })
      ).rejects.toThrow("User path not configured");
    });

    it("should throw AuthError when API key not set", async () => {
      setEnv({ OPENROUTER_API_KEY: "" });
      const tool = makeImagesGenerateTool(fileStore, userPath, () =>
        createMockContext()
      );

      await expect(
        tool.execute({ prompt: "A cat", file_prefix: "cat" })
      ).rejects.toThrow("OpenRouter API key not configured");
    });

    it("should throw LogicError when no images in response", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            choices: [{ message: { images: [], reasoning: "test" } }],
            usage: {},
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      );

      const tool = makeImagesGenerateTool(fileStore, userPath, () =>
        createMockContext()
      );

      await expect(
        tool.execute({ prompt: "A cat", file_prefix: "cat" })
      ).rejects.toThrow("No images found");
    });

    it("should generate image and return structured result", async () => {
      let fetchCallCount = 0;
      globalThis.fetch = vi.fn().mockImplementation(async () => {
        fetchCallCount++;
        if (fetchCallCount === 1) {
          return mockImageGenerateResponse([
            "https://example.com/generated-image.png",
          ]);
        } else {
          return new Response(Buffer.from("fake-image-data"), {
            status: 200,
          });
        }
      });

      const tool = makeImagesGenerateTool(fileStore, userPath, () =>
        createMockContext()
      );
      const result = await tool.execute({
        prompt: "A cute cat",
        file_prefix: "cat",
      });

      // Returns { images, reasoning } object
      expect(result.images).toHaveLength(1);
      expect(result.images[0]).toHaveProperty("id");
      expect(result.images[0]).toHaveProperty("name");
      expect(result.images[0]).toHaveProperty("path");
      expect(result.images[0]).toHaveProperty("size");
      expect(result.reasoning).toBe("test reasoning");
      expect(globalThis.fetch).toHaveBeenCalledTimes(2);
    });

    it("should return false for isReadOnly", () => {
      const tool = makeImagesGenerateTool(fileStore, userPath, () =>
        createMockContext()
      );
      expect(tool.isReadOnly?.({ prompt: "test", file_prefix: "test" })).toBe(false);
    });

    it("should create images_generate event", async () => {
      let fetchCallCount = 0;
      globalThis.fetch = vi.fn().mockImplementation(async () => {
        fetchCallCount++;
        if (fetchCallCount === 1) {
          return mockImageGenerateResponse([
            "https://example.com/generated-image.png",
          ]);
        } else {
          return new Response(Buffer.from("fake-image-data"), {
            status: 200,
          });
        }
      });

      const mockContext = createMockContext();
      const tool = makeImagesGenerateTool(
        fileStore,
        userPath,
        () => mockContext
      );

      await tool.execute({ prompt: "A cat", file_prefix: "cat" });

      expect(mockContext.createEvent).toHaveBeenCalledWith(
        "images_generate",
        expect.objectContaining({
          prompt: "A cat",
          count: 1,
        })
      );
    });
  });

  // =====================================================================
  // Images.transform
  // =====================================================================
  describe("Images.transform", () => {
    it("should throw PermissionError when userPath not configured", async () => {
      const tool = makeImagesTransformTool(fileStore, "", () =>
        createMockContext()
      );

      await expect(
        tool.execute({
          file_paths: ["source.png"],
          prompt: "Make it blue",
          file_prefix: "blue",
        })
      ).rejects.toThrow("User path not configured");
    });

    it("should throw AuthError when API key not set", async () => {
      setEnv({ OPENROUTER_API_KEY: "" });
      const tool = makeImagesTransformTool(fileStore, userPath, () =>
        createMockContext()
      );

      await expect(
        tool.execute({
          file_paths: ["source.png"],
          prompt: "Make it blue",
          file_prefix: "blue",
        })
      ).rejects.toThrow("OpenRouter API key not configured");
    });

    it("should throw LogicError for source file not found", async () => {
      const tool = makeImagesTransformTool(fileStore, userPath, () =>
        createMockContext()
      );

      await expect(
        tool.execute({
          file_paths: ["nonexistent.png"],
          prompt: "Make it blue",
          file_prefix: "blue",
        })
      ).rejects.toThrow("File not found");
    });

    it("should throw LogicError for unsupported source format", async () => {
      await fileStore.insertFile({
        id: "text-file-id",
        name: "test.txt",
        path: "text-file-id.txt",
        summary: "",
        upload_time: new Date().toISOString(),
        media_type: "text/plain",
        size: 100,
      });
      fs.writeFileSync(
        path.join(userPath, "files", "text-file-id.txt"),
        "test content"
      );

      const tool = makeImagesTransformTool(fileStore, userPath, () =>
        createMockContext()
      );

      await expect(
        tool.execute({
          file_paths: ["text-file-id.txt"],
          prompt: "Make it blue",
          file_prefix: "blue",
        })
      ).rejects.toThrow("Unsupported image format");
    });

    it("should transform images and return structured result", async () => {
      await fileStore.insertFile({
        id: "source-image-id",
        name: "source.png",
        path: "source-image-id.png",
        summary: "",
        upload_time: new Date().toISOString(),
        media_type: "image/png",
        size: 100,
      });
      fs.writeFileSync(
        path.join(userPath, "files", "source-image-id.png"),
        Buffer.from("fake-png-data")
      );

      let fetchCallCount = 0;
      globalThis.fetch = vi.fn().mockImplementation(async () => {
        fetchCallCount++;
        if (fetchCallCount === 1) {
          return mockImageGenerateResponse([
            "https://example.com/transformed-image.png",
          ]);
        } else {
          return new Response(Buffer.from("fake-transformed-image-data"), {
            status: 200,
          });
        }
      });

      const tool = makeImagesTransformTool(fileStore, userPath, () =>
        createMockContext()
      );
      const result = await tool.execute({
        file_paths: ["source-image-id.png"],
        prompt: "Make it blue",
        file_prefix: "blue",
      });

      // Returns { images, source_files, reasoning } object
      expect(result.images).toHaveLength(1);
      expect(result.images[0]).toHaveProperty("id");
      expect(result.images[0]).toHaveProperty("name");
      expect(result.source_files).toHaveLength(1);
      expect(result.source_files[0]).toEqual({
        id: "source-image-id",
        name: "source.png",
        media_type: "image/png",
        size: 100,
      });
      expect(result.reasoning).toBe("test reasoning");
      expect(globalThis.fetch).toHaveBeenCalledTimes(2);
    });

    it("should return false for isReadOnly", () => {
      const tool = makeImagesTransformTool(fileStore, userPath, () =>
        createMockContext()
      );
      expect(tool.isReadOnly?.({ file_paths: ["test.png"], prompt: "test", file_prefix: "test" })).toBe(false);
    });

    it("should create images_transform event", async () => {
      await fileStore.insertFile({
        id: "source-image-id",
        name: "source.png",
        path: "source-image-id.png",
        summary: "",
        upload_time: new Date().toISOString(),
        media_type: "image/png",
        size: 100,
      });
      fs.writeFileSync(
        path.join(userPath, "files", "source-image-id.png"),
        Buffer.from("fake-png-data")
      );

      let fetchCallCount = 0;
      globalThis.fetch = vi.fn().mockImplementation(async () => {
        fetchCallCount++;
        if (fetchCallCount === 1) {
          return mockImageGenerateResponse([
            "https://example.com/transformed-image.png",
          ]);
        } else {
          return new Response(Buffer.from("fake-transformed-image-data"), {
            status: 200,
          });
        }
      });

      const mockContext = createMockContext();
      const tool = makeImagesTransformTool(
        fileStore,
        userPath,
        () => mockContext
      );

      await tool.execute({
        file_paths: ["source-image-id.png"],
        prompt: "Make it blue",
        file_prefix: "blue",
      });

      expect(mockContext.createEvent).toHaveBeenCalledWith(
        "images_transform",
        expect.objectContaining({
          prompt: "Make it blue",
          count: 1,
        })
      );
    });
  });

  // =====================================================================
  // Audio.explain
  // =====================================================================
  describe("Audio.explain", () => {
    it("should throw PermissionError when userPath not configured", async () => {
      const tool = makeAudioExplainTool(fileStore, "", () =>
        createMockContext()
      );

      await expect(
        tool.execute({
          file_path: "test.mp3",
          prompt: "What is this audio?",
        })
      ).rejects.toThrow("User path not configured");
    });

    it("should throw AuthError when API key not set", async () => {
      setEnv({ OPENROUTER_API_KEY: "" });
      const tool = makeAudioExplainTool(fileStore, userPath, () =>
        createMockContext()
      );

      await expect(
        tool.execute({
          file_path: "test.mp3",
          prompt: "What is this audio?",
        })
      ).rejects.toThrow("OpenRouter API key not configured");
    });

    it("should throw LogicError for file not found", async () => {
      const tool = makeAudioExplainTool(fileStore, userPath, () =>
        createMockContext()
      );

      await expect(
        tool.execute({
          file_path: "nonexistent.mp3",
          prompt: "What is this?",
        })
      ).rejects.toThrow("File not found");
    });

    it("should throw LogicError for unsupported audio format", async () => {
      await fileStore.insertFile({
        id: "text-file-id",
        name: "test.txt",
        path: "text-file-id.txt",
        summary: "",
        upload_time: new Date().toISOString(),
        media_type: "text/plain",
        size: 100,
      });
      fs.writeFileSync(
        path.join(userPath, "files", "text-file-id.txt"),
        "test content"
      );

      const tool = makeAudioExplainTool(fileStore, userPath, () =>
        createMockContext()
      );

      await expect(
        tool.execute({
          file_path: "text-file-id.txt",
          prompt: "What is this?",
        })
      ).rejects.toThrow("Unsupported audio format");
    });

    it("should analyze audio and return structured result", async () => {
      await fileStore.insertFile({
        id: "test-audio-id",
        name: "test.mp3",
        path: "test-audio-id.mp3",
        summary: "",
        upload_time: new Date().toISOString(),
        media_type: "audio/mpeg",
        size: 1000,
      });
      fs.writeFileSync(
        path.join(userPath, "files", "test-audio-id.mp3"),
        Buffer.from("fake-mp3-data")
      );

      globalThis.fetch = vi
        .fn()
        .mockResolvedValue(
          mockChatResponse("This is a recording of someone speaking.")
        );

      const tool = makeAudioExplainTool(fileStore, userPath, () =>
        createMockContext()
      );
      const result = await tool.execute({
        file_path: "test-audio-id.mp3",
        prompt: "What is in this audio?",
      });

      // Returns { explanation, file_info } object
      expect(result.explanation).toBe(
        "This is a recording of someone speaking."
      );
      expect(result.file_info).toEqual({
        id: "test-audio-id",
        name: "test.mp3",
        media_type: "audio/mpeg",
        size: 1000,
      });
      expect(globalThis.fetch).toHaveBeenCalledWith(
        "https://openrouter.ai/api/v1/chat/completions",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            Authorization: "Bearer test-api-key",
          }),
        })
      );
    });

    it("should be read-only", () => {
      const tool = makeAudioExplainTool(fileStore, userPath, () =>
        createMockContext()
      );
      expect(tool.isReadOnly?.({ file_path: "test.mp3", prompt: "test" })).toBe(true);
    });

    it("should create audio_explain event", async () => {
      await fileStore.insertFile({
        id: "test-audio-id",
        name: "test.mp3",
        path: "test-audio-id.mp3",
        summary: "",
        upload_time: new Date().toISOString(),
        media_type: "audio/mpeg",
        size: 1000,
      });
      fs.writeFileSync(
        path.join(userPath, "files", "test-audio-id.mp3"),
        Buffer.from("fake-mp3-data")
      );

      globalThis.fetch = vi
        .fn()
        .mockResolvedValue(mockChatResponse("Analysis result"));

      const mockContext = createMockContext();
      const tool = makeAudioExplainTool(
        fileStore,
        userPath,
        () => mockContext
      );

      await tool.execute({
        file_path: "test-audio-id.mp3",
        prompt: "What is this?",
      });

      expect(mockContext.createEvent).toHaveBeenCalledWith(
        "audio_explain",
        expect.objectContaining({
          file: "test.mp3",
          prompt: "What is this?",
        })
      );
    });
  });

  // =====================================================================
  // Pdf.explain
  // =====================================================================
  describe("Pdf.explain", () => {
    it("should throw PermissionError when userPath not configured", async () => {
      const tool = makePdfExplainTool(fileStore, "", () => createMockContext());

      await expect(
        tool.execute({
          file_path: "test.pdf",
          prompt: "What is this?",
        })
      ).rejects.toThrow("User path not configured");
    });

    it("should throw AuthError when API key not set", async () => {
      setEnv({ OPENROUTER_API_KEY: "" });
      const tool = makePdfExplainTool(fileStore, userPath, () =>
        createMockContext()
      );

      await expect(
        tool.execute({
          file_path: "test.pdf",
          prompt: "What is this?",
        })
      ).rejects.toThrow("OpenRouter API key not configured");
    });

    it("should throw LogicError for file not found", async () => {
      const tool = makePdfExplainTool(fileStore, userPath, () =>
        createMockContext()
      );

      await expect(
        tool.execute({
          file_path: "nonexistent.pdf",
          prompt: "What is this?",
        })
      ).rejects.toThrow("File not found");
    });

    it("should throw LogicError for unsupported format", async () => {
      await fileStore.insertFile({
        id: "text-file-id",
        name: "test.txt",
        path: "text-file-id.txt",
        summary: "",
        upload_time: new Date().toISOString(),
        media_type: "text/plain",
        size: 100,
      });
      fs.writeFileSync(
        path.join(userPath, "files", "text-file-id.txt"),
        "test content"
      );

      const tool = makePdfExplainTool(fileStore, userPath, () =>
        createMockContext()
      );

      await expect(
        tool.execute({
          file_path: "text-file-id.txt",
          prompt: "What is this?",
        })
      ).rejects.toThrow("Unsupported file format");
    });

    it("should analyze PDF and return structured result", async () => {
      await fileStore.insertFile({
        id: "test-pdf-id",
        name: "test.pdf",
        path: "test-pdf-id.pdf",
        summary: "",
        upload_time: new Date().toISOString(),
        media_type: "application/pdf",
        size: 5000,
      });
      fs.writeFileSync(
        path.join(userPath, "files", "test-pdf-id.pdf"),
        Buffer.from("fake-pdf-data")
      );

      globalThis.fetch = vi
        .fn()
        .mockResolvedValue(
          mockChatResponse("This PDF contains information about AI.")
        );

      const tool = makePdfExplainTool(fileStore, userPath, () =>
        createMockContext()
      );
      const result = await tool.execute({
        file_path: "test-pdf-id.pdf",
        prompt: "What is in this PDF?",
      });

      // Returns { explanation, file_info } object
      expect(result.explanation).toBe(
        "This PDF contains information about AI."
      );
      expect(result.file_info).toEqual({
        id: "test-pdf-id",
        name: "test.pdf",
        size: 5000,
      });
      expect(globalThis.fetch).toHaveBeenCalledWith(
        "https://openrouter.ai/api/v1/chat/completions",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            Authorization: "Bearer test-api-key",
          }),
        })
      );
    });

    it("should be read-only", () => {
      const tool = makePdfExplainTool(fileStore, userPath, () =>
        createMockContext()
      );
      expect(tool.isReadOnly?.({ file_path: "test.pdf", prompt: "test" })).toBe(true);
    });

    it("should create pdf_explain event", async () => {
      await fileStore.insertFile({
        id: "test-pdf-id",
        name: "test.pdf",
        path: "test-pdf-id.pdf",
        summary: "",
        upload_time: new Date().toISOString(),
        media_type: "application/pdf",
        size: 5000,
      });
      fs.writeFileSync(
        path.join(userPath, "files", "test-pdf-id.pdf"),
        Buffer.from("fake-pdf-data")
      );

      globalThis.fetch = vi
        .fn()
        .mockResolvedValue(mockChatResponse("Analysis result"));

      const mockContext = createMockContext();
      const tool = makePdfExplainTool(fileStore, userPath, () => mockContext);

      await tool.execute({
        file_path: "test-pdf-id.pdf",
        prompt: "What is this?",
      });

      expect(mockContext.createEvent).toHaveBeenCalledWith(
        "pdf_explain",
        expect.objectContaining({
          file: "test.pdf",
          prompt: "What is this?",
        })
      );
    });
  });
});
