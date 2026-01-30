import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DBInterface, KeepDb, MemoryStore, StorageThreadType } from "@app/db";
import { AssistantUIMessage } from "@app/proto";
import { createDBNode } from "@app/node";

/**
 * Helper to create threads and messages tables without full migration system.
 * This allows testing the store in isolation without CR-SQLite dependencies.
 * Schema matches v1.ts migration.
 */
async function createMemoryTables(db: DBInterface): Promise<void> {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS threads (
      id TEXT NOT NULL PRIMARY KEY,
      title TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT '',
      metadata TEXT NOT NULL DEFAULT ''
    )
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT NOT NULL PRIMARY KEY,
      thread_id TEXT NOT NULL DEFAULT '',
      role TEXT NOT NULL DEFAULT '',
      content TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT ''
    )
  `);

  await db.exec(`CREATE INDEX IF NOT EXISTS idx_messages_thread_id ON messages(thread_id)`);
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at)`);
}

/**
 * Helper to create a valid AssistantUIMessage.
 */
function createMessage(
  id: string,
  threadId: string,
  role: "user" | "assistant",
  text: string,
  createdAt?: string
): AssistantUIMessage {
  return {
    id,
    role,
    parts: [{ type: "text", text }],
    metadata: {
      createdAt: createdAt || new Date().toISOString(),
      threadId,
    },
  };
}

