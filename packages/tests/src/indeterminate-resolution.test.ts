import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  DBInterface,
  KeepDb,
  KeepDbApi,
  Mutation,
} from "@app/db";
import { createDBNode } from "@app/node";
import {
  resolveIndeterminateMutation,
  getMutationResultForNext,
} from "@app/agent";

/**
 * Tests for indeterminate mutation resolution (exec-14).
 *
 * Why these tests matter:
 * Indeterminate mutations are the system's last-resort safety net. When a
 * mutation's outcome is uncertain (crash, timeout, network error), the user
 * decides what happened. A bug here could:
 * - Re-execute mutations that already happened (double-send emails)
 * - Silently drop mutations that actually succeeded (lost data)
 * - Leave workflows permanently stuck
 */

// ============================================================================
// Table creation (matches actual schema)
// ============================================================================

async function createTables(db: DBInterface): Promise<void> {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS workflows (
      id TEXT NOT NULL PRIMARY KEY,
      title TEXT NOT NULL DEFAULT '',
      task_id TEXT NOT NULL DEFAULT '',
      chat_id TEXT NOT NULL DEFAULT '',
      timestamp TEXT NOT NULL DEFAULT '',
      cron TEXT NOT NULL DEFAULT '',
      events TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT '',
      next_run_timestamp TEXT NOT NULL DEFAULT '',
      maintenance INTEGER NOT NULL DEFAULT 0,
      maintenance_fix_count INTEGER NOT NULL DEFAULT 0,
      active_script_id TEXT NOT NULL DEFAULT '',
      handler_config TEXT NOT NULL DEFAULT '',
      intent_spec TEXT NOT NULL DEFAULT '',
      consumer_sleep_until INTEGER NOT NULL DEFAULT 0
    )
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS scripts (
      id TEXT PRIMARY KEY NOT NULL DEFAULT '',
      workflow_id TEXT NOT NULL DEFAULT '',
      code TEXT NOT NULL DEFAULT '',
      version INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT '',
      type TEXT NOT NULL DEFAULT ''
    )
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS script_runs (
      id TEXT PRIMARY KEY NOT NULL DEFAULT '',
      script_id TEXT NOT NULL DEFAULT '',
      workflow_id TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pending',
      type TEXT NOT NULL DEFAULT 'schedule',
      start_timestamp TEXT NOT NULL DEFAULT '',
      end_timestamp TEXT NOT NULL DEFAULT '',
      error TEXT NOT NULL DEFAULT '',
      error_type TEXT NOT NULL DEFAULT '',
      handler_run_count INTEGER NOT NULL DEFAULT 0,
      retry_of TEXT NOT NULL DEFAULT '',
      retry_count INTEGER NOT NULL DEFAULT 0,
      cost INTEGER NOT NULL DEFAULT 0,
      trigger TEXT NOT NULL DEFAULT ''
    )
  `);

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
      ui_title TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL DEFAULT 0
    )
  `);
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_mutations_handler_run ON mutations(handler_run_id)`);
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_mutations_status ON mutations(status)`);
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_mutations_workflow ON mutations(workflow_id)`);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS topics (
      id TEXT PRIMARY KEY NOT NULL DEFAULT '',
      workflow_id TEXT NOT NULL DEFAULT '',
      name TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL DEFAULT 0,
      UNIQUE(workflow_id, name)
    )
  `);
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_topics_workflow ON topics(workflow_id)`);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY NOT NULL DEFAULT '',
      topic_id TEXT NOT NULL DEFAULT '',
      workflow_id TEXT NOT NULL DEFAULT '',
      message_id TEXT NOT NULL DEFAULT '',
      title TEXT NOT NULL DEFAULT '',
      payload TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'pending',
      reserved_by_run_id TEXT NOT NULL DEFAULT '',
      created_by_run_id TEXT NOT NULL DEFAULT '',
      caused_by TEXT NOT NULL DEFAULT '[]',
      attempt_number INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL DEFAULT 0,
      UNIQUE(topic_id, message_id)
    )
  `);
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_events_topic_status ON events(topic_id, status)`);
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_events_reserved_by ON events(reserved_by_run_id)`);

  // Handler state table needed for createRetryRun
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
}

// ============================================================================
// Test helpers
// ============================================================================

async function insertWorkflow(db: DBInterface, id: string, status = "paused:indeterminate"): Promise<void> {
  await db.exec(
    `INSERT INTO workflows (id, title, status, active_script_id, task_id, handler_config)
     VALUES (?, 'Test Workflow', ?, '', '', '{}')`,
    [id, status]
  );
}

async function insertScript(db: DBInterface, id: string, workflowId: string): Promise<void> {
  await db.exec(
    `INSERT INTO scripts (id, workflow_id, code, version, created_at)
     VALUES (?, ?, 'const x = 1;', 1, datetime('now'))`,
    [id, workflowId]
  );
}

async function insertSession(db: DBInterface, id: string, scriptId: string, workflowId: string): Promise<void> {
  await db.exec(
    `INSERT INTO script_runs (id, script_id, workflow_id, status, type, start_timestamp, handler_run_count)
     VALUES (?, ?, ?, 'running', 'schedule', datetime('now'), 0)`,
    [id, scriptId, workflowId]
  );
}

