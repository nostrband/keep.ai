import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  DBInterface,
  KeepDb,
  HandlerRunStore,
  HandlerRun,
  HandlerRunPhase,
  HandlerType,
} from "@app/db";
import { createDBNode } from "@app/node";

/**
 * Helper to create handler_runs table without full migration system.
 * Schema matches packages/db/src/migrations/v36.ts + v39.ts (status column) + v41.ts (retry_of column)
 */
async function createHandlerRunsTable(db: DBInterface): Promise<void> {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS handler_runs (
      id TEXT PRIMARY KEY NOT NULL DEFAULT '',
      script_run_id TEXT NOT NULL DEFAULT '',
      workflow_id TEXT NOT NULL DEFAULT '',
      handler_type TEXT NOT NULL DEFAULT '',
      handler_name TEXT NOT NULL DEFAULT '',
      phase TEXT NOT NULL DEFAULT 'pending',
      status TEXT NOT NULL DEFAULT 'active',
      retry_of TEXT NOT NULL DEFAULT '',
      prepare_result TEXT NOT NULL DEFAULT '',
      input_state TEXT NOT NULL DEFAULT '',
      output_state TEXT NOT NULL DEFAULT '',
      start_timestamp TEXT NOT NULL DEFAULT '',
      end_timestamp TEXT NOT NULL DEFAULT '',
      error TEXT NOT NULL DEFAULT '',
      error_type TEXT NOT NULL DEFAULT '',
      cost INTEGER NOT NULL DEFAULT 0,
      logs TEXT NOT NULL DEFAULT '[]'
    )
  `);
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_handler_runs_script_run ON handler_runs(script_run_id)`);
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_handler_runs_workflow ON handler_runs(workflow_id)`);
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_handler_runs_phase ON handler_runs(phase)`);
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_handler_runs_status ON handler_runs(status)`);
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_handler_runs_retry_of ON handler_runs(retry_of)`);
}

