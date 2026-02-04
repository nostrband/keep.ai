import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  DBInterface,
  KeepDb,
  MutationStore,
  Mutation,
  MutationStatus,
} from "@app/db";
import { createDBNode } from "@app/node";

/**
 * Helper to create mutations table without full migration system.
 * Schema matches packages/db/src/migrations/v36.ts
 */
async function createMutationsTable(db: DBInterface): Promise<void> {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS mutations (
      id TEXT PRIMARY KEY NOT NULL DEFAULT '',
      handler_run_id TEXT NOT NULL DEFAULT '' UNIQUE,
      workflow_id TEXT NOT NULL DEFAULT '',
      tool_namespace TEXT NOT NULL DEFAULT '',
      tool_method TEXT NOT NULL DEFAULT '',
      params TEXT NOT NULL DEFAULT '',
      idempotency_key TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pending',
      result TEXT NOT NULL DEFAULT '',
      error TEXT NOT NULL DEFAULT '',
      reconcile_attempts INTEGER NOT NULL DEFAULT 0,
      last_reconcile_at INTEGER NOT NULL DEFAULT 0,
      next_reconcile_at INTEGER NOT NULL DEFAULT 0,
      resolved_by TEXT NOT NULL DEFAULT '',
      resolved_at INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL DEFAULT 0
    )
  `);
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_mutations_handler_run ON mutations(handler_run_id)`);
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_mutations_workflow ON mutations(workflow_id)`);
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_mutations_status ON mutations(status)`);
}

