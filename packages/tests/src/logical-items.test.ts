/**
 * @deprecated This test file tests the deprecated Items infrastructure (exec-02).
 * These tests are skipped as Items.withItem() and Items.list have been removed.
 * The items table is kept for data preservation but the API is no longer available.
 *
 * Use the new Topics-based event-driven execution model instead.
 * See specs/exec-02-deprecate-items.md for details.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { DBInterface, KeepDb, ItemStore } from "@app/db";
import { createDBNode } from "@app/node";

// makeItemsListTool removed (exec-02) - stub for skipped tests type-checking
// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars
function makeItemsListTool(_itemStore: ItemStore, _getWorkflowId: () => string | undefined): any {
  throw new Error("makeItemsListTool removed in exec-02");
}

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

// Skip Items.list Tool tests - tool removed in exec-02
describe.skip("Items.list Tool", () => {
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
      const page1Ids = new Set(page1.items.map((i: { logical_item_id: string }) => i.logical_item_id));
      const page2Ids = new Set(page2.items.map((i: { logical_item_id: string }) => i.logical_item_id));
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

// Skip Mutation Enforcement tests - Items.withItem removed in exec-02
// Phase-based restrictions will be tested in exec-04 (phase-tracking.test.ts)
describe.skip("Mutation Enforcement", () => {
  // Tests for SandboxAPI.enforceMutationRestrictions()
  // These test the enforcement logic at the SandboxAPI level without full QuickJS sandbox

  let db: DBInterface;
  let keepDb: KeepDb;
  let itemStore: ItemStore;
  let api: any;
  let global: any;
  let abortController: AbortController;
  let evalContext: any;

  beforeEach(async () => {
    db = await createDBNode(":memory:");
    keepDb = new KeepDb(db);
    await createItemsTable(db);
    itemStore = new ItemStore(keepDb);
    abortController = new AbortController();

    // Create a minimal EvalContext mock
    evalContext = {
      classifiedError: null,
      createEvent: vi.fn().mockResolvedValue(undefined),
      scriptRunId: "test-run-1",
    };

    // Create mock API with itemStore
    api = {
      itemStore,
      noteStore: {
        validateCreateNote: vi.fn().mockResolvedValue(undefined),
        createNote: vi.fn().mockResolvedValue(undefined),
        getNote: vi.fn().mockResolvedValue(null),
      },
      scriptStore: {
        getWorkflow: vi.fn().mockResolvedValue({ status: 'active' }),
      },
      fileStore: {},
    };
  });

  afterEach(async () => {
    if (db) {
      await db.close();
    }
    vi.clearAllMocks();
  });

  describe("mutations outside Items.withItem()", () => {
    it("should abort when mutation called outside withItem in workflow mode", async () => {
      // Import SandboxAPI and create instance with workflow context
      const { SandboxAPI } = await import("@app/agent");

      const sandboxAPI = new SandboxAPI({
        api,
        type: "workflow",
        getContext: () => evalContext,
        workflowId: "workflow-1",
        scriptRunId: "run-1",
        abortController,
      });

      global = await sandboxAPI.createGlobal();

      // Try to call a mutation (createNote) outside of withItem
      await expect(
        global.Memory.createNote({ id: "test", title: "Test", content: "Content" })
      ).rejects.toThrow("must be called inside Items.withItem()");

      // Verify abort was triggered
      expect(abortController.signal.aborted).toBe(true);
    });

    it("should allow Console.log outside withItem as exception", async () => {
      const { SandboxAPI } = await import("@app/agent");

      // Add onLog to context for Console.log to work
      evalContext.onLog = vi.fn();

      const sandboxAPI = new SandboxAPI({
        api,
        type: "workflow",
        getContext: () => evalContext,
        workflowId: "workflow-1",
        scriptRunId: "run-1",
        abortController,
      });

      global = await sandboxAPI.createGlobal();

      // Console.log should work outside withItem
      await expect(
        global.Console.log({ type: "log", line: "Test message" })
      ).resolves.not.toThrow();

      // Abort should NOT have been triggered
      expect(abortController.signal.aborted).toBe(false);

      // Verify onLog was called
      expect(evalContext.onLog).toHaveBeenCalled();
    });

    it("should allow read-only tools outside withItem", async () => {
      const { SandboxAPI } = await import("@app/agent");

      // Mock getNote to return a note (simulating a read operation that works)
      api.noteStore.getNote = vi.fn().mockResolvedValue({
        id: "test-note",
        title: "Test",
        content: "Content",
        tags: [],
        priority: "low",
        created: new Date().toISOString(),
        updated: new Date().toISOString(),
      });

      const sandboxAPI = new SandboxAPI({
        api,
        type: "workflow",
        getContext: () => evalContext,
        workflowId: "workflow-1",
        scriptRunId: "run-1",
        abortController,
      });

      global = await sandboxAPI.createGlobal();

      // Memory.getNote is read-only, should work outside withItem
      // The key is that it doesn't trigger mutation enforcement (no abort)
      const result = await global.Memory.getNote({ id: "test-note" });
      expect(result).toBeDefined();

      // Abort should NOT have been triggered
      expect(abortController.signal.aborted).toBe(false);
    });
  });

  describe("mutations inside Items.withItem()", () => {
    it("should allow mutations inside withItem scope", async () => {
      const { SandboxAPI } = await import("@app/agent");

      const sandboxAPI = new SandboxAPI({
        api,
        type: "workflow",
        getContext: () => evalContext,
        workflowId: "workflow-1",
        scriptRunId: "run-1",
        abortController,
      });

      global = await sandboxAPI.createGlobal();

      // Call mutation inside withItem - should succeed
      await global.Items.withItem(
        "item-1",
        "Test Item",
        async () => {
          await global.Memory.createNote({ id: "test", title: "Test", content: "Content" });
          return "done";
        }
      );

      // Verify note was created
      expect(api.noteStore.createNote).toHaveBeenCalled();

      // Abort should NOT have been triggered
      expect(abortController.signal.aborted).toBe(false);
    });

    it("should block mutations on completed items (isDone=true)", async () => {
      const { SandboxAPI } = await import("@app/agent");

      // Pre-create a done item
      await db.exec(
        `INSERT INTO items (id, workflow_id, logical_item_id, title, status, current_attempt_id, created_by, created_by_run_id, last_run_id, created_at, updated_at)
         VALUES ('id-1', 'workflow-1', 'item-1', 'Done Item', 'done', 1, 'workflow', 'run-1', 'run-1', 1000, 1000)`
      );

      const sandboxAPI = new SandboxAPI({
        api,
        type: "workflow",
        getContext: () => evalContext,
        workflowId: "workflow-1",
        scriptRunId: "run-2",
        abortController,
      });

      global = await sandboxAPI.createGlobal();

      // Call mutation inside withItem for a done item - should fail
      await expect(
        global.Items.withItem(
          "item-1", // This item is already done
          "Done Item",
          async (ctx: any) => {
            // Handler receives isDone=true, but try to mutate anyway
            await global.Memory.createNote({ id: "test", title: "Test", content: "Content" });
          }
        )
      ).rejects.toThrow("cannot perform mutations on completed item");

      // Verify note was NOT created
      expect(api.noteStore.createNote).not.toHaveBeenCalled();
    });
  });

  describe("Items.withItem validation", () => {
    it("should reject empty id", async () => {
      const { SandboxAPI } = await import("@app/agent");

      const sandboxAPI = new SandboxAPI({
        api,
        type: "workflow",
        getContext: () => evalContext,
        workflowId: "workflow-1",
        scriptRunId: "run-1",
        abortController,
      });

      global = await sandboxAPI.createGlobal();

      await expect(
        global.Items.withItem("", "Title", async () => {})
      ).rejects.toThrow("id must be a non-empty string");
    });

    it("should reject empty title", async () => {
      const { SandboxAPI } = await import("@app/agent");

      const sandboxAPI = new SandboxAPI({
        api,
        type: "workflow",
        getContext: () => evalContext,
        workflowId: "workflow-1",
        scriptRunId: "run-1",
        abortController,
      });

      global = await sandboxAPI.createGlobal();

      await expect(
        global.Items.withItem("item-1", "", async () => {})
      ).rejects.toThrow("title must be a non-empty string");
    });

    it("should reject non-function handler", async () => {
      const { SandboxAPI } = await import("@app/agent");

      const sandboxAPI = new SandboxAPI({
        api,
        type: "workflow",
        getContext: () => evalContext,
        workflowId: "workflow-1",
        scriptRunId: "run-1",
        abortController,
      });

      global = await sandboxAPI.createGlobal();

      await expect(
        global.Items.withItem("item-1", "Title", "not a function" as any)
      ).rejects.toThrow("handler must be a function");
    });

    it("should reject nested withItem calls", async () => {
      const { SandboxAPI } = await import("@app/agent");

      const sandboxAPI = new SandboxAPI({
        api,
        type: "workflow",
        getContext: () => evalContext,
        workflowId: "workflow-1",
        scriptRunId: "run-1",
        abortController,
      });

      global = await sandboxAPI.createGlobal();

      await expect(
        global.Items.withItem("outer", "Outer Item", async () => {
          // Try to nest another withItem call
          await global.Items.withItem("inner", "Inner Item", async () => {});
        })
      ).rejects.toThrow("cannot nest or run concurrent withItem calls");
    });

    it("should require workflow context", async () => {
      const { SandboxAPI } = await import("@app/agent");

      // Create without workflowId
      const sandboxAPI = new SandboxAPI({
        api,
        type: "planner",
        getContext: () => evalContext,
        // No workflowId
        abortController,
      });

      global = await sandboxAPI.createGlobal();

      await expect(
        global.Items.withItem("item-1", "Title", async () => {})
      ).rejects.toThrow("no workflow context");
    });
  });

  describe("no enforcement in non-workflow mode", () => {
    it("should allow mutations outside withItem in planner mode (no workflowId)", async () => {
      const { SandboxAPI } = await import("@app/agent");

      // Create SandboxAPI without workflowId (task mode)
      const sandboxAPI = new SandboxAPI({
        api,
        type: "planner",
        getContext: () => evalContext,
        // No workflowId means no enforcement
        abortController,
      });

      global = await sandboxAPI.createGlobal();

      // Mutation outside withItem should work (no enforcement without workflowId)
      await expect(
        global.Memory.createNote({ id: "test", title: "Test", content: "Content" })
      ).resolves.not.toThrow();

      // Abort should NOT have been triggered
      expect(abortController.signal.aborted).toBe(false);
    });
  });

  describe("item state tracking", () => {
    it("should mark new item as done on successful handler completion", async () => {
      const { SandboxAPI } = await import("@app/agent");

      const sandboxAPI = new SandboxAPI({
        api,
        type: "workflow",
        getContext: () => evalContext,
        workflowId: "workflow-1",
        scriptRunId: "run-1",
        abortController,
      });

      global = await sandboxAPI.createGlobal();

      await global.Items.withItem("item-1", "Test Item", async (ctx: any) => {
        expect(ctx.item.isDone).toBe(false);
        return "completed";
      });

      // Verify item is now done
      const item = await itemStore.getItem("workflow-1", "item-1");
      expect(item?.status).toBe("done");
    });

    it("should mark new item as failed on handler error", async () => {
      const { SandboxAPI } = await import("@app/agent");

      const sandboxAPI = new SandboxAPI({
        api,
        type: "workflow",
        getContext: () => evalContext,
        workflowId: "workflow-1",
        scriptRunId: "run-1",
        abortController,
      });

      global = await sandboxAPI.createGlobal();

      await expect(
        global.Items.withItem("item-1", "Test Item", async () => {
          throw new Error("Handler failed");
        })
      ).rejects.toThrow("Handler failed");

      // Verify item is marked failed
      const item = await itemStore.getItem("workflow-1", "item-1");
      expect(item?.status).toBe("failed");
    });

    it("should not update status for already-done items", async () => {
      const { SandboxAPI } = await import("@app/agent");

      // Pre-create a done item
      await db.exec(
        `INSERT INTO items (id, workflow_id, logical_item_id, title, status, current_attempt_id, created_by, created_by_run_id, last_run_id, created_at, updated_at)
         VALUES ('id-1', 'workflow-1', 'item-1', 'Done Item', 'done', 1, 'workflow', 'run-1', 'run-1', 1000, 1000)`
      );

      const sandboxAPI = new SandboxAPI({
        api,
        type: "workflow",
        getContext: () => evalContext,
        workflowId: "workflow-1",
        scriptRunId: "run-2",
        abortController,
      });

      global = await sandboxAPI.createGlobal();

      // Run withItem on already-done item (no mutations, just checking isDone)
      let sawIsDone = false;
      await global.Items.withItem("item-1", "Done Item", async (ctx: any) => {
        sawIsDone = ctx.item.isDone;
        // Don't do any mutations
        return "skipped";
      });

      expect(sawIsDone).toBe(true);

      // Verify status is still done and last_run_id not changed
      const item = await itemStore.getItem("workflow-1", "item-1");
      expect(item?.status).toBe("done");
      expect(item?.last_run_id).toBe("run-1"); // Unchanged
    });
  });
});
