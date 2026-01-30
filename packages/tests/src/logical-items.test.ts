import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { DBInterface, KeepDb, ItemStore } from "@app/db";
import { createDBNode } from "@app/node";
import { makeItemsListTool } from "@app/agent";

/**
 * Helper to create items table without full migration system.
 */
async function createItemsTable(db: DBInterface): Promise<void> {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS items (
      id TEXT PRIMARY KEY NOT NULL DEFAULT '',
      workflow_id TEXT NOT NULL DEFAULT '',
      logical_item_id TEXT NOT NULL DEFAULT '',
      title TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'processing',
      current_attempt_id INTEGER NOT NULL DEFAULT 1,
      created_by TEXT NOT NULL DEFAULT 'workflow',
      created_by_run_id TEXT NOT NULL DEFAULT '',
      last_run_id TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL DEFAULT 0,
      UNIQUE(workflow_id, logical_item_id)
    )
  `);
}

describe("ItemStore", () => {
  let db: DBInterface;
  let keepDb: KeepDb;
  let itemStore: ItemStore;

  beforeEach(async () => {
    db = await createDBNode(":memory:");
    keepDb = new KeepDb(db);
    await createItemsTable(db);
    itemStore = new ItemStore(keepDb);
  });

  afterEach(async () => {
    if (db) {
      await db.close();
    }
    vi.clearAllMocks();
  });

  describe("getItem", () => {
    it("should return null for non-existent item", async () => {
      const item = await itemStore.getItem("workflow-1", "item-1");
      expect(item).toBeNull();
    });

    it("should return item when it exists", async () => {
      // Create an item directly
      await db.exec(
        `INSERT INTO items (id, workflow_id, logical_item_id, title, status, current_attempt_id, created_by, created_by_run_id, last_run_id, created_at, updated_at)
         VALUES ('id-1', 'workflow-1', 'item-1', 'Test Item', 'done', 1, 'workflow', 'run-1', 'run-1', 1000, 1000)`
      );

      const item = await itemStore.getItem("workflow-1", "item-1");
      expect(item).not.toBeNull();
      expect(item?.id).toBe("id-1");
      expect(item?.workflow_id).toBe("workflow-1");
      expect(item?.logical_item_id).toBe("item-1");
      expect(item?.title).toBe("Test Item");
      expect(item?.status).toBe("done");
    });
  });

  describe("startItem", () => {
    it("should create new item with processing status", async () => {
      const item = await itemStore.startItem(
        "workflow-1",
        "item-1",
        "New Item",
        "workflow",
        "run-1"
      );

      expect(item.workflow_id).toBe("workflow-1");
      expect(item.logical_item_id).toBe("item-1");
      expect(item.title).toBe("New Item");
      expect(item.status).toBe("processing");
      expect(item.created_by).toBe("workflow");
      expect(item.created_by_run_id).toBe("run-1");
      expect(item.last_run_id).toBe("run-1");
      expect(item.current_attempt_id).toBe(1);
    });

    it("should return existing done item unchanged", async () => {
      // Create a done item
      await db.exec(
        `INSERT INTO items (id, workflow_id, logical_item_id, title, status, current_attempt_id, created_by, created_by_run_id, last_run_id, created_at, updated_at)
         VALUES ('id-1', 'workflow-1', 'item-1', 'Done Item', 'done', 1, 'workflow', 'run-1', 'run-1', 1000, 1000)`
      );

      const item = await itemStore.startItem(
        "workflow-1",
        "item-1",
        "Updated Title",
        "workflow",
        "run-2"
      );

      // Should return the done item unchanged
      expect(item.status).toBe("done");
      expect(item.title).toBe("Done Item"); // Title unchanged
      expect(item.last_run_id).toBe("run-1"); // Run ID unchanged
    });

    it("should reset failed item to processing for retry", async () => {
      // Create a failed item
      await db.exec(
        `INSERT INTO items (id, workflow_id, logical_item_id, title, status, current_attempt_id, created_by, created_by_run_id, last_run_id, created_at, updated_at)
         VALUES ('id-1', 'workflow-1', 'item-1', 'Failed Item', 'failed', 1, 'workflow', 'run-1', 'run-1', 1000, 1000)`
      );

      const item = await itemStore.startItem(
        "workflow-1",
        "item-1",
        "Retry Title",
        "workflow",
        "run-2"
      );

      // Should reset to processing
      expect(item.status).toBe("processing");
      expect(item.title).toBe("Retry Title"); // Title updated
      expect(item.last_run_id).toBe("run-2"); // Run ID updated
    });

    it("should reset skipped item to processing for retry", async () => {
      // Create a skipped item
      await db.exec(
        `INSERT INTO items (id, workflow_id, logical_item_id, title, status, current_attempt_id, created_by, created_by_run_id, last_run_id, created_at, updated_at)
         VALUES ('id-1', 'workflow-1', 'item-1', 'Skipped Item', 'skipped', 1, 'workflow', 'run-1', 'run-1', 1000, 1000)`
      );

      const item = await itemStore.startItem(
        "workflow-1",
        "item-1",
        "Retry Title",
        "workflow",
        "run-2"
      );

      expect(item.status).toBe("processing");
    });

    it("should support different created_by values", async () => {
      const plannerItem = await itemStore.startItem(
        "workflow-1",
        "item-1",
        "Planner Item",
        "planner",
        "run-1"
      );
      expect(plannerItem.created_by).toBe("planner");

      const maintainerItem = await itemStore.startItem(
        "workflow-2",
        "item-2",
        "Maintainer Item",
        "maintainer",
        "run-2"
      );
      expect(maintainerItem.created_by).toBe("maintainer");
    });
  });

  describe("setStatus", () => {
    it("should update item status to done", async () => {
      // Create an item
      await itemStore.startItem("workflow-1", "item-1", "Test", "workflow", "run-1");

      // Update status
      await itemStore.setStatus("workflow-1", "item-1", "done", "run-2");

      const item = await itemStore.getItem("workflow-1", "item-1");
      expect(item?.status).toBe("done");
      expect(item?.last_run_id).toBe("run-2");
    });

    it("should update item status to failed", async () => {
      await itemStore.startItem("workflow-1", "item-1", "Test", "workflow", "run-1");
      await itemStore.setStatus("workflow-1", "item-1", "failed", "run-2");

      const item = await itemStore.getItem("workflow-1", "item-1");
      expect(item?.status).toBe("failed");
    });

    it("should update item status to skipped", async () => {
      await itemStore.startItem("workflow-1", "item-1", "Test", "workflow", "run-1");
      await itemStore.setStatus("workflow-1", "item-1", "skipped", "run-2");

      const item = await itemStore.getItem("workflow-1", "item-1");
      expect(item?.status).toBe("skipped");
    });
  });

  describe("listItems", () => {
    beforeEach(async () => {
      // Create test items with different statuses
      await itemStore.startItem("workflow-1", "item-1", "Item 1", "workflow", "run-1");
      await itemStore.setStatus("workflow-1", "item-1", "done", "run-1");

      await itemStore.startItem("workflow-1", "item-2", "Item 2", "workflow", "run-1");
      await itemStore.setStatus("workflow-1", "item-2", "failed", "run-1");

      await itemStore.startItem("workflow-1", "item-3", "Item 3", "workflow", "run-1");
      // Keep as processing

      await itemStore.startItem("workflow-1", "item-4", "Item 4", "workflow", "run-1");
      await itemStore.setStatus("workflow-1", "item-4", "done", "run-1");
    });

    it("should list all items for a workflow", async () => {
      const items = await itemStore.listItems("workflow-1");
      expect(items).toHaveLength(4);
    });

    it("should filter items by status", async () => {
      const doneItems = await itemStore.listItems("workflow-1", { status: "done" });
      expect(doneItems).toHaveLength(2);
      expect(doneItems.every(i => i.status === "done")).toBe(true);

      const failedItems = await itemStore.listItems("workflow-1", { status: "failed" });
      expect(failedItems).toHaveLength(1);
      expect(failedItems[0].status).toBe("failed");

      const processingItems = await itemStore.listItems("workflow-1", { status: "processing" });
      expect(processingItems).toHaveLength(1);
    });

    it("should return empty array for different workflow", async () => {
      const items = await itemStore.listItems("workflow-other");
      expect(items).toHaveLength(0);
    });

    it("should support pagination with limit", async () => {
      const items = await itemStore.listItems("workflow-1", { limit: 2 });
      expect(items).toHaveLength(2);
    });

    it("should support pagination with offset", async () => {
      const page1 = await itemStore.listItems("workflow-1", { limit: 2, offset: 0 });
      const page2 = await itemStore.listItems("workflow-1", { limit: 2, offset: 2 });

      expect(page1).toHaveLength(2);
      expect(page2).toHaveLength(2);

      // Ensure no overlap
      const page1Ids = page1.map(i => i.id);
      const page2Ids = page2.map(i => i.id);
      expect(page1Ids.some(id => page2Ids.includes(id))).toBe(false);
    });
  });

  describe("countByStatus", () => {
    beforeEach(async () => {
      // Create test items
      await itemStore.startItem("workflow-1", "item-1", "Item 1", "workflow", "run-1");
      await itemStore.setStatus("workflow-1", "item-1", "done", "run-1");

      await itemStore.startItem("workflow-1", "item-2", "Item 2", "workflow", "run-1");
      await itemStore.setStatus("workflow-1", "item-2", "done", "run-1");

      await itemStore.startItem("workflow-1", "item-3", "Item 3", "workflow", "run-1");
      await itemStore.setStatus("workflow-1", "item-3", "failed", "run-1");

      await itemStore.startItem("workflow-1", "item-4", "Item 4", "workflow", "run-1");
      // Keep as processing
    });

    it("should count items by status", async () => {
      const counts = await itemStore.countByStatus("workflow-1");

      expect(counts.done).toBe(2);
      expect(counts.failed).toBe(1);
      expect(counts.processing).toBe(1);
      expect(counts.skipped).toBe(0);
    });

    it("should return zeros for empty workflow", async () => {
      const counts = await itemStore.countByStatus("workflow-empty");

      expect(counts.done).toBe(0);
      expect(counts.failed).toBe(0);
      expect(counts.processing).toBe(0);
      expect(counts.skipped).toBe(0);
    });
  });
});

describe("Items.list Tool", () => {
  let db: DBInterface;
  let keepDb: KeepDb;
  let itemStore: ItemStore;
  let workflowId: string;

  beforeEach(async () => {
    db = await createDBNode(":memory:");
    keepDb = new KeepDb(db);
    await createItemsTable(db);
    itemStore = new ItemStore(keepDb);
    workflowId = "workflow-test";
  });

  afterEach(async () => {
    if (db) {
      await db.close();
    }
    vi.clearAllMocks();
  });

  describe("basic functionality", () => {
    it("should require workflow context", async () => {
      const tool = makeItemsListTool(itemStore, () => undefined);

      await expect(
        tool.execute({})
      ).rejects.toThrow("Items.list requires a workflow context");
    });

    it("should return empty result for empty workflow", async () => {
      const tool = makeItemsListTool(itemStore, () => workflowId);

      const result = await tool.execute({});

      expect(result.items).toHaveLength(0);
      expect(result.total).toBe(0);
      expect(result.has_more).toBe(false);
    });

    it("should list items with correct structure", async () => {
      // Create an item
      await itemStore.startItem(workflowId, "item-1", "Test Item", "workflow", "run-1");
      await itemStore.setStatus(workflowId, "item-1", "done", "run-1");

      const tool = makeItemsListTool(itemStore, () => workflowId);
      const result = await tool.execute({});

      expect(result.items).toHaveLength(1);
      const item = result.items[0];
      expect(item.logical_item_id).toBe("item-1");
      expect(item.title).toBe("Test Item");
      expect(item.status).toBe("done");
      expect(item.current_attempt_id).toBe(1);
      expect(typeof item.created_at).toBe("number");
      expect(typeof item.updated_at).toBe("number");
    });
  });

  describe("filtering", () => {
    beforeEach(async () => {
      // Create test items
      await itemStore.startItem(workflowId, "item-1", "Done 1", "workflow", "run-1");
      await itemStore.setStatus(workflowId, "item-1", "done", "run-1");

      await itemStore.startItem(workflowId, "item-2", "Done 2", "workflow", "run-1");
      await itemStore.setStatus(workflowId, "item-2", "done", "run-1");

      await itemStore.startItem(workflowId, "item-3", "Failed", "workflow", "run-1");
      await itemStore.setStatus(workflowId, "item-3", "failed", "run-1");

      await itemStore.startItem(workflowId, "item-4", "Processing", "workflow", "run-1");
    });

    it("should filter by status", async () => {
      const tool = makeItemsListTool(itemStore, () => workflowId);

      const doneResult = await tool.execute({ status: "done" });
      expect(doneResult.items).toHaveLength(2);
      expect(doneResult.total).toBe(2);

      const failedResult = await tool.execute({ status: "failed" });
      expect(failedResult.items).toHaveLength(1);
      expect(failedResult.total).toBe(1);
    });

    it("should filter by logical_item_id", async () => {
      const tool = makeItemsListTool(itemStore, () => workflowId);

      const result = await tool.execute({ logical_item_id: "item-2" });

      expect(result.items).toHaveLength(1);
      expect(result.items[0].logical_item_id).toBe("item-2");
      expect(result.total).toBe(1);
    });

    it("should return empty for non-existent logical_item_id", async () => {
      const tool = makeItemsListTool(itemStore, () => workflowId);

      const result = await tool.execute({ logical_item_id: "non-existent" });

      expect(result.items).toHaveLength(0);
      expect(result.total).toBe(0);
    });

    it("should combine logical_item_id and status filters", async () => {
      const tool = makeItemsListTool(itemStore, () => workflowId);

      // Match: item-1 is done
      const matchResult = await tool.execute({ logical_item_id: "item-1", status: "done" });
      expect(matchResult.items).toHaveLength(1);

      // No match: item-3 is failed, not done
      const noMatchResult = await tool.execute({ logical_item_id: "item-3", status: "done" });
      expect(noMatchResult.items).toHaveLength(0);
    });
  });

  describe("pagination", () => {
    beforeEach(async () => {
      // Create many items
      for (let i = 1; i <= 150; i++) {
        await itemStore.startItem(workflowId, `item-${i}`, `Item ${i}`, "workflow", "run-1");
        await itemStore.setStatus(workflowId, `item-${i}`, "done", "run-1");
      }
    });

    it("should use default limit of 100", async () => {
      const tool = makeItemsListTool(itemStore, () => workflowId);

      const result = await tool.execute({});

      expect(result.items).toHaveLength(100);
      expect(result.total).toBe(150);
      expect(result.has_more).toBe(true);
    });

    it("should respect custom limit", async () => {
      const tool = makeItemsListTool(itemStore, () => workflowId);

      const result = await tool.execute({ limit: 50 });

      expect(result.items).toHaveLength(50);
      expect(result.has_more).toBe(true);
    });

    it("should support pagination with offset", async () => {
      const tool = makeItemsListTool(itemStore, () => workflowId);

      const page1 = await tool.execute({ limit: 50, offset: 0 });
      const page2 = await tool.execute({ limit: 50, offset: 50 });

      expect(page1.items).toHaveLength(50);
      expect(page2.items).toHaveLength(50);

      // Ensure different items
      const page1Ids = new Set(page1.items.map(i => i.logical_item_id));
      const page2Ids = new Set(page2.items.map(i => i.logical_item_id));
      const overlap = [...page1Ids].filter(id => page2Ids.has(id));
      expect(overlap).toHaveLength(0);
    });

    it("should report has_more correctly", async () => {
      const tool = makeItemsListTool(itemStore, () => workflowId);

      // Has more (150 items, limit 100)
      const hasMoreResult = await tool.execute({ limit: 100 });
      expect(hasMoreResult.has_more).toBe(true);

      // No more (offset 100, 50 remaining)
      const noMoreResult = await tool.execute({ limit: 100, offset: 100 });
      expect(noMoreResult.items).toHaveLength(50);
      expect(noMoreResult.has_more).toBe(false);
    });
  });
});

// NOTE: Sandbox callback tests are covered in sandbox.test.ts.
// The wrapGuestCallback implementation is tested there via host callbacks.
// Additional tests for the Items.withItem pattern with callbacks are skipped
// here due to QuickJS disposal issues with host closures that capture state.
// The core functionality (ItemStore, Items.list) is fully tested above.
