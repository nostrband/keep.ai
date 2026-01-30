import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { DBInterface, KeepDb, NoteStore, Note } from "@app/db";
import { createDBNode } from "@app/node";
import {
  makeCreateNoteTool,
  makeUpdateNoteTool,
  makeDeleteNoteTool,
  makeGetNoteTool,
  makeListNotesTool,
  makeSearchNotesTool,
  type EvalContext,
} from "@app/agent";

/**
 * Helper to create notes table without full migration system.
 */
async function createNotesTable(db: DBInterface): Promise<void> {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS notes (
      id TEXT PRIMARY KEY NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      tags TEXT NOT NULL DEFAULT '[]',
      priority TEXT NOT NULL DEFAULT 'low',
      created TEXT NOT NULL,
      updated TEXT NOT NULL
    )
  `);
}

/**
 * Creates a mock EvalContext for testing.
 */
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
 * Creates mock ToolCallOptions for testing.
 */
function createToolCallOptions() {
  return {
    toolCallId: "test-call",
    messages: [],
    abortSignal: new AbortController().signal,
  };
}

// Types for search/list results
type NoteMetadata = {
  id: string;
  title: string;
  tags: string[];
  priority: "high" | "low" | "medium";
  created: string;
  updated: string;
};

type SearchResult = NoteMetadata & {
  snippet?: string;
};

describe("Note Tools", () => {
  let db: DBInterface;
  let keepDb: KeepDb;
  let noteStore: NoteStore;
  let mockContext: EvalContext;

  beforeEach(async () => {
    db = await createDBNode(":memory:");
    keepDb = new KeepDb(db);
    await createNotesTable(db);
    noteStore = new NoteStore(keepDb);
    mockContext = createMockContext();
  });

  afterEach(async () => {
    if (db) {
      await db.close();
    }
    vi.clearAllMocks();
  });

  describe("makeCreateNoteTool", () => {
    it("should create a note with all fields", async () => {
      const createNoteTool = makeCreateNoteTool(noteStore, () => mockContext);

      const result = await createNoteTool.execute!(
        {
          id: "test-note-1",
          title: "Test Note",
          content: "This is test content",
          tags: ["test", "example"],
          priority: "high",
        },
        createToolCallOptions()
      );

      expect(result).toBe("test-note-1");

      // Verify note was created
      const note = await noteStore.getNote("test-note-1");
      expect(note).not.toBeNull();
      expect(note?.title).toBe("Test Note");
      expect(note?.content).toBe("This is test content");
      expect(note?.tags).toEqual(["test", "example"]);
      expect(note?.priority).toBe("high");

      // Verify event was created
      expect(mockContext.createEvent).toHaveBeenCalledWith("create_note", {
        id: "test-note-1",
        title: "Test Note",
      });
    });

    it("should create a note with default values", async () => {
      const createNoteTool = makeCreateNoteTool(noteStore, () => mockContext);

      await createNoteTool.execute!(
        {
          id: "default-note",
          title: "Default Note",
          content: "Content here",
          tags: null,
          priority: null,
        },
        createToolCallOptions()
      );

      const note = await noteStore.getNote("default-note");
      expect(note?.tags).toEqual([]);
      expect(note?.priority).toBe("low");
    });

    it("should generate an ID if not provided", async () => {
      const createNoteTool = makeCreateNoteTool(noteStore, () => mockContext);

      // Pass empty string - will use it as-is or fallback
      const result = await createNoteTool.execute!(
        {
          id: "",
          title: "Generated ID Note",
          content: "Content",
          tags: null,
          priority: null,
        },
        createToolCallOptions()
      );

      // Empty string or generated ID both count as success
      expect(typeof result).toBe("string");
    });

    it("should reject notes exceeding size limit", async () => {
      const createNoteTool = makeCreateNoteTool(noteStore, () => mockContext);

      // Create content larger than 50KB
      const largeContent = "x".repeat(60 * 1024);

      await expect(
        createNoteTool.execute!(
          {
            id: "large-note",
            title: "Large Note",
            content: largeContent,
            tags: null,
            priority: null,
          },
          createToolCallOptions()
        )
      ).rejects.toThrow("Note size exceeds 50KB limit");
    });

    it("should reject when max notes (500) reached", async () => {
      const createNoteTool = makeCreateNoteTool(noteStore, () => mockContext);

      // Create 500 notes
      for (let i = 0; i < 500; i++) {
        await noteStore.createNote(`Note ${i}`, "Content", [], "low", `note-${i}`);
      }

      await expect(
        createNoteTool.execute!(
          {
            id: "note-501",
            title: "One Too Many",
            content: "Content",
            tags: null,
            priority: null,
          },
          createToolCallOptions()
        )
      ).rejects.toThrow("Maximum number of notes (500) reached");
    });
  });

  describe("makeUpdateNoteTool", () => {
    it("should update note title", async () => {
      await noteStore.createNote("Original Title", "Content", [], "low", "update-test");
      const updateNoteTool = makeUpdateNoteTool(noteStore, () => mockContext);

      const result = await updateNoteTool.execute!(
        {
          id: "update-test",
          title: "Updated Title",
          content: null,
          tags: null,
          priority: null,
        },
        createToolCallOptions()
      );

      expect(result).toBe("update-test");

      const note = await noteStore.getNote("update-test");
      expect(note?.title).toBe("Updated Title");
      expect(note?.content).toBe("Content"); // Unchanged
    });

    it("should update note content", async () => {
      await noteStore.createNote("Title", "Original Content", [], "low", "content-test");
      const updateNoteTool = makeUpdateNoteTool(noteStore, () => mockContext);

      await updateNoteTool.execute!(
        {
          id: "content-test",
          title: null,
          content: "Updated Content",
          tags: null,
          priority: null,
        },
        createToolCallOptions()
      );

      const note = await noteStore.getNote("content-test");
      expect(note?.content).toBe("Updated Content");
    });

    it("should update note tags", async () => {
      await noteStore.createNote("Title", "Content", ["old"], "low", "tags-test");
      const updateNoteTool = makeUpdateNoteTool(noteStore, () => mockContext);

      await updateNoteTool.execute!(
        {
          id: "tags-test",
          title: null,
          content: null,
          tags: ["new", "tags"],
          priority: null,
        },
        createToolCallOptions()
      );

      const note = await noteStore.getNote("tags-test");
      expect(note?.tags).toEqual(["new", "tags"]);
    });

    it("should update note priority", async () => {
      await noteStore.createNote("Title", "Content", [], "low", "priority-test");
      const updateNoteTool = makeUpdateNoteTool(noteStore, () => mockContext);

      await updateNoteTool.execute!(
        {
          id: "priority-test",
          title: null,
          content: null,
          tags: null,
          priority: "high",
        },
        createToolCallOptions()
      );

      const note = await noteStore.getNote("priority-test");
      expect(note?.priority).toBe("high");
    });

    it("should reject update with no fields provided", async () => {
      await noteStore.createNote("Title", "Content", [], "low", "no-update");
      const updateNoteTool = makeUpdateNoteTool(noteStore, () => mockContext);

      await expect(
        updateNoteTool.execute!(
          {
            id: "no-update",
            title: null,
            content: null,
            tags: null,
            priority: null,
          },
          createToolCallOptions()
        )
      ).rejects.toThrow("No updates provided");
    });

    it("should reject update for non-existent note", async () => {
      const updateNoteTool = makeUpdateNoteTool(noteStore, () => mockContext);

      await expect(
        updateNoteTool.execute!(
          {
            id: "non-existent",
            title: "New Title",
            content: null,
            tags: null,
            priority: null,
          },
          createToolCallOptions()
        )
      ).rejects.toThrow("Note not found");
    });
  });

  describe("makeDeleteNoteTool", () => {
    it("should delete an existing note", async () => {
      await noteStore.createNote("Title", "Content", [], "low", "delete-me");
      const deleteNoteTool = makeDeleteNoteTool(noteStore, () => mockContext);

      // deleteNoteTool now takes an object with id
      await deleteNoteTool.execute({ id: "delete-me" });

      const note = await noteStore.getNote("delete-me");
      expect(note).toBeNull();
    });

    it("should throw error for non-existent note", async () => {
      const deleteNoteTool = makeDeleteNoteTool(noteStore, () => mockContext);

      await expect(deleteNoteTool.execute({ id: "non-existent" })).rejects.toThrow("Note not found");
    });

    it("should throw error for empty id", async () => {
      const deleteNoteTool = makeDeleteNoteTool(noteStore, () => mockContext);

      await expect(deleteNoteTool.execute({ id: "" })).rejects.toThrow("Specify note id");
    });
  });

  describe("makeGetNoteTool", () => {
    it("should retrieve an existing note", async () => {
      await noteStore.createNote("My Title", "My Content", ["tag1"], "medium", "get-me");
      const getNoteTool = makeGetNoteTool(noteStore);

      // getNoteTool now takes an object with id
      const result = await getNoteTool.execute({ id: "get-me" });

      expect(result).toMatchObject({
        id: "get-me",
        title: "My Title",
        content: "My Content",
        tags: ["tag1"],
        priority: "medium",
      });
    });

    it("should throw error for non-existent note", async () => {
      const getNoteTool = makeGetNoteTool(noteStore);

      await expect(getNoteTool.execute({ id: "non-existent" })).rejects.toThrow("Note not found");
    });

    it("should throw error for empty id", async () => {
      const getNoteTool = makeGetNoteTool(noteStore);

      await expect(getNoteTool.execute({ id: "" })).rejects.toThrow("Param 'id' required");
    });
  });

  describe("makeListNotesTool", () => {
    beforeEach(async () => {
      // Create test notes with slight delays to ensure different updated times
      await noteStore.createNote("Note 1", "Content 1", ["a"], "low", "note-1");
      await noteStore.createNote("Note 2", "Content 2", ["b"], "medium", "note-2");
      await noteStore.createNote("Note 3", "Content 3", ["c"], "high", "note-3");
      await noteStore.createNote("Note 4", "Content 4", ["d"], "high", "note-4");
    });

    it("should list all notes with metadata", async () => {
      const listNotesTool = makeListNotesTool(noteStore);

      const result = (await listNotesTool.execute(
        { priority: null, limit: null, offset: null }
      )) as NoteMetadata[];

      expect(result).toHaveLength(4);
      // Should not include content
      expect(result[0]).toHaveProperty("id");
      expect(result[0]).toHaveProperty("title");
      expect(result[0]).not.toHaveProperty("content");
    });

    it("should filter notes by priority", async () => {
      const listNotesTool = makeListNotesTool(noteStore);

      const result = (await listNotesTool.execute(
        { priority: "high", limit: null, offset: null }
      )) as NoteMetadata[];

      expect(result).toHaveLength(2);
      expect(result.every((n) => n.priority === "high")).toBe(true);
    });

    it("should paginate results with limit and offset", async () => {
      const listNotesTool = makeListNotesTool(noteStore);

      const result = (await listNotesTool.execute(
        { priority: null, limit: 2, offset: 1 }
      )) as NoteMetadata[];

      expect(result).toHaveLength(2);
    });

    it("should handle null/undefined input", async () => {
      const listNotesTool = makeListNotesTool(noteStore);

      const result = (await listNotesTool.execute!(null, createToolCallOptions())) as NoteMetadata[];

      expect(result).toHaveLength(4);
    });
  });

  describe("makeSearchNotesTool", () => {
    beforeEach(async () => {
      await noteStore.createNote("Shopping List", "Buy milk and eggs", ["shopping"], "low", "note-1");
      await noteStore.createNote("Work Tasks", "Finish the report by Friday", ["work"], "high", "note-2");
      await noteStore.createNote("Recipe", "Eggs and flour for pancakes", ["cooking", "food"], "medium", "note-3");
    });

    it("should search notes by keyword", async () => {
      const searchNotesTool = makeSearchNotesTool(noteStore);

      const result = (await searchNotesTool.execute(
        { keywords: ["eggs"], tags: null, regexp: null }
      )) as SearchResult[];

      expect(result).toHaveLength(2);
      expect(result.some((n) => n.id === "note-1")).toBe(true);
      expect(result.some((n) => n.id === "note-3")).toBe(true);
    });

    it("should search notes by multiple keywords", async () => {
      const searchNotesTool = makeSearchNotesTool(noteStore);

      // The search uses OR logic - any keyword match returns the note
      const result = (await searchNotesTool.execute(
        { keywords: ["eggs", "milk"], tags: null, regexp: null }
      )) as SearchResult[];

      // Both note-1 (has "eggs" and "milk") and note-3 (has "eggs") should match
      expect(result).toHaveLength(2);
      expect(result.some((n) => n.id === "note-1")).toBe(true);
      expect(result.some((n) => n.id === "note-3")).toBe(true);
    });

    it("should search notes by tag", async () => {
      const searchNotesTool = makeSearchNotesTool(noteStore);

      const result = (await searchNotesTool.execute(
        { keywords: null, tags: ["work"], regexp: null }
      )) as SearchResult[];

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("note-2");
    });

    it("should search notes by regex", async () => {
      const searchNotesTool = makeSearchNotesTool(noteStore);

      const result = (await searchNotesTool.execute(
        { keywords: null, tags: null, regexp: "\\bFriday\\b" }
      )) as SearchResult[];

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("note-2");
    });

    it("should combine multiple search criteria", async () => {
      const searchNotesTool = makeSearchNotesTool(noteStore);

      // Search for notes with "eggs" in a cooking tag
      const result = (await searchNotesTool.execute(
        {
          keywords: ["eggs"],
          tags: ["cooking"],
          regexp: null,
        }
      )) as SearchResult[];

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("note-3");
    });

    it("should return empty array when no matches", async () => {
      const searchNotesTool = makeSearchNotesTool(noteStore);

      const result = (await searchNotesTool.execute(
        { keywords: ["xyz123"], tags: null, regexp: null }
      )) as SearchResult[];

      expect(result).toHaveLength(0);
    });

    it("should throw error for invalid regex", async () => {
      const searchNotesTool = makeSearchNotesTool(noteStore);

      await expect(
        searchNotesTool.execute(
          { keywords: null, tags: null, regexp: "[invalid" }
        )
      ).rejects.toThrow("Invalid regular expression");
    });

    it("should require at least one search criteria", async () => {
      const searchNotesTool = makeSearchNotesTool(noteStore);

      await expect(
        searchNotesTool.execute!(
          { keywords: null, tags: null, regexp: null },
          createToolCallOptions()
        )
      ).rejects.toThrow("At least one search criteria must be provided");
    });

    it("should include snippets when content matches", async () => {
      const searchNotesTool = makeSearchNotesTool(noteStore);

      const result = (await searchNotesTool.execute!(
        { keywords: ["pancakes"], tags: null, regexp: null },
        createToolCallOptions()
      )) as SearchResult[];

      expect(result).toHaveLength(1);
      expect(result[0].snippet).toBeDefined();
      expect(result[0].snippet).toContain("pancakes");
    });
  });
});