describe("HandlerRunStore", () => {
  let db: DBInterface;
  let keepDb: KeepDb;
  let handlerRunStore: HandlerRunStore;

  beforeEach(async () => {
    db = await createDBNode(":memory:");
    keepDb = new KeepDb(db);
    await createHandlerRunsTable(db);
    handlerRunStore = new HandlerRunStore(keepDb);
  });

  afterEach(async () => {
    if (db) {
      await db.close();
    }
  });

  describe("create", () => {
    it("should create a producer handler run", async () => {
      const run = await handlerRunStore.create({
        script_run_id: "session-1",
        workflow_id: "workflow-1",
        handler_type: "producer",
        handler_name: "checkEmails",
      });

      expect(run).toBeDefined();
      expect(run.id).toBeDefined();
      expect(run.script_run_id).toBe("session-1");
      expect(run.workflow_id).toBe("workflow-1");
      expect(run.handler_type).toBe("producer");
      expect(run.handler_name).toBe("checkEmails");
      expect(run.phase).toBe("pending");
      expect(run.start_timestamp).toBeDefined();
      expect(run.end_timestamp).toBe("");
      expect(run.cost).toBe(0);
      expect(run.logs).toBe("[]");
    });

    it("should create a consumer handler run", async () => {
      const run = await handlerRunStore.create({
        script_run_id: "session-1",
        workflow_id: "workflow-1",
        handler_type: "consumer",
        handler_name: "processEmail",
      });

      expect(run.handler_type).toBe("consumer");
    });

    it("should accept initial input_state", async () => {
      const inputState = JSON.stringify({ counter: 5 });
      const run = await handlerRunStore.create({
        script_run_id: "session-1",
        workflow_id: "workflow-1",
        handler_type: "producer",
        handler_name: "checkEmails",
        input_state: inputState,
      });

      expect(run.input_state).toBe(inputState);
    });
  });

  describe("get", () => {
    it("should return handler run by ID", async () => {
      const created = await handlerRunStore.create({
        script_run_id: "session-1",
        workflow_id: "workflow-1",
        handler_type: "producer",
        handler_name: "checkEmails",
      });

      const run = await handlerRunStore.get(created.id);

      expect(run).toEqual(created);
    });

    it("should return null for non-existent ID", async () => {
      const run = await handlerRunStore.get("non-existent");
      expect(run).toBeNull();
    });
  });

  describe("update", () => {
    it("should update phase", async () => {
      const run = await handlerRunStore.create({
        script_run_id: "session-1",
        workflow_id: "workflow-1",
        handler_type: "producer",
        handler_name: "checkEmails",
      });

      await handlerRunStore.update(run.id, { phase: "executing" });

      const updated = await handlerRunStore.get(run.id);
      expect(updated?.phase).toBe("executing");
    });

    it("should update multiple fields", async () => {
      const run = await handlerRunStore.create({
        script_run_id: "session-1",
        workflow_id: "workflow-1",
        handler_type: "producer",
        handler_name: "checkEmails",
      });

      await handlerRunStore.update(run.id, {
        phase: "committed",
        output_state: JSON.stringify({ counter: 10 }),
        end_timestamp: new Date().toISOString(),
        cost: 500,
      });

      const updated = await handlerRunStore.get(run.id);
      expect(updated?.phase).toBe("committed");
      expect(updated?.output_state).toBe(JSON.stringify({ counter: 10 }));
      expect(updated?.end_timestamp).not.toBe("");
      expect(updated?.cost).toBe(500);
    });

    it("should update error information", async () => {
      const run = await handlerRunStore.create({
        script_run_id: "session-1",
        workflow_id: "workflow-1",
        handler_type: "producer",
        handler_name: "checkEmails",
      });

      await handlerRunStore.update(run.id, {
        phase: "failed",
        error: "Network timeout",
        error_type: "network",
      });

      const updated = await handlerRunStore.get(run.id);
      expect(updated?.phase).toBe("failed");
      expect(updated?.error).toBe("Network timeout");
      expect(updated?.error_type).toBe("network");
    });

    it("should not throw for empty updates", async () => {
      const run = await handlerRunStore.create({
        script_run_id: "session-1",
        workflow_id: "workflow-1",
        handler_type: "producer",
        handler_name: "checkEmails",
      });

      await expect(handlerRunStore.update(run.id, {})).resolves.not.toThrow();
    });
  });

  describe("updatePhase", () => {
    it("should update only the phase", async () => {
      const run = await handlerRunStore.create({
        script_run_id: "session-1",
        workflow_id: "workflow-1",
        handler_type: "consumer",
        handler_name: "processEmail",
      });

      await handlerRunStore.updatePhase(run.id, "preparing");

      const updated = await handlerRunStore.get(run.id);
      expect(updated?.phase).toBe("preparing");
    });
  });

  describe("getBySession", () => {
    it("should return handler runs by session", async () => {
      await handlerRunStore.create({
        script_run_id: "session-1",
        workflow_id: "workflow-1",
        handler_type: "producer",
        handler_name: "checkEmails",
      });
      await new Promise(resolve => setTimeout(resolve, 10));
      await handlerRunStore.create({
        script_run_id: "session-1",
        workflow_id: "workflow-1",
        handler_type: "consumer",
        handler_name: "processEmail",
      });
      await handlerRunStore.create({
        script_run_id: "session-2",
        workflow_id: "workflow-1",
        handler_type: "producer",
        handler_name: "checkEmails",
      });

      const runs = await handlerRunStore.getBySession("session-1");

      expect(runs).toHaveLength(2);
      expect(runs[0].handler_name).toBe("checkEmails");
      expect(runs[1].handler_name).toBe("processEmail");
    });

    it("should return empty array for non-existent session", async () => {
      const runs = await handlerRunStore.getBySession("non-existent");
      expect(runs).toEqual([]);
    });
  });

  describe("getIncomplete", () => {
    it("should return non-terminal handler runs", async () => {
      const run1 = await handlerRunStore.create({
        script_run_id: "session-1",
        workflow_id: "workflow-1",
        handler_type: "producer",
        handler_name: "checkEmails",
      });

      const run2 = await handlerRunStore.create({
        script_run_id: "session-1",
        workflow_id: "workflow-1",
        handler_type: "consumer",
        handler_name: "processEmail",
      });
      // Per exec-09: set both phase and status for committed runs
      await handlerRunStore.update(run2.id, { phase: "committed", status: "committed" });

      const run3 = await handlerRunStore.create({
        script_run_id: "session-1",
        workflow_id: "workflow-1",
        handler_type: "consumer",
        handler_name: "archiveEmail",
      });
      await handlerRunStore.updatePhase(run3.id, "preparing");

      const incomplete = await handlerRunStore.getIncomplete("workflow-1");

      expect(incomplete).toHaveLength(2);
      expect(incomplete.map(r => r.phase).sort()).toEqual(["pending", "preparing"]);
    });

    it("should exclude paused and failed runs (by status)", async () => {
      const run1 = await handlerRunStore.create({
        script_run_id: "session-1",
        workflow_id: "workflow-1",
        handler_type: "consumer",
        handler_name: "processEmail",
      });
      // Per exec-09: use status for paused runs
      await handlerRunStore.update(run1.id, { phase: "mutating", status: "paused:reconciliation" });

      const run2 = await handlerRunStore.create({
        script_run_id: "session-1",
        workflow_id: "workflow-1",
        handler_type: "consumer",
        handler_name: "archiveEmail",
      });
      // Per exec-09: use status for failed runs
      await handlerRunStore.update(run2.id, { phase: "executing", status: "failed:logic" });

      const incomplete = await handlerRunStore.getIncomplete("workflow-1");
      expect(incomplete).toHaveLength(0);
    });
  });

  describe("getWorkflowsWithIncompleteRuns", () => {
    it("should return workflow IDs with incomplete runs", async () => {
      await handlerRunStore.create({
        script_run_id: "session-1",
        workflow_id: "workflow-1",
        handler_type: "producer",
        handler_name: "checkEmails",
      });

      const run2 = await handlerRunStore.create({
        script_run_id: "session-2",
        workflow_id: "workflow-2",
        handler_type: "producer",
        handler_name: "checkEmails",
      });
      // Per exec-09: set both phase and status for committed runs
      await handlerRunStore.update(run2.id, { phase: "committed", status: "committed" });

      await handlerRunStore.create({
        script_run_id: "session-3",
        workflow_id: "workflow-3",
        handler_type: "consumer",
        handler_name: "processEmail",
      });

      const workflowIds = await handlerRunStore.getWorkflowsWithIncompleteRuns();

      expect(workflowIds.sort()).toEqual(["workflow-1", "workflow-3"]);
    });

    it("should return distinct workflow IDs", async () => {
      await handlerRunStore.create({
        script_run_id: "session-1",
        workflow_id: "workflow-1",
        handler_type: "producer",
        handler_name: "checkEmails",
      });
      await handlerRunStore.create({
        script_run_id: "session-1",
        workflow_id: "workflow-1",
        handler_type: "consumer",
        handler_name: "processEmail",
      });

      const workflowIds = await handlerRunStore.getWorkflowsWithIncompleteRuns();

      expect(workflowIds).toEqual(["workflow-1"]);
    });
  });

  describe("hasActiveRun", () => {
    it("should return true if workflow has active runs", async () => {
      await handlerRunStore.create({
        script_run_id: "session-1",
        workflow_id: "workflow-1",
        handler_type: "producer",
        handler_name: "checkEmails",
      });

      const hasActive = await handlerRunStore.hasActiveRun("workflow-1");
      expect(hasActive).toBe(true);
    });

    it("should return false if all runs are terminal", async () => {
      const run = await handlerRunStore.create({
        script_run_id: "session-1",
        workflow_id: "workflow-1",
        handler_type: "producer",
        handler_name: "checkEmails",
      });
      // Per exec-09: set both phase and status for committed runs
      await handlerRunStore.update(run.id, { phase: "committed", status: "committed" });

      const hasActive = await handlerRunStore.hasActiveRun("workflow-1");
      expect(hasActive).toBe(false);
    });

    it("should return false for non-existent workflow", async () => {
      const hasActive = await handlerRunStore.hasActiveRun("non-existent");
      expect(hasActive).toBe(false);
    });
  });

  describe("getByWorkflow", () => {
    it("should return handler runs for a workflow", async () => {
      await handlerRunStore.create({
        script_run_id: "session-1",
        workflow_id: "workflow-1",
        handler_type: "producer",
        handler_name: "checkEmails",
      });
      await handlerRunStore.create({
        script_run_id: "session-1",
        workflow_id: "workflow-1",
        handler_type: "consumer",
        handler_name: "processEmail",
      });
      await handlerRunStore.create({
        script_run_id: "session-2",
        workflow_id: "workflow-2",
        handler_type: "producer",
        handler_name: "checkEmails",
      });

      const runs = await handlerRunStore.getByWorkflow("workflow-1");

      expect(runs).toHaveLength(2);
    });

    it("should order by start_timestamp DESC", async () => {
      await handlerRunStore.create({
        script_run_id: "session-1",
        workflow_id: "workflow-1",
        handler_type: "producer",
        handler_name: "first",
      });
      await new Promise(resolve => setTimeout(resolve, 10));
      await handlerRunStore.create({
        script_run_id: "session-1",
        workflow_id: "workflow-1",
        handler_type: "consumer",
        handler_name: "second",
      });

      const runs = await handlerRunStore.getByWorkflow("workflow-1");

      // Most recent first
      expect(runs[0].handler_name).toBe("second");
      expect(runs[1].handler_name).toBe("first");
    });

    it("should respect limit option", async () => {
      await handlerRunStore.create({
        script_run_id: "session-1",
        workflow_id: "workflow-1",
        handler_type: "producer",
        handler_name: "first",
      });
      await handlerRunStore.create({
        script_run_id: "session-1",
        workflow_id: "workflow-1",
        handler_type: "consumer",
        handler_name: "second",
      });
      await handlerRunStore.create({
        script_run_id: "session-1",
        workflow_id: "workflow-1",
        handler_type: "consumer",
        handler_name: "third",
      });

      const runs = await handlerRunStore.getByWorkflow("workflow-1", { limit: 2 });

      expect(runs).toHaveLength(2);
    });
  });

  describe("deleteBySession", () => {
    it("should delete handler runs by session", async () => {
      await handlerRunStore.create({
        script_run_id: "session-1",
        workflow_id: "workflow-1",
        handler_type: "producer",
        handler_name: "checkEmails",
      });
      await handlerRunStore.create({
        script_run_id: "session-1",
        workflow_id: "workflow-1",
        handler_type: "consumer",
        handler_name: "processEmail",
      });
      await handlerRunStore.create({
        script_run_id: "session-2",
        workflow_id: "workflow-1",
        handler_type: "producer",
        handler_name: "checkEmails",
      });

      await handlerRunStore.deleteBySession("session-1");

      const runs1 = await handlerRunStore.getBySession("session-1");
      const runs2 = await handlerRunStore.getBySession("session-2");

      expect(runs1).toHaveLength(0);
      expect(runs2).toHaveLength(1);
    });
  });

  describe("deleteByWorkflow", () => {
    it("should delete handler runs by workflow", async () => {
      await handlerRunStore.create({
        script_run_id: "session-1",
        workflow_id: "workflow-1",
        handler_type: "producer",
        handler_name: "checkEmails",
      });
      await handlerRunStore.create({
        script_run_id: "session-2",
        workflow_id: "workflow-2",
        handler_type: "producer",
        handler_name: "checkEmails",
      });

      await handlerRunStore.deleteByWorkflow("workflow-1");

      const runs1 = await handlerRunStore.getByWorkflow("workflow-1");
      const runs2 = await handlerRunStore.getByWorkflow("workflow-2");

      expect(runs1).toHaveLength(0);
      expect(runs2).toHaveLength(1);
    });
  });

  describe("producer phase progression", () => {
    it("should follow producer state machine: pending -> executing -> committed", async () => {
      const run = await handlerRunStore.create({
        script_run_id: "session-1",
        workflow_id: "workflow-1",
        handler_type: "producer",
        handler_name: "checkEmails",
      });

      expect((await handlerRunStore.get(run.id))?.phase).toBe("pending");

      await handlerRunStore.updatePhase(run.id, "executing");
      expect((await handlerRunStore.get(run.id))?.phase).toBe("executing");

      await handlerRunStore.updatePhase(run.id, "committed");
      expect((await handlerRunStore.get(run.id))?.phase).toBe("committed");
    });
  });

  describe("consumer phase progression", () => {
    it("should follow consumer state machine: pending -> preparing -> prepared -> mutating -> mutated -> emitting -> committed", async () => {
      const run = await handlerRunStore.create({
        script_run_id: "session-1",
        workflow_id: "workflow-1",
        handler_type: "consumer",
        handler_name: "processEmail",
      });

      const phases: HandlerRunPhase[] = [
        "pending",
        "preparing",
        "prepared",
        "mutating",
        "mutated",
        "emitting",
        "committed",
      ];

      for (const phase of phases) {
        await handlerRunStore.updatePhase(run.id, phase);
        expect((await handlerRunStore.get(run.id))?.phase).toBe(phase);
      }
    });
  });

  describe("retry chain (exec-10)", () => {
    it("should create a run with retry_of linking to previous run", async () => {
      // Create original run
      const originalRun = await handlerRunStore.create({
        script_run_id: "session-1",
        workflow_id: "workflow-1",
        handler_type: "consumer",
        handler_name: "processEmail",
      });

      // Create retry run
      const retryRun = await handlerRunStore.create({
        script_run_id: "session-1",
        workflow_id: "workflow-1",
        handler_type: "consumer",
        handler_name: "processEmail",
        retry_of: originalRun.id,
      });

      expect(retryRun.retry_of).toBe(originalRun.id);
      expect(originalRun.retry_of).toBe("");
    });

    it("should get retry chain in chronological order (oldest first)", async () => {
      // Create chain: original -> retry1 -> retry2
      const original = await handlerRunStore.create({
        script_run_id: "session-1",
        workflow_id: "workflow-1",
        handler_type: "consumer",
        handler_name: "processEmail",
      });

      const retry1 = await handlerRunStore.create({
        script_run_id: "session-1",
        workflow_id: "workflow-1",
        handler_type: "consumer",
        handler_name: "processEmail",
        retry_of: original.id,
      });

      const retry2 = await handlerRunStore.create({
        script_run_id: "session-1",
        workflow_id: "workflow-1",
        handler_type: "consumer",
        handler_name: "processEmail",
        retry_of: retry1.id,
      });

      // Get chain from latest run
      const chain = await handlerRunStore.getRetryChain(retry2.id);

      expect(chain).toHaveLength(3);
      expect(chain[0].id).toBe(original.id);
      expect(chain[1].id).toBe(retry1.id);
      expect(chain[2].id).toBe(retry2.id);
    });

    it("should find latest attempt in retry chain", async () => {
      // Create chain: original -> retry1 -> retry2
      const original = await handlerRunStore.create({
        script_run_id: "session-1",
        workflow_id: "workflow-1",
        handler_type: "consumer",
        handler_name: "processEmail",
      });

      const retry1 = await handlerRunStore.create({
        script_run_id: "session-1",
        workflow_id: "workflow-1",
        handler_type: "consumer",
        handler_name: "processEmail",
        retry_of: original.id,
      });

      const retry2 = await handlerRunStore.create({
        script_run_id: "session-1",
        workflow_id: "workflow-1",
        handler_type: "consumer",
        handler_name: "processEmail",
        retry_of: retry1.id,
      });

      // Find latest from any point in chain
      const latestFromOriginal = await handlerRunStore.findLatestInChain(original.id);
      const latestFromRetry1 = await handlerRunStore.findLatestInChain(retry1.id);
      const latestFromRetry2 = await handlerRunStore.findLatestInChain(retry2.id);

      expect(latestFromOriginal?.id).toBe(retry2.id);
      expect(latestFromRetry1?.id).toBe(retry2.id);
      expect(latestFromRetry2?.id).toBe(retry2.id);
    });

    it("should get direct retries of a run", async () => {
      const original = await handlerRunStore.create({
        script_run_id: "session-1",
        workflow_id: "workflow-1",
        handler_type: "consumer",
        handler_name: "processEmail",
      });

      // Create two retries of the original (unusual but possible in theory)
      const retry1 = await handlerRunStore.create({
        script_run_id: "session-1",
        workflow_id: "workflow-1",
        handler_type: "consumer",
        handler_name: "processEmail",
        retry_of: original.id,
      });

      const retries = await handlerRunStore.getRetriesOf(original.id);

      expect(retries).toHaveLength(1);
      expect(retries[0].id).toBe(retry1.id);
    });

    it("should create retry run with specified starting phase", async () => {
      const retryRun = await handlerRunStore.create({
        script_run_id: "session-1",
        workflow_id: "workflow-1",
        handler_type: "consumer",
        handler_name: "processEmail",
        retry_of: "original-run-id",
        phase: "emitting", // Skip to emitting for retries after mutation
      });

      expect(retryRun.phase).toBe("emitting");
    });

    it("should copy prepare_result for retry runs after mutation", async () => {
      const prepareResult = JSON.stringify({ reservations: [{ topic: "emails", ids: ["1", "2"] }] });
      const retryRun = await handlerRunStore.create({
        script_run_id: "session-1",
        workflow_id: "workflow-1",
        handler_type: "consumer",
        handler_name: "processEmail",
        retry_of: "original-run-id",
        phase: "emitting",
        prepare_result: prepareResult,
      });

      expect(retryRun.prepare_result).toBe(prepareResult);
    });
  });
});
