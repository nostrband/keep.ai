import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DBInterface, KeepDb, InboxStore, InboxItem } from "@app/db";
import { createDBNode } from "@app/node";

/**
 * Helper to create inbox table without full migration system.
 * This allows testing the store in isolation without CR-SQLite dependencies.
 * Schema matches v4.ts migration.
 */
async function createInboxTable(db: DBInterface): Promise<void> {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS inbox (
      id TEXT PRIMARY KEY NOT NULL,
      source TEXT NOT NULL DEFAULT '',
      source_id TEXT NOT NULL DEFAULT '',
      target TEXT NOT NULL DEFAULT '',
      target_id TEXT NOT NULL DEFAULT '',
      content TEXT NOT NULL DEFAULT '',
      timestamp TEXT NOT NULL DEFAULT '',
      handler_timestamp TEXT NOT NULL DEFAULT '',
      handler_thread_id TEXT NOT NULL DEFAULT ''
    )
  `);
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_inbox_timestamp ON inbox(timestamp)`);
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_inbox_source ON inbox(source)`);
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_inbox_target ON inbox(target)`);
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_inbox_handler_timestamp ON inbox(handler_timestamp)`);
}

describe("InboxStore", () => {
  let db: DBInterface;
  let keepDb: KeepDb;
  let inboxStore: InboxStore;

  beforeEach(async () => {
    db = await createDBNode(":memory:");
    keepDb = new KeepDb(db);
    await createInboxTable(db);
    inboxStore = new InboxStore(keepDb);
  });

  afterEach(async () => {
    if (db) {
      await db.close();
    }
  });

  describe("saveInbox and getInboxItem", () => {
    it("should save and retrieve an inbox item", async () => {
      const item: InboxItem = {
        id: "inbox-1",
        source: "user",
        source_id: "msg-123",
        target: "planner",
        target_id: "task-456",
        content: JSON.stringify({ role: "user", text: "Create an automation" }),
        timestamp: new Date().toISOString(),
        handler_timestamp: "",
        handler_thread_id: "",
      };

      await inboxStore.saveInbox(item);
      const retrieved = await inboxStore.getInboxItem("inbox-1");

      expect(retrieved).not.toBeNull();
      expect(retrieved).toEqual(item);
    });

    it("should return null for non-existent item", async () => {
      const retrieved = await inboxStore.getInboxItem("non-existent");
      expect(retrieved).toBeNull();
    });

    it("should support INSERT OR REPLACE for idempotency", async () => {
      const item: InboxItem = {
        id: "inbox-1",
        source: "user",
        source_id: "msg-123",
        target: "planner",
        target_id: "task-456",
        content: "original content",
        timestamp: new Date().toISOString(),
        handler_timestamp: "",
        handler_thread_id: "",
      };

      await inboxStore.saveInbox(item);

      // Update the same item with new content
      const updatedItem = { ...item, content: "updated content" };
      await inboxStore.saveInbox(updatedItem);

      const retrieved = await inboxStore.getInboxItem("inbox-1");
      expect(retrieved?.content).toBe("updated content");
    });

    it("should save items with different sources", async () => {
      const userItem: InboxItem = {
        id: "inbox-user",
        source: "user",
        source_id: "msg-1",
        target: "planner",
        target_id: "task-1",
        content: "user message",
        timestamp: new Date().toISOString(),
        handler_timestamp: "",
        handler_thread_id: "",
      };

      const scriptItem: InboxItem = {
        id: "inbox-script",
        source: "script",
        source_id: "script-run-1",
        target: "maintainer",
        target_id: "task-2",
        content: "script error",
        timestamp: new Date().toISOString(),
        handler_timestamp: "",
        handler_thread_id: "",
      };

      const workerItem: InboxItem = {
        id: "inbox-worker",
        source: "worker",
        source_id: "worker-thread-1",
        target: "worker",
        target_id: "task-3",
        content: "worker message",
        timestamp: new Date().toISOString(),
        handler_timestamp: "",
        handler_thread_id: "",
      };

      await inboxStore.saveInbox(userItem);
      await inboxStore.saveInbox(scriptItem);
      await inboxStore.saveInbox(workerItem);

      expect(await inboxStore.getInboxItem("inbox-user")).toEqual(userItem);
      expect(await inboxStore.getInboxItem("inbox-script")).toEqual(scriptItem);
      expect(await inboxStore.getInboxItem("inbox-worker")).toEqual(workerItem);
    });
  });

  describe("handleInboxItem", () => {
    it("should mark an item as handled", async () => {
      const item: InboxItem = {
        id: "inbox-1",
        source: "user",
        source_id: "msg-123",
        target: "planner",
        target_id: "task-456",
        content: "test content",
        timestamp: new Date().toISOString(),
        handler_timestamp: "",
        handler_thread_id: "",
      };

      await inboxStore.saveInbox(item);

      const handleTimestamp = new Date().toISOString();
      const handleThreadId = "thread-789";
      const result = await inboxStore.handleInboxItem("inbox-1", handleTimestamp, handleThreadId);

      expect(result).toBe(true);

      const retrieved = await inboxStore.getInboxItem("inbox-1");
      expect(retrieved?.handler_timestamp).toBe(handleTimestamp);
      expect(retrieved?.handler_thread_id).toBe(handleThreadId);
    });

    it("should return true even for non-existent item", async () => {
      // cr-sqlite doesn't return changes count, so we always return true
      const result = await inboxStore.handleInboxItem("non-existent", new Date().toISOString(), "thread-1");
      expect(result).toBe(true);
    });
  });

  describe("listInboxItems", () => {
    let items: InboxItem[];

    beforeEach(async () => {
      const now = Date.now();
      items = [
        {
          id: "inbox-1",
          source: "user",
          source_id: "msg-1",
          target: "planner",
          target_id: "task-1",
          content: "content 1",
          timestamp: new Date(now - 3000).toISOString(),
          handler_timestamp: "",
          handler_thread_id: "",
        },
        {
          id: "inbox-2",
          source: "script",
          source_id: "script-run-1",
          target: "maintainer",
          target_id: "task-2",
          content: "content 2",
          timestamp: new Date(now - 2000).toISOString(),
          handler_timestamp: new Date(now - 1500).toISOString(),
          handler_thread_id: "thread-handled",
        },
        {
          id: "inbox-3",
          source: "user",
          source_id: "msg-2",
          target: "worker",
          target_id: "task-3",
          content: "content 3",
          timestamp: new Date(now - 1000).toISOString(),
          handler_timestamp: "",
          handler_thread_id: "",
        },
        {
          id: "inbox-4",
          source: "worker",
          source_id: "worker-1",
          target: "planner",
          target_id: "task-4",
          content: "content 4",
          timestamp: new Date(now).toISOString(),
          handler_timestamp: "",
          handler_thread_id: "",
        },
      ];

      for (const item of items) {
        await inboxStore.saveInbox(item);
      }
    });

    it("should list all items ordered by timestamp ASC", async () => {
      const result = await inboxStore.listInboxItems();

      expect(result).toHaveLength(4);
      // Should be oldest to newest
      expect(result[0].id).toBe("inbox-1");
      expect(result[1].id).toBe("inbox-2");
      expect(result[2].id).toBe("inbox-3");
      expect(result[3].id).toBe("inbox-4");
    });

    it("should filter by source", async () => {
      const userItems = await inboxStore.listInboxItems({ source: "user" });
      expect(userItems).toHaveLength(2);
      expect(userItems.every((i) => i.source === "user")).toBe(true);

      const scriptItems = await inboxStore.listInboxItems({ source: "script" });
      expect(scriptItems).toHaveLength(1);
      expect(scriptItems[0].source).toBe("script");

      const workerItems = await inboxStore.listInboxItems({ source: "worker" });
      expect(workerItems).toHaveLength(1);
      expect(workerItems[0].source).toBe("worker");
    });

    it("should filter by target", async () => {
      const plannerItems = await inboxStore.listInboxItems({ target: "planner" });
      expect(plannerItems).toHaveLength(2);
      expect(plannerItems.every((i) => i.target === "planner")).toBe(true);

      const maintainerItems = await inboxStore.listInboxItems({ target: "maintainer" });
      expect(maintainerItems).toHaveLength(1);
      expect(maintainerItems[0].target).toBe("maintainer");

      const workerItems = await inboxStore.listInboxItems({ target: "worker" });
      expect(workerItems).toHaveLength(1);
      expect(workerItems[0].target).toBe("worker");
    });

    it("should filter by handled status - unhandled", async () => {
      const unhandled = await inboxStore.listInboxItems({ handled: false });
      expect(unhandled).toHaveLength(3);
      expect(unhandled.every((i) => i.handler_timestamp === "")).toBe(true);
    });

    it("should filter by handled status - handled", async () => {
      const handled = await inboxStore.listInboxItems({ handled: true });
      expect(handled).toHaveLength(1);
      expect(handled[0].id).toBe("inbox-2");
      expect(handled[0].handler_timestamp).not.toBe("");
    });

    it("should combine multiple filters", async () => {
      const result = await inboxStore.listInboxItems({
        source: "user",
        handled: false,
      });
      expect(result).toHaveLength(2);
      expect(result.every((i) => i.source === "user" && i.handler_timestamp === "")).toBe(true);
    });

    it("should respect limit parameter", async () => {
      const result = await inboxStore.listInboxItems({ limit: 2 });
      expect(result).toHaveLength(2);
      // Should be first 2 by timestamp ASC
      expect(result[0].id).toBe("inbox-1");
      expect(result[1].id).toBe("inbox-2");
    });

    it("should respect limit and offset parameters", async () => {
      const result = await inboxStore.listInboxItems({ limit: 2, offset: 1 });
      expect(result).toHaveLength(2);
      // Should skip first item, get items 2 and 3
      expect(result[0].id).toBe("inbox-2");
      expect(result[1].id).toBe("inbox-3");
    });

    it("should return empty array when no items match filters", async () => {
      const result = await inboxStore.listInboxItems({
        source: "script",
        target: "worker",
      });
      expect(result).toHaveLength(0);
    });
  });

  describe("deleteInboxItem", () => {
    it("should delete an existing item", async () => {
      const item: InboxItem = {
        id: "inbox-to-delete",
        source: "user",
        source_id: "msg-123",
        target: "planner",
        target_id: "task-456",
        content: "test content",
        timestamp: new Date().toISOString(),
        handler_timestamp: "",
        handler_thread_id: "",
      };

      await inboxStore.saveInbox(item);
      expect(await inboxStore.getInboxItem("inbox-to-delete")).not.toBeNull();

      const result = await inboxStore.deleteInboxItem("inbox-to-delete");
      expect(result).toBe(true);

      expect(await inboxStore.getInboxItem("inbox-to-delete")).toBeNull();
    });

    it("should return true even for non-existent item", async () => {
      // cr-sqlite doesn't return changes count, so we always return true
      const result = await inboxStore.deleteInboxItem("non-existent");
      expect(result).toBe(true);
    });
  });

  describe("postponeItem", () => {
    it("should update the timestamp of an item", async () => {
      const originalTimestamp = new Date(Date.now() - 10000).toISOString();
      const item: InboxItem = {
        id: "inbox-1",
        source: "user",
        source_id: "msg-123",
        target: "planner",
        target_id: "task-456",
        content: "test content",
        timestamp: originalTimestamp,
        handler_timestamp: "",
        handler_thread_id: "",
      };

      await inboxStore.saveInbox(item);

      const newTimestamp = new Date().toISOString();
      const result = await inboxStore.postponeItem("inbox-1", newTimestamp);

      expect(result).toBe(true);

      const retrieved = await inboxStore.getInboxItem("inbox-1");
      expect(retrieved?.timestamp).toBe(newTimestamp);
    });

    it("should return true even for non-existent item", async () => {
      // cr-sqlite doesn't return changes count, so we always return true
      const result = await inboxStore.postponeItem("non-existent", new Date().toISOString());
      expect(result).toBe(true);
    });
  });

  describe("transaction support", () => {
    it("should save item within a transaction", async () => {
      const item: InboxItem = {
        id: "inbox-tx",
        source: "user",
        source_id: "msg-tx",
        target: "planner",
        target_id: "task-tx",
        content: "transaction content",
        timestamp: new Date().toISOString(),
        handler_timestamp: "",
        handler_thread_id: "",
      };

      // Save with transaction parameter
      await inboxStore.saveInbox(item, db);

      const retrieved = await inboxStore.getInboxItem("inbox-tx");
      expect(retrieved).toEqual(item);
    });
  });

  describe("inbox item targets", () => {
    it("should support all target types", async () => {
      const targets: Array<{ target: "worker" | "planner" | "maintainer"; id: string }> = [
        { target: "worker", id: "inbox-worker-target" },
        { target: "planner", id: "inbox-planner-target" },
        { target: "maintainer", id: "inbox-maintainer-target" },
      ];

      for (const { target, id } of targets) {
        const item: InboxItem = {
          id,
          source: "user",
          source_id: "msg-1",
          target,
          target_id: `task-${target}`,
          content: `content for ${target}`,
          timestamp: new Date().toISOString(),
          handler_timestamp: "",
          handler_thread_id: "",
        };

        await inboxStore.saveInbox(item);
        const retrieved = await inboxStore.getInboxItem(id);
        expect(retrieved?.target).toBe(target);
      }
    });
  });

  describe("inbox item sources", () => {
    it("should support all source types", async () => {
      const sources: Array<{ source: "user" | "worker" | "script"; id: string }> = [
        { source: "user", id: "inbox-user-source" },
        { source: "worker", id: "inbox-worker-source" },
        { source: "script", id: "inbox-script-source" },
      ];

      for (const { source, id } of sources) {
        const item: InboxItem = {
          id,
          source,
          source_id: `source-${source}`,
          target: "planner",
          target_id: "task-1",
          content: `content from ${source}`,
          timestamp: new Date().toISOString(),
          handler_timestamp: "",
          handler_thread_id: "",
        };

        await inboxStore.saveInbox(item);
        const retrieved = await inboxStore.getInboxItem(id);
        expect(retrieved?.source).toBe(source);
      }
    });
  });

  describe("content parsing", () => {
    it("should store and retrieve JSON content", async () => {
      const payload = {
        role: "user",
        parts: [{ type: "text", text: "Create a new automation" }],
        metadata: { scriptRunId: "run-123" },
      };

      const item: InboxItem = {
        id: "inbox-json",
        source: "user",
        source_id: "msg-1",
        target: "planner",
        target_id: "task-1",
        content: JSON.stringify(payload),
        timestamp: new Date().toISOString(),
        handler_timestamp: "",
        handler_thread_id: "",
      };

      await inboxStore.saveInbox(item);
      const retrieved = await inboxStore.getInboxItem("inbox-json");

      expect(retrieved).not.toBeNull();
      const parsedContent = JSON.parse(retrieved!.content);
      expect(parsedContent).toEqual(payload);
    });
  });
});