async function insertHandlerRun(
  db: DBInterface,
  id: string,
  scriptRunId: string,
  workflowId: string,
  opts: { phase?: string; status?: string; error?: string } = {}
): Promise<void> {
  await db.exec(
    `INSERT INTO handler_runs (id, script_run_id, workflow_id, handler_type, handler_name, phase, status, error, start_timestamp)
     VALUES (?, ?, ?, 'consumer', 'testHandler', ?, ?, ?, datetime('now'))`,
    [id, scriptRunId, workflowId, opts.phase || "mutate", opts.status || "paused:indeterminate", opts.error || "Network timeout"]
  );
}

async function insertMutation(
  db: DBInterface,
  id: string,
  handlerRunId: string,
  workflowId: string,
  opts: { status?: string; result?: string } = {}
): Promise<void> {
  await db.exec(
    `INSERT INTO mutations (id, handler_run_id, workflow_id, tool_namespace, tool_method, params, status, result, created_at, updated_at)
     VALUES (?, ?, ?, 'gmail', 'sendMessage', '{"to":"test@test.com"}', ?, ?, ?, ?)`,
    [id, handlerRunId, workflowId, opts.status || "indeterminate", opts.result || "", Date.now(), Date.now()]
  );
}

async function insertEvent(
  db: DBInterface,
  id: string,
  topicId: string,
  workflowId: string,
  reservedByRunId: string,
  status = "reserved"
): Promise<void> {
  await db.exec(
    `INSERT INTO events (id, topic_id, workflow_id, message_id, title, status, reserved_by_run_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'Test Event', ?, ?, ?, ?)`,
    [id, topicId, workflowId, `msg-${id}`, status, reservedByRunId, Date.now(), Date.now()]
  );
}

// ============================================================================
// Tests
// ============================================================================