describe("MutationStore", () => {
  let db: DBInterface;
  let keepDb: KeepDb;
  let mutationStore: MutationStore;

  beforeEach(async () => {
    db = await createDBNode(":memory:");
    keepDb = new KeepDb(db);
    await createMutationsTable(db);
    mutationStore = new MutationStore(keepDb);
  });

  afterEach(async () => {
    if (db) {
      await db.close();
    }
  });

  describe("create", () => {
    it("should create a mutation record", async () => {
      const mutation = await mutationStore.create({
        handler_run_id: "run-1",
        workflow_id: "workflow-1",
      });

      expect(mutation).toBeDefined();
      expect(mutation.id).toBeDefined();
      expect(mutation.handler_run_id).toBe("run-1");
      expect(mutation.workflow_id).toBe("workflow-1");
      expect(mutation.status).toBe("pending");
      expect(mutation.tool_namespace).toBe("");
      expect(mutation.tool_method).toBe("");
      expect(mutation.params).toBe("");
      expect(mutation.idempotency_key).toBe("");
      expect(mutation.result).toBe("");
      expect(mutation.error).toBe("");
      expect(mutation.reconcile_attempts).toBe(0);
      expect(mutation.created_at).toBeGreaterThan(0);
    });

    it("should enforce unique handler_run_id", async () => {
      await mutationStore.create({
        handler_run_id: "run-1",
        workflow_id: "workflow-1",
      });

      await expect(mutationStore.create({
        handler_run_id: "run-1",
        workflow_id: "workflow-1",
      })).rejects.toThrow();
    });
  });

  describe("get", () => {
    it("should return mutation by ID", async () => {
      const created = await mutationStore.create({
        handler_run_id: "run-1",
        workflow_id: "workflow-1",
      });

      const mutation = await mutationStore.get(created.id);

      expect(mutation).toEqual(created);
    });

    it("should return null for non-existent ID", async () => {
      const mutation = await mutationStore.get("non-existent");
      expect(mutation).toBeNull();
    });
  });

  describe("getByHandlerRunId", () => {
    it("should return mutation by handler run ID", async () => {
      const created = await mutationStore.create({
        handler_run_id: "run-1",
        workflow_id: "workflow-1",
      });

      const mutation = await mutationStore.getByHandlerRunId("run-1");

      expect(mutation).toEqual(created);
    });

    it("should return null for non-existent handler run ID", async () => {
      const mutation = await mutationStore.getByHandlerRunId("non-existent");
      expect(mutation).toBeNull();
    });
  });

  describe("update", () => {
    it("should update status", async () => {
      const mutation = await mutationStore.create({
        handler_run_id: "run-1",
        workflow_id: "workflow-1",
      });

      // Small delay to ensure different timestamp
      await new Promise(resolve => setTimeout(resolve, 10));

      await mutationStore.update(mutation.id, { status: "in_flight" });

      const updated = await mutationStore.get(mutation.id);
      expect(updated?.status).toBe("in_flight");
      expect(updated?.updated_at).toBeGreaterThan(mutation.updated_at);
    });

    it("should update multiple fields", async () => {
      const mutation = await mutationStore.create({
        handler_run_id: "run-1",
        workflow_id: "workflow-1",
      });

      await mutationStore.update(mutation.id, {
        tool_namespace: "Gmail",
        tool_method: "sendEmail",
        params: JSON.stringify({ to: "test@example.com" }),
        status: "applied",
        result: JSON.stringify({ messageId: "123" }),
      });

      const updated = await mutationStore.get(mutation.id);
      expect(updated?.tool_namespace).toBe("Gmail");
      expect(updated?.tool_method).toBe("sendEmail");
      expect(updated?.params).toBe(JSON.stringify({ to: "test@example.com" }));
      expect(updated?.status).toBe("applied");
      expect(updated?.result).toBe(JSON.stringify({ messageId: "123" }));
    });

    it("should update reconciliation fields", async () => {
      const mutation = await mutationStore.create({
        handler_run_id: "run-1",
        workflow_id: "workflow-1",
      });

      const now = Date.now();
      await mutationStore.update(mutation.id, {
        reconcile_attempts: 3,
        last_reconcile_at: now,
        next_reconcile_at: now + 60000,
      });

      const updated = await mutationStore.get(mutation.id);
      expect(updated?.reconcile_attempts).toBe(3);
      expect(updated?.last_reconcile_at).toBe(now);
      expect(updated?.next_reconcile_at).toBe(now + 60000);
    });
  });

  describe("markInFlight", () => {
    it("should mark mutation as in_flight with tool info", async () => {
      const mutation = await mutationStore.create({
        handler_run_id: "run-1",
        workflow_id: "workflow-1",
      });

      await mutationStore.markInFlight(mutation.id, {
        tool_namespace: "Gmail",
        tool_method: "sendEmail",
        params: JSON.stringify({ to: "test@example.com" }),
        idempotency_key: "email-123",
      });

      const updated = await mutationStore.get(mutation.id);
      expect(updated?.status).toBe("in_flight");
      expect(updated?.tool_namespace).toBe("Gmail");
      expect(updated?.tool_method).toBe("sendEmail");
      expect(updated?.params).toBe(JSON.stringify({ to: "test@example.com" }));
      expect(updated?.idempotency_key).toBe("email-123");
    });

    it("should handle missing idempotency_key", async () => {
      const mutation = await mutationStore.create({
        handler_run_id: "run-1",
        workflow_id: "workflow-1",
      });

      await mutationStore.markInFlight(mutation.id, {
        tool_namespace: "Gmail",
        tool_method: "sendEmail",
        params: "{}",
      });

      const updated = await mutationStore.get(mutation.id);
      expect(updated?.idempotency_key).toBe("");
    });
  });

  describe("markApplied", () => {
    it("should mark mutation as applied with result", async () => {
      const mutation = await mutationStore.create({
        handler_run_id: "run-1",
        workflow_id: "workflow-1",
      });

      const result = JSON.stringify({ success: true, messageId: "123" });
      await mutationStore.markApplied(mutation.id, result);

      const updated = await mutationStore.get(mutation.id);
      expect(updated?.status).toBe("applied");
      expect(updated?.result).toBe(result);
    });
  });

  describe("markFailed", () => {
    it("should mark mutation as failed with error", async () => {
      const mutation = await mutationStore.create({
        handler_run_id: "run-1",
        workflow_id: "workflow-1",
      });

      await mutationStore.markFailed(mutation.id, "Invalid recipient address");

      const updated = await mutationStore.get(mutation.id);
      expect(updated?.status).toBe("failed");
      expect(updated?.error).toBe("Invalid recipient address");
    });
  });

  describe("markIndeterminate", () => {
    it("should mark mutation as indeterminate with error", async () => {
      const mutation = await mutationStore.create({
        handler_run_id: "run-1",
        workflow_id: "workflow-1",
      });

      await mutationStore.markIndeterminate(mutation.id, "Process crashed during external call");

      const updated = await mutationStore.get(mutation.id);
      expect(updated?.status).toBe("indeterminate");
      expect(updated?.error).toBe("Process crashed during external call");
    });
  });

  describe("resolve", () => {
    it("should resolve an indeterminate mutation with user_skip", async () => {
      const mutation = await mutationStore.create({
        handler_run_id: "run-1",
        workflow_id: "workflow-1",
      });
      await mutationStore.markIndeterminate(mutation.id, "Process crashed");

      const beforeResolve = Date.now();
      await mutationStore.resolve(mutation.id, "user_skip");

      const resolved = await mutationStore.get(mutation.id);
      expect(resolved?.resolved_by).toBe("user_skip");
      expect(resolved?.resolved_at).toBeGreaterThanOrEqual(beforeResolve);
    });

    it("should resolve with user_retry", async () => {
      const mutation = await mutationStore.create({
        handler_run_id: "run-1",
        workflow_id: "workflow-1",
      });
      await mutationStore.markIndeterminate(mutation.id, "Process crashed");

      await mutationStore.resolve(mutation.id, "user_retry");

      const resolved = await mutationStore.get(mutation.id);
      expect(resolved?.resolved_by).toBe("user_retry");
    });

    it("should resolve with user_assert_failed", async () => {
      const mutation = await mutationStore.create({
        handler_run_id: "run-1",
        workflow_id: "workflow-1",
      });
      await mutationStore.markIndeterminate(mutation.id, "Process crashed");

      await mutationStore.resolve(mutation.id, "user_assert_failed");

      const resolved = await mutationStore.get(mutation.id);
      expect(resolved?.resolved_by).toBe("user_assert_failed");
    });
  });

  describe("getByWorkflow", () => {
    it("should return mutations for a workflow", async () => {
      await mutationStore.create({ handler_run_id: "run-1", workflow_id: "workflow-1" });
      await mutationStore.create({ handler_run_id: "run-2", workflow_id: "workflow-1" });
      await mutationStore.create({ handler_run_id: "run-3", workflow_id: "workflow-2" });

      const mutations = await mutationStore.getByWorkflow("workflow-1");

      expect(mutations).toHaveLength(2);
    });

    it("should filter by status", async () => {
      const m1 = await mutationStore.create({ handler_run_id: "run-1", workflow_id: "workflow-1" });
      const m2 = await mutationStore.create({ handler_run_id: "run-2", workflow_id: "workflow-1" });
      await mutationStore.markApplied(m1.id, "{}");
      await mutationStore.markFailed(m2.id, "error");

      const applied = await mutationStore.getByWorkflow("workflow-1", { status: "applied" });
      const failed = await mutationStore.getByWorkflow("workflow-1", { status: "failed" });

      expect(applied).toHaveLength(1);
      expect(failed).toHaveLength(1);
    });

    it("should order by created_at DESC", async () => {
      await mutationStore.create({ handler_run_id: "run-1", workflow_id: "workflow-1" });
      await new Promise(resolve => setTimeout(resolve, 10));
      await mutationStore.create({ handler_run_id: "run-2", workflow_id: "workflow-1" });

      const mutations = await mutationStore.getByWorkflow("workflow-1");

      // Most recent first
      expect(mutations[0].handler_run_id).toBe("run-2");
      expect(mutations[1].handler_run_id).toBe("run-1");
    });

    it("should respect limit option", async () => {
      await mutationStore.create({ handler_run_id: "run-1", workflow_id: "workflow-1" });
      await mutationStore.create({ handler_run_id: "run-2", workflow_id: "workflow-1" });
      await mutationStore.create({ handler_run_id: "run-3", workflow_id: "workflow-1" });

      const mutations = await mutationStore.getByWorkflow("workflow-1", { limit: 2 });

      expect(mutations).toHaveLength(2);
    });
  });

  describe("getIndeterminate", () => {
    it("should return unresolved indeterminate mutations", async () => {
      const m1 = await mutationStore.create({ handler_run_id: "run-1", workflow_id: "workflow-1" });
      await mutationStore.markIndeterminate(m1.id, "crash 1");

      const m2 = await mutationStore.create({ handler_run_id: "run-2", workflow_id: "workflow-1" });
      await mutationStore.markIndeterminate(m2.id, "crash 2");
      await mutationStore.resolve(m2.id, "user_skip");

      const m3 = await mutationStore.create({ handler_run_id: "run-3", workflow_id: "workflow-2" });
      await mutationStore.markIndeterminate(m3.id, "crash 3");

      const indeterminate = await mutationStore.getIndeterminate();

      expect(indeterminate).toHaveLength(2);
      expect(indeterminate.map(m => m.handler_run_id).sort()).toEqual(["run-1", "run-3"]);
    });

    it("should return empty array when no indeterminate mutations", async () => {
      await mutationStore.create({ handler_run_id: "run-1", workflow_id: "workflow-1" });

      const indeterminate = await mutationStore.getIndeterminate();
      expect(indeterminate).toEqual([]);
    });
  });

  describe("deleteByHandlerRun", () => {
    it("should delete mutation by handler run ID", async () => {
      await mutationStore.create({ handler_run_id: "run-1", workflow_id: "workflow-1" });
      await mutationStore.create({ handler_run_id: "run-2", workflow_id: "workflow-1" });

      await mutationStore.deleteByHandlerRun("run-1");

      const m1 = await mutationStore.getByHandlerRunId("run-1");
      const m2 = await mutationStore.getByHandlerRunId("run-2");

      expect(m1).toBeNull();
      expect(m2).not.toBeNull();
    });
  });

  describe("deleteByWorkflow", () => {
    it("should delete mutations by workflow", async () => {
      await mutationStore.create({ handler_run_id: "run-1", workflow_id: "workflow-1" });
      await mutationStore.create({ handler_run_id: "run-2", workflow_id: "workflow-1" });
      await mutationStore.create({ handler_run_id: "run-3", workflow_id: "workflow-2" });

      await mutationStore.deleteByWorkflow("workflow-1");

      const mutations1 = await mutationStore.getByWorkflow("workflow-1");
      const mutations2 = await mutationStore.getByWorkflow("workflow-2");

      expect(mutations1).toHaveLength(0);
      expect(mutations2).toHaveLength(1);
    });
  });

  describe("status lifecycle", () => {
    it("should track mutation lifecycle: pending -> in_flight -> applied", async () => {
      const mutation = await mutationStore.create({
        handler_run_id: "run-1",
        workflow_id: "workflow-1",
      });

      expect((await mutationStore.get(mutation.id))?.status).toBe("pending");

      await mutationStore.markInFlight(mutation.id, {
        tool_namespace: "Gmail",
        tool_method: "sendEmail",
        params: "{}",
      });
      expect((await mutationStore.get(mutation.id))?.status).toBe("in_flight");

      await mutationStore.markApplied(mutation.id, JSON.stringify({ success: true }));
      expect((await mutationStore.get(mutation.id))?.status).toBe("applied");
    });

    it("should track mutation lifecycle: pending -> in_flight -> failed", async () => {
      const mutation = await mutationStore.create({
        handler_run_id: "run-1",
        workflow_id: "workflow-1",
      });

      await mutationStore.markInFlight(mutation.id, {
        tool_namespace: "Gmail",
        tool_method: "sendEmail",
        params: "{}",
      });

      await mutationStore.markFailed(mutation.id, "Invalid credentials");
      expect((await mutationStore.get(mutation.id))?.status).toBe("failed");
    });

    it("should track crash recovery: in_flight -> indeterminate -> resolved", async () => {
      const mutation = await mutationStore.create({
        handler_run_id: "run-1",
        workflow_id: "workflow-1",
      });

      await mutationStore.markInFlight(mutation.id, {
        tool_namespace: "Gmail",
        tool_method: "sendEmail",
        params: "{}",
      });

      // Simulate crash detection
      await mutationStore.markIndeterminate(mutation.id, "Process crashed during external call");
      expect((await mutationStore.get(mutation.id))?.status).toBe("indeterminate");

      // User resolves
      await mutationStore.resolve(mutation.id, "user_skip");
      const resolved = await mutationStore.get(mutation.id);
      expect(resolved?.resolved_by).toBe("user_skip");
    });
  });
});
