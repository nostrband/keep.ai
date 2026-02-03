import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DBInterface, KeepDb, HandlerStateStore, HandlerState } from "@app/db";
import { createDBNode } from "@app/node";

/**
 * Helper to create handler_state table without full migration system.
 * Schema matches packages/db/src/migrations/v36.ts
 */
async function createHandlerStateTable(db: DBInterface): Promise<void> {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS handler_state (
      id TEXT PRIMARY KEY NOT NULL DEFAULT '',
      workflow_id TEXT NOT NULL DEFAULT '',
      handler_name TEXT NOT NULL DEFAULT '',
      state TEXT NOT NULL DEFAULT '{}',
      updated_at INTEGER NOT NULL DEFAULT 0,
      updated_by_run_id TEXT NOT NULL DEFAULT '',
      UNIQUE(workflow_id, handler_name)
    )
  `);
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_handler_state_workflow ON handler_state(workflow_id)`);
}

describe("HandlerStateStore", () => {
  let db: DBInterface;
  let keepDb: KeepDb;
  let handlerStateStore: HandlerStateStore;

  beforeEach(async () => {
    db = await createDBNode(":memory:");
    keepDb = new KeepDb(db);
    await createHandlerStateTable(db);
    handlerStateStore = new HandlerStateStore(keepDb);
  });

  afterEach(async () => {
    if (db) {
      await db.close();
    }
  });

  describe("set and get", () => {
    it("should set and get handler state", async () => {
      await handlerStateStore.set(
        "workflow-1",
        "checkEmails",
        { lastChecked: "2025-01-01", counter: 5 },
        "run-1"
      );

      const state = await handlerStateStore.get("workflow-1", "checkEmails");

      expect(state).toEqual({ lastChecked: "2025-01-01", counter: 5 });
    });

    it("should return null for non-existent state", async () => {
      const state = await handlerStateStore.get("workflow-1", "checkEmails");
      expect(state).toBeNull();
    });

    it("should update existing state", async () => {
      await handlerStateStore.set(
        "workflow-1",
        "checkEmails",
        { counter: 1 },
        "run-1"
      );

      await handlerStateStore.set(
        "workflow-1",
        "checkEmails",
        { counter: 2 },
        "run-2"
      );

      const state = await handlerStateStore.get("workflow-1", "checkEmails");
      expect(state).toEqual({ counter: 2 });
    });

    it("should handle different handlers in same workflow", async () => {
      await handlerStateStore.set(
        "workflow-1",
        "producer",
        { producerState: true },
        "run-1"
      );

      await handlerStateStore.set(
        "workflow-1",
        "consumer",
        { consumerState: true },
        "run-2"
      );

      const producerState = await handlerStateStore.get("workflow-1", "producer");
      const consumerState = await handlerStateStore.get("workflow-1", "consumer");

      expect(producerState).toEqual({ producerState: true });
      expect(consumerState).toEqual({ consumerState: true });
    });

    it("should handle same handler name in different workflows", async () => {
      await handlerStateStore.set(
        "workflow-1",
        "checkEmails",
        { state: "workflow1" },
        "run-1"
      );

      await handlerStateStore.set(
        "workflow-2",
        "checkEmails",
        { state: "workflow2" },
        "run-2"
      );

      const state1 = await handlerStateStore.get("workflow-1", "checkEmails");
      const state2 = await handlerStateStore.get("workflow-2", "checkEmails");

      expect(state1).toEqual({ state: "workflow1" });
      expect(state2).toEqual({ state: "workflow2" });
    });
  });

  describe("getRecord", () => {
    it("should return full handler state record", async () => {
      const beforeSet = Date.now();
      await handlerStateStore.set(
        "workflow-1",
        "checkEmails",
        { counter: 5 },
        "run-1"
      );

      const record = await handlerStateStore.getRecord("workflow-1", "checkEmails");

      expect(record).toBeDefined();
      expect(record?.id).toBeDefined();
      expect(record?.workflow_id).toBe("workflow-1");
      expect(record?.handler_name).toBe("checkEmails");
      expect(record?.state).toEqual({ counter: 5 });
      expect(record?.updated_at).toBeGreaterThanOrEqual(beforeSet);
      expect(record?.updated_by_run_id).toBe("run-1");
    });

    it("should return null for non-existent record", async () => {
      const record = await handlerStateStore.getRecord("workflow-1", "checkEmails");
      expect(record).toBeNull();
    });

    it("should update updated_by_run_id on update", async () => {
      await handlerStateStore.set("workflow-1", "checkEmails", { counter: 1 }, "run-1");
      await handlerStateStore.set("workflow-1", "checkEmails", { counter: 2 }, "run-2");

      const record = await handlerStateStore.getRecord("workflow-1", "checkEmails");
      expect(record?.updated_by_run_id).toBe("run-2");
    });
  });

  describe("delete", () => {
    it("should delete handler state by workflow and handler name", async () => {
      await handlerStateStore.set("workflow-1", "checkEmails", { counter: 5 }, "run-1");
      await handlerStateStore.set("workflow-1", "processEmail", { processed: true }, "run-1");

      await handlerStateStore.delete("workflow-1", "checkEmails");

      const deletedState = await handlerStateStore.get("workflow-1", "checkEmails");
      const remainingState = await handlerStateStore.get("workflow-1", "processEmail");

      expect(deletedState).toBeNull();
      expect(remainingState).toEqual({ processed: true });
    });

    it("should not throw for non-existent state", async () => {
      await expect(
        handlerStateStore.delete("workflow-1", "nonexistent")
      ).resolves.not.toThrow();
    });
  });

  describe("deleteByWorkflow", () => {
    it("should delete all handler states for a workflow", async () => {
      await handlerStateStore.set("workflow-1", "producer", { state: 1 }, "run-1");
      await handlerStateStore.set("workflow-1", "consumer", { state: 2 }, "run-1");
      await handlerStateStore.set("workflow-2", "producer", { state: 3 }, "run-2");

      await handlerStateStore.deleteByWorkflow("workflow-1");

      const states1 = await handlerStateStore.listByWorkflow("workflow-1");
      const states2 = await handlerStateStore.listByWorkflow("workflow-2");

      expect(states1).toHaveLength(0);
      expect(states2).toHaveLength(1);
    });
  });

  describe("listByWorkflow", () => {
    it("should list all handler states for a workflow", async () => {
      await handlerStateStore.set("workflow-1", "producer", { state: 1 }, "run-1");
      await handlerStateStore.set("workflow-1", "consumer", { state: 2 }, "run-1");
      await handlerStateStore.set("workflow-2", "producer", { state: 3 }, "run-2");

      const states = await handlerStateStore.listByWorkflow("workflow-1");

      expect(states).toHaveLength(2);
      expect(states.map(s => s.handler_name).sort()).toEqual(["consumer", "producer"]);
    });

    it("should order by handler_name", async () => {
      await handlerStateStore.set("workflow-1", "zebra", { state: 1 }, "run-1");
      await handlerStateStore.set("workflow-1", "alpha", { state: 2 }, "run-1");
      await handlerStateStore.set("workflow-1", "beta", { state: 3 }, "run-1");

      const states = await handlerStateStore.listByWorkflow("workflow-1");

      expect(states.map(s => s.handler_name)).toEqual(["alpha", "beta", "zebra"]);
    });

    it("should return empty array for workflow with no states", async () => {
      const states = await handlerStateStore.listByWorkflow("workflow-1");
      expect(states).toEqual([]);
    });
  });

  describe("JSON state handling", () => {
    it("should handle complex nested state", async () => {
      const complexState = {
        nested: { deep: { value: 123 } },
        array: [1, 2, { three: 3 }],
        null: null,
        boolean: true,
        number: 42.5,
      };

      await handlerStateStore.set("workflow-1", "handler", complexState, "run-1");

      const state = await handlerStateStore.get("workflow-1", "handler");
      expect(state).toEqual(complexState);
    });

    it("should handle empty object state", async () => {
      await handlerStateStore.set("workflow-1", "handler", {}, "run-1");

      const state = await handlerStateStore.get("workflow-1", "handler");
      expect(state).toEqual({});
    });

    it("should handle null state", async () => {
      await handlerStateStore.set("workflow-1", "handler", null, "run-1");

      const state = await handlerStateStore.get("workflow-1", "handler");
      expect(state).toBeNull();
    });

    it("should handle array state", async () => {
      const arrayState = [1, "two", { three: 3 }];

      await handlerStateStore.set("workflow-1", "handler", arrayState, "run-1");

      const state = await handlerStateStore.get("workflow-1", "handler");
      expect(state).toEqual(arrayState);
    });

    it("should handle primitive state values", async () => {
      await handlerStateStore.set("workflow-1", "string", "hello", "run-1");
      await handlerStateStore.set("workflow-1", "number", 42, "run-2");
      await handlerStateStore.set("workflow-1", "boolean", true, "run-3");

      expect(await handlerStateStore.get("workflow-1", "string")).toBe("hello");
      expect(await handlerStateStore.get("workflow-1", "number")).toBe(42);
      expect(await handlerStateStore.get("workflow-1", "boolean")).toBe(true);
    });
  });

  describe("idempotency", () => {
    it("should maintain same ID on update", async () => {
      await handlerStateStore.set("workflow-1", "handler", { v: 1 }, "run-1");
      const record1 = await handlerStateStore.getRecord("workflow-1", "handler");

      await handlerStateStore.set("workflow-1", "handler", { v: 2 }, "run-2");
      const record2 = await handlerStateStore.getRecord("workflow-1", "handler");

      expect(record1?.id).toBe(record2?.id);
    });

    it("should update timestamp on update", async () => {
      await handlerStateStore.set("workflow-1", "handler", { v: 1 }, "run-1");
      const record1 = await handlerStateStore.getRecord("workflow-1", "handler");

      await new Promise(resolve => setTimeout(resolve, 10));

      await handlerStateStore.set("workflow-1", "handler", { v: 2 }, "run-2");
      const record2 = await handlerStateStore.getRecord("workflow-1", "handler");

      expect(record2?.updated_at).toBeGreaterThan(record1?.updated_at ?? 0);
    });
  });
});