describe("Indeterminate Resolution (exec-14)", () => {
  // ========================================================================
  // getMutationResultForNext (pure function)
  // ========================================================================

  describe("getMutationResultForNext", () => {
    it("should return 'none' for null mutation", () => {
      expect(getMutationResultForNext(null)).toEqual({ status: "none" });
    });

    it("should return 'applied' with parsed result for applied mutation", () => {
      const mutation = {
        status: "applied",
        result: JSON.stringify({ messageId: "abc123" }),
      } as Mutation;

      const result = getMutationResultForNext(mutation);
      expect(result.status).toBe("applied");
      expect(result.result).toEqual({ messageId: "abc123" });
    });

    it("should return 'applied' with null result when no result stored", () => {
      const mutation = {
        status: "applied",
        result: "",
      } as Mutation;

      const result = getMutationResultForNext(mutation);
      expect(result.status).toBe("applied");
      expect(result.result).toBeNull();
    });

    it("should return 'skipped' for user_skip resolution", () => {
      const mutation = {
        status: "failed",
        resolved_by: "user_skip",
      } as Mutation;

      const result = getMutationResultForNext(mutation);
      expect(result.status).toBe("skipped");
    });

    it("should throw for failed mutation without skip", () => {
      const mutation = {
        status: "failed",
        resolved_by: "user_assert_failed",
      } as Mutation;

      expect(() => getMutationResultForNext(mutation)).toThrow(
        "Unexpected: failed mutation without skip in next phase"
      );
    });

    it("should throw for pending mutation reaching next phase", () => {
      expect(() =>
        getMutationResultForNext({ status: "pending" } as Mutation)
      ).toThrow("Unexpected mutation status in next phase: pending");
    });

    it("should throw for in_flight mutation reaching next phase", () => {
      expect(() =>
        getMutationResultForNext({ status: "in_flight" } as Mutation)
      ).toThrow("Unexpected mutation status in next phase: in_flight");
    });

    it("should throw for needs_reconcile mutation reaching next phase", () => {
      expect(() =>
        getMutationResultForNext({ status: "needs_reconcile" } as Mutation)
      ).toThrow("Unexpected mutation status in next phase: needs_reconcile");
    });

    it("should throw for indeterminate mutation reaching next phase", () => {
      expect(() =>
        getMutationResultForNext({ status: "indeterminate" } as Mutation)
      ).toThrow("Unexpected mutation status in next phase: indeterminate");
    });
  });

  // ========================================================================
  // resolveIndeterminateMutation (needs real DB)
  // ========================================================================

  describe("resolveIndeterminateMutation", () => {
    let db: DBInterface;
    let keepDb: KeepDb;
    let api: KeepDbApi;

    beforeEach(async () => {
      db = await createDBNode(":memory:");
      keepDb = new KeepDb(db);
      await createTables(db);
      api = new KeepDbApi(keepDb);
    });

    afterEach(async () => {
      if (db) {
        await db.close();
      }
    });

    it("should return error for non-existent mutation", async () => {
      const result = await resolveIndeterminateMutation(api, "non-existent", "happened");
      expect(result.success).toBe(false);
      expect(result.error).toContain("not found");
    });

    it("should return error for non-indeterminate mutation", async () => {
      await insertWorkflow(db, "wf-1");
      await insertScript(db, "script-1", "wf-1");
      await insertSession(db, "session-1", "script-1", "wf-1");
      await insertHandlerRun(db, "run-1", "session-1", "wf-1");
      await insertMutation(db, "mut-1", "run-1", "wf-1", { status: "applied" });

      const result = await resolveIndeterminateMutation(api, "mut-1", "happened");
      expect(result.success).toBe(false);
      expect(result.error).toContain("not indeterminate");
    });

    it("should return error when handler run not found", async () => {
      await insertWorkflow(db, "wf-1");
      // Insert mutation with non-existent handler_run_id
      await db.exec(
        `INSERT INTO mutations (id, handler_run_id, workflow_id, tool_namespace, tool_method, params, status, created_at, updated_at)
         VALUES ('mut-1', 'no-such-run', 'wf-1', 'gmail', 'sendMessage', '{}', 'indeterminate', ?, ?)`,
        [Date.now(), Date.now()]
      );

      const result = await resolveIndeterminateMutation(api, "mut-1", "happened");
      expect(result.success).toBe(false);
      expect(result.error).toContain("Handler run");
      expect(result.error).toContain("not found");
    });

    describe("resolve as 'happened'", () => {
      it("should mark mutation as applied and resume run at mutated phase", async () => {
        await insertWorkflow(db, "wf-1");
        await insertScript(db, "script-1", "wf-1");
        await insertSession(db, "session-1", "script-1", "wf-1");
        await insertHandlerRun(db, "run-1", "session-1", "wf-1");
        await insertMutation(db, "mut-1", "run-1", "wf-1");

        const result = await resolveIndeterminateMutation(api, "mut-1", "happened");
        expect(result.success).toBe(true);
        expect(result.mutation.status).toBe("applied");
        expect(result.mutation.resolved_by).toBe("user_assert_applied");
        expect(result.mutation.resolved_at).toBeGreaterThan(0);

        // Check handler run was resumed
        const run = await api.handlerRunStore.get("run-1");
        expect(run!.phase).toBe("mutated");
        expect(run!.status).toBe("active");
        expect(run!.error).toBe("");

        // Check workflow was resumed
        const wf = await api.scriptStore.getWorkflow("wf-1");
        expect(wf!.status).toBe("active");
      });
    });

    describe("resolve as 'did_not_happen'", () => {
      it("should mark mutation as failed and create retry run", async () => {
        await insertWorkflow(db, "wf-1");
        await insertScript(db, "script-1", "wf-1");
        await insertSession(db, "session-1", "script-1", "wf-1");
        await insertHandlerRun(db, "run-1", "session-1", "wf-1");
        await insertMutation(db, "mut-1", "run-1", "wf-1");

        const result = await resolveIndeterminateMutation(api, "mut-1", "did_not_happen");
        expect(result.success).toBe(true);
        expect(result.mutation.status).toBe("failed");
        expect(result.mutation.resolved_by).toBe("user_assert_failed");
        expect(result.mutation.resolved_at).toBeGreaterThan(0);

        // Check handler run was marked failed
        const run = await api.handlerRunStore.get("run-1");
        expect(run!.status).toBe("failed:logic");
        expect(run!.error).toContain("User confirmed mutation did not complete");

        // Check workflow was resumed
        const wf = await api.scriptStore.getWorkflow("wf-1");
        expect(wf!.status).toBe("active");

        // Retry run should be created
        expect(result.retryRunId).toBeDefined();
      });
    });

    describe("resolve as 'skip'", () => {
      it("should mark mutation as failed with skip, skip events, and commit run", async () => {
        await insertWorkflow(db, "wf-1");
        await insertScript(db, "script-1", "wf-1");
        await insertSession(db, "session-1", "script-1", "wf-1");
        await insertHandlerRun(db, "run-1", "session-1", "wf-1");
        await insertMutation(db, "mut-1", "run-1", "wf-1");

        // Add a reserved event for this run
        await db.exec(
          `INSERT INTO topics (id, workflow_id, name, created_at) VALUES ('topic-1', 'wf-1', 'emails', ?)`,
          [Date.now()]
        );
        await insertEvent(db, "evt-1", "topic-1", "wf-1", "run-1", "reserved");

        const result = await resolveIndeterminateMutation(api, "mut-1", "skip");
        expect(result.success).toBe(true);
        expect(result.mutation.status).toBe("failed");
        expect(result.mutation.resolved_by).toBe("user_skip");
        expect(result.mutation.resolved_at).toBeGreaterThan(0);

        // Check handler run was committed
        const run = await api.handlerRunStore.get("run-1");
        expect(run!.phase).toBe("committed");
        expect(run!.status).toBe("committed");
        expect(run!.error).toBe("");

        // Check events were skipped
        const event = await api.eventStore.get("evt-1");
        expect(event!.status).toBe("skipped");

        // Check workflow was resumed
        const wf = await api.scriptStore.getWorkflow("wf-1");
        expect(wf!.status).toBe("active");

        // No retry run for skip
        expect(result.retryRunId).toBeUndefined();
      });
    });
  });
});