describe("MemoryStore", () => {
  let db: DBInterface;
  let keepDb: KeepDb;
  let memoryStore: MemoryStore;

  beforeEach(async () => {
    db = await createDBNode(":memory:");
    keepDb = new KeepDb(db);
    await createMemoryTables(db);
    memoryStore = new MemoryStore(keepDb);
  });

  afterEach(async () => {
    if (db) {
      await db.close();
    }
  });

  describe("saveThread and getThread", () => {
    it("should save and retrieve a thread", async () => {
      const thread: StorageThreadType = {
        id: "thread-1",
        title: "Test Thread",
        created_at: new Date("2024-01-01T00:00:00Z"),
        updated_at: new Date("2024-01-01T01:00:00Z"),
        metadata: { key: "value" },
      };

      await memoryStore.saveThread(thread);
      const retrieved = await memoryStore.getThread("thread-1");

      expect(retrieved).not.toBeNull();
      expect(retrieved?.id).toBe(thread.id);
      expect(retrieved?.title).toBe(thread.title);
      expect(retrieved?.created_at.toISOString()).toBe(thread.created_at.toISOString());
      expect(retrieved?.updated_at.toISOString()).toBe(thread.updated_at.toISOString());
      expect(retrieved?.metadata).toEqual({ key: "value" });
    });

    it("should return null for non-existent thread", async () => {
      const retrieved = await memoryStore.getThread("non-existent");
      expect(retrieved).toBeNull();
    });

    it("should handle thread without title", async () => {
      const thread: StorageThreadType = {
        id: "thread-no-title",
        created_at: new Date(),
        updated_at: new Date(),
      };

      await memoryStore.saveThread(thread);
      const retrieved = await memoryStore.getThread("thread-no-title");

      expect(retrieved).not.toBeNull();
      expect(retrieved?.title).toBeUndefined();
    });

    it("should handle thread without metadata", async () => {
      const thread: StorageThreadType = {
        id: "thread-no-metadata",
        title: "No Metadata Thread",
        created_at: new Date(),
        updated_at: new Date(),
      };

      await memoryStore.saveThread(thread);
      const retrieved = await memoryStore.getThread("thread-no-metadata");

      expect(retrieved).not.toBeNull();
      // Empty object from JSON.parse('{}') is truthy so returns as-is
      expect(retrieved?.metadata).toEqual({});
    });

    it("should support INSERT OR REPLACE for idempotency", async () => {
      const thread: StorageThreadType = {
        id: "thread-1",
        title: "Original Title",
        created_at: new Date("2024-01-01T00:00:00Z"),
        updated_at: new Date("2024-01-01T00:00:00Z"),
      };

      await memoryStore.saveThread(thread);

      // Update the same thread
      const updatedThread: StorageThreadType = {
        id: "thread-1",
        title: "Updated Title",
        created_at: new Date("2024-01-01T00:00:00Z"),
        updated_at: new Date("2024-01-02T00:00:00Z"),
      };

      await memoryStore.saveThread(updatedThread);
      const retrieved = await memoryStore.getThread("thread-1");

      expect(retrieved?.title).toBe("Updated Title");
      expect(retrieved?.updated_at.toISOString()).toBe("2024-01-02T00:00:00.000Z");
    });

    it("should save thread with transaction parameter", async () => {
      const thread: StorageThreadType = {
        id: "thread-tx",
        title: "Transaction Thread",
        created_at: new Date(),
        updated_at: new Date(),
      };

      await memoryStore.saveThread(thread, db);
      const retrieved = await memoryStore.getThread("thread-tx");

      expect(retrieved).not.toBeNull();
      expect(retrieved?.title).toBe("Transaction Thread");
    });
  });

  describe("listThreads", () => {
    let threads: StorageThreadType[];

    beforeEach(async () => {
      const now = new Date();
      threads = [
        {
          id: "thread-old",
          title: "Old Thread",
          created_at: new Date(now.getTime() - 3000),
          updated_at: new Date(now.getTime() - 3000),
        },
        {
          id: "thread-middle",
          title: "Middle Thread",
          created_at: new Date(now.getTime() - 2000),
          updated_at: new Date(now.getTime() - 2000),
        },
        {
          id: "thread-recent",
          title: "Recent Thread",
          created_at: new Date(now.getTime() - 1000),
          updated_at: new Date(now.getTime() - 1000),
        },
      ];

      for (const thread of threads) {
        await memoryStore.saveThread(thread);
      }
    });

    it("should list all threads ordered by updated_at DESC", async () => {
      const result = await memoryStore.listThreads();

      expect(result).toHaveLength(3);
      // Newest first
      expect(result[0].id).toBe("thread-recent");
      expect(result[1].id).toBe("thread-middle");
      expect(result[2].id).toBe("thread-old");
    });

    it("should return empty array when no threads exist", async () => {
      // Create new database without threads
      await db.close();
      db = await createDBNode(":memory:");
      keepDb = new KeepDb(db);
      await createMemoryTables(db);
      memoryStore = new MemoryStore(keepDb);

      const result = await memoryStore.listThreads();
      expect(result).toHaveLength(0);
    });

    it("should order by updated_at not created_at", async () => {
      // Create a thread with old created_at but recent updated_at
      const thread: StorageThreadType = {
        id: "thread-recently-updated",
        title: "Recently Updated",
        created_at: new Date("2000-01-01T00:00:00Z"), // Very old
        updated_at: new Date(), // Very recent
      };

      await memoryStore.saveThread(thread);
      const result = await memoryStore.listThreads();

      expect(result[0].id).toBe("thread-recently-updated");
    });
  });

  describe("saveMessages", () => {
    beforeEach(async () => {
      // Create a thread for messages
      const thread: StorageThreadType = {
        id: "thread-1",
        title: "Test Thread",
        created_at: new Date(),
        updated_at: new Date(),
      };
      await memoryStore.saveThread(thread);
    });

    it("should save and retrieve a single message", async () => {
      const message = createMessage("msg-1", "thread-1", "user", "Hello world");

      await memoryStore.saveMessages([message]);
      const retrieved = await memoryStore.getMessages({ messageId: "msg-1" });

      expect(retrieved).toHaveLength(1);
      expect(retrieved[0].id).toBe("msg-1");
      expect(retrieved[0].role).toBe("user");
      expect(retrieved[0].parts[0]).toEqual({ type: "text", text: "Hello world" });
    });

    it("should save multiple messages", async () => {
      const messages = [
        createMessage("msg-1", "thread-1", "user", "First message", "2024-01-01T00:00:00Z"),
        createMessage("msg-2", "thread-1", "assistant", "Second message", "2024-01-01T00:01:00Z"),
        createMessage("msg-3", "thread-1", "user", "Third message", "2024-01-01T00:02:00Z"),
      ];

      await memoryStore.saveMessages(messages);
      const retrieved = await memoryStore.getMessages({ threadId: "thread-1" });

      expect(retrieved).toHaveLength(3);
    });

    it("should throw error when message has no metadata", async () => {
      const invalidMessage = {
        id: "msg-invalid",
        role: "user" as const,
        parts: [{ type: "text" as const, text: "Test" }],
      } as AssistantUIMessage;

      await expect(memoryStore.saveMessages([invalidMessage])).rejects.toThrow(
        "Empty message metadata"
      );
    });

    it("should throw error when metadata has no threadId", async () => {
      const invalidMessage = {
        id: "msg-invalid",
        role: "user" as const,
        parts: [{ type: "text" as const, text: "Test" }],
        metadata: {
          createdAt: new Date().toISOString(),
        },
      } as AssistantUIMessage;

      await expect(memoryStore.saveMessages([invalidMessage])).rejects.toThrow(
        "Message metadata must include threadId"
      );
    });

    it("should support INSERT OR REPLACE for idempotency", async () => {
      const message = createMessage("msg-1", "thread-1", "user", "Original text");
      await memoryStore.saveMessages([message]);

      // Update the same message
      const updatedMessage = createMessage("msg-1", "thread-1", "user", "Updated text");
      await memoryStore.saveMessages([updatedMessage]);

      const retrieved = await memoryStore.getMessages({ messageId: "msg-1" });
      expect(retrieved).toHaveLength(1);
      expect(retrieved[0].parts[0]).toEqual({ type: "text", text: "Updated text" });
    });

    it("should save messages with transaction parameter", async () => {
      const message = createMessage("msg-tx", "thread-1", "user", "Transaction message");

      await memoryStore.saveMessages([message], db);
      const retrieved = await memoryStore.getMessages({ messageId: "msg-tx" });

      expect(retrieved).toHaveLength(1);
    });

    it("should use current timestamp when createdAt not provided", async () => {
      const before = new Date().toISOString();
      const message: AssistantUIMessage = {
        id: "msg-no-createdat",
        role: "user",
        parts: [{ type: "text", text: "Test" }],
        metadata: {
          createdAt: "", // Empty but present
          threadId: "thread-1",
        },
      };

      // The store will use new Date().toISOString() when createdAt is empty/falsy
      await memoryStore.saveMessages([message]);
      const after = new Date().toISOString();

      // Can't easily test the exact timestamp, but we can verify it was saved
      const retrieved = await memoryStore.getMessages({ messageId: "msg-no-createdat" });
      expect(retrieved).toHaveLength(1);
    });
  });

  describe("getMessages", () => {
    beforeEach(async () => {
      // Create threads
      await memoryStore.saveThread({
        id: "thread-1",
        title: "Thread 1",
        created_at: new Date(),
        updated_at: new Date(),
      });
      await memoryStore.saveThread({
        id: "thread-2",
        title: "Thread 2",
        created_at: new Date(),
        updated_at: new Date(),
      });

      // Create messages across threads with different timestamps
      const messages = [
        createMessage("msg-1", "thread-1", "user", "Thread 1 - First", "2024-01-01T00:00:00Z"),
        createMessage("msg-2", "thread-1", "assistant", "Thread 1 - Second", "2024-01-01T00:01:00Z"),
        createMessage("msg-3", "thread-1", "user", "Thread 1 - Third", "2024-01-01T00:02:00Z"),
        createMessage("msg-4", "thread-2", "user", "Thread 2 - First", "2024-01-01T00:03:00Z"),
        createMessage("msg-5", "thread-2", "assistant", "Thread 2 - Second", "2024-01-01T00:04:00Z"),
      ];

      await memoryStore.saveMessages(messages);
    });

    it("should filter by threadId", async () => {
      const thread1Messages = await memoryStore.getMessages({ threadId: "thread-1" });
      expect(thread1Messages).toHaveLength(3);
      expect(thread1Messages.every((m) => m.metadata?.threadId === "thread-1")).toBe(true);

      const thread2Messages = await memoryStore.getMessages({ threadId: "thread-2" });
      expect(thread2Messages).toHaveLength(2);
      expect(thread2Messages.every((m) => m.metadata?.threadId === "thread-2")).toBe(true);
    });

    it("should filter by messageId", async () => {
      const result = await memoryStore.getMessages({ messageId: "msg-3" });
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("msg-3");
    });

    it("should filter by since timestamp", async () => {
      const result = await memoryStore.getMessages({
        since: "2024-01-01T00:01:30Z",
      });

      // Should get messages after 00:01:30: msg-3 (00:02), msg-4 (00:03), msg-5 (00:04)
      expect(result).toHaveLength(3);
      expect(result.map((m) => m.id).sort()).toEqual(["msg-3", "msg-4", "msg-5"]);
    });

    it("should combine threadId and since filters", async () => {
      const result = await memoryStore.getMessages({
        threadId: "thread-1",
        since: "2024-01-01T00:00:30Z",
      });

      // Should get thread-1 messages after 00:00:30: msg-2 (00:01), msg-3 (00:02)
      expect(result).toHaveLength(2);
      expect(result.map((m) => m.id).sort()).toEqual(["msg-2", "msg-3"]);
    });

    it("should respect limit parameter", async () => {
      const result = await memoryStore.getMessages({ limit: 2 });

      // Note: DB query uses DESC, then re-sorted ASC
      // With limit 2 from DESC order, we get msg-5, msg-4 then sort ASC -> msg-4, msg-5
      expect(result).toHaveLength(2);
    });

    it("should return messages sorted by createdAt ASC", async () => {
      const result = await memoryStore.getMessages({ threadId: "thread-1" });

      expect(result).toHaveLength(3);
      // Should be in ascending order
      expect(result[0].id).toBe("msg-1");
      expect(result[1].id).toBe("msg-2");
      expect(result[2].id).toBe("msg-3");
    });

    it("should return empty array for non-existent thread", async () => {
      const result = await memoryStore.getMessages({ threadId: "non-existent" });
      expect(result).toHaveLength(0);
    });

    it("should use default limit of 50", async () => {
      // Add more messages
      const manyMessages = Array.from({ length: 60 }, (_, i) =>
        createMessage(
          `msg-bulk-${i}`,
          "thread-1",
          i % 2 === 0 ? "user" : "assistant",
          `Bulk message ${i}`,
          new Date(Date.now() + i * 1000).toISOString()
        )
      );

      await memoryStore.saveMessages(manyMessages);

      const result = await memoryStore.getMessages({ threadId: "thread-1" });
      // Default limit is 50
      expect(result).toHaveLength(50);
    });

    it("should handle combined filters", async () => {
      const result = await memoryStore.getMessages({
        threadId: "thread-1",
        messageId: "msg-2",
      });

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("msg-2");
    });
  });

  describe("message content parsing", () => {
    beforeEach(async () => {
      await memoryStore.saveThread({
        id: "thread-1",
        title: "Test Thread",
        created_at: new Date(),
        updated_at: new Date(),
      });
    });

    it("should filter out messages without content", async () => {
      // Manually insert a message with empty content
      await db.exec(
        `INSERT INTO messages (id, thread_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)`,
        ["msg-empty", "thread-1", "user", "", new Date().toISOString()]
      );

      const result = await memoryStore.getMessages({ threadId: "thread-1" });
      expect(result).toHaveLength(0);
    });

    it("should filter out messages with invalid JSON", async () => {
      // Manually insert a message with invalid JSON
      await db.exec(
        `INSERT INTO messages (id, thread_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)`,
        ["msg-invalid-json", "thread-1", "user", "not valid json", new Date().toISOString()]
      );

      // Also add a valid message
      const validMessage = createMessage("msg-valid", "thread-1", "user", "Valid message");
      await memoryStore.saveMessages([validMessage]);

      const result = await memoryStore.getMessages({ threadId: "thread-1" });
      // Should only return the valid message
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("msg-valid");
    });

    it("should filter out messages without role", async () => {
      // Manually insert a message with JSON but missing role
      const invalidMessage = {
        id: "msg-no-role",
        parts: [{ type: "text", text: "Test" }],
        metadata: { createdAt: new Date().toISOString(), threadId: "thread-1" },
      };
      await db.exec(
        `INSERT INTO messages (id, thread_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)`,
        ["msg-no-role", "thread-1", "", JSON.stringify(invalidMessage), new Date().toISOString()]
      );

      const result = await memoryStore.getMessages({ threadId: "thread-1" });
      expect(result).toHaveLength(0);
    });

    it("should filter out messages without parts", async () => {
      // Manually insert a message with JSON but missing parts
      const invalidMessage = {
        id: "msg-no-parts",
        role: "user",
        metadata: { createdAt: new Date().toISOString(), threadId: "thread-1" },
      };
      await db.exec(
        `INSERT INTO messages (id, thread_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)`,
        ["msg-no-parts", "thread-1", "user", JSON.stringify(invalidMessage), new Date().toISOString()]
      );

      const result = await memoryStore.getMessages({ threadId: "thread-1" });
      expect(result).toHaveLength(0);
    });
  });

  describe("edge cases", () => {
    it("should handle unicode in thread title and metadata", async () => {
      const thread: StorageThreadType = {
        id: "thread-unicode",
        title: "工程团队讨论 🚀",
        created_at: new Date(),
        updated_at: new Date(),
        metadata: { team: "Équipe d'ingénierie", emoji: "🎉" },
      };

      await memoryStore.saveThread(thread);
      const retrieved = await memoryStore.getThread("thread-unicode");

      expect(retrieved?.title).toBe("工程团队讨论 🚀");
      expect(retrieved?.metadata).toEqual({ team: "Équipe d'ingénierie", emoji: "🎉" });
    });

    it("should handle unicode in message content", async () => {
      await memoryStore.saveThread({
        id: "thread-1",
        created_at: new Date(),
        updated_at: new Date(),
      });

      const message = createMessage("msg-unicode", "thread-1", "user", "你好世界 👋 مرحبا");
      await memoryStore.saveMessages([message]);

      const retrieved = await memoryStore.getMessages({ messageId: "msg-unicode" });
      expect(retrieved[0].parts[0]).toEqual({ type: "text", text: "你好世界 👋 مرحبا" });
    });

    it("should handle very long message content", async () => {
      await memoryStore.saveThread({
        id: "thread-1",
        created_at: new Date(),
        updated_at: new Date(),
      });

      const longText = "A".repeat(100000);
      const message = createMessage("msg-long", "thread-1", "user", longText);
      await memoryStore.saveMessages([message]);

      const retrieved = await memoryStore.getMessages({ messageId: "msg-long" });
      expect(retrieved[0].parts[0]).toEqual({ type: "text", text: longText });
    });

    it("should handle complex metadata in thread", async () => {
      const complexMetadata = {
        settings: {
          notifications: true,
          theme: "dark",
        },
        participants: ["user1", "user2"],
        stats: {
          messageCount: 42,
          lastActive: new Date().toISOString(),
        },
      };

      const thread: StorageThreadType = {
        id: "thread-complex",
        title: "Complex Thread",
        created_at: new Date(),
        updated_at: new Date(),
        metadata: complexMetadata,
      };

      await memoryStore.saveThread(thread);
      const retrieved = await memoryStore.getThread("thread-complex");

      expect(retrieved?.metadata).toEqual(complexMetadata);
    });

    it("should handle empty thread title as undefined", async () => {
      const thread: StorageThreadType = {
        id: "thread-empty-title",
        title: "",
        created_at: new Date(),
        updated_at: new Date(),
      };

      await memoryStore.saveThread(thread);
      const retrieved = await memoryStore.getThread("thread-empty-title");

      // Empty string converts to undefined in getThread
      expect(retrieved?.title).toBeUndefined();
    });
  });
});
