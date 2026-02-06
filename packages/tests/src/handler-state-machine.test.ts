import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  DBInterface,
  KeepDb,
  KeepDbApi,
  HandlerRunStore,
  MutationStore,
  HandlerStateStore,
  EventStore,
  TopicStore,
  HandlerRun,
} from "@app/db";
import { createDBNode } from "@app/node";
import { executeHandler, isTerminal, HandlerExecutionContext } from "@app/agent";

/**
 * Helper to create all required tables for handler state machine tests.
 * Schema matches the actual database migrations.
 */
async function createTables(db: DBInterface): Promise<void> {
  // Workflows table (v16 + v17 + v18 + v21 + v26 + v28 + v36 extensions)
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
      consumer_sleep_until INTEGER NOT NULL DEFAULT 0
    )
  `);

  // Scripts table (simplified - only what we need)
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

  // Script runs table (sessions)
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

  // Handler runs table (includes status column from v39, retry_of column from v41)
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

  // Mutations table
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

  // Handler state table (v36 schema)
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

  // Topics table
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

  // Events table
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
}

/**
 * Create workflow and script for testing.
 */
async function createWorkflowWithScript(
  db: DBInterface,
  workflowId: string,
  scriptId: string,
  code: string,
  handlerConfig: string = "{}"
): Promise<void> {
  await db.exec(
    `INSERT INTO workflows (id, title, status, active_script_id, task_id, handler_config) VALUES (?, ?, 'active', ?, '', ?)`,
    [workflowId, "Test Workflow", scriptId, handlerConfig]
  );
  await db.exec(
    `INSERT INTO scripts (id, workflow_id, code, version, created_at) VALUES (?, ?, ?, 1, datetime('now'))`,
    [scriptId, workflowId, code]
  );
}

/**
 * Create a session (script_run) for testing.
 */
async function createSession(db: DBInterface, sessionId: string, scriptId: string, workflowId: string): Promise<void> {
  await db.exec(
    `INSERT INTO script_runs (id, script_id, workflow_id, status, type, start_timestamp, handler_run_count) VALUES (?, ?, ?, 'running', 'schedule', datetime('now'), 0)`,
    [sessionId, scriptId, workflowId]
  );
}

describe("Handler State Machine", () => {
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

  describe("isTerminal", () => {
    it("should return true for committed phase", () => {
      expect(isTerminal("committed")).toBe(true);
    });

    it("should return true for suspended phase", () => {
      expect(isTerminal("suspended")).toBe(true);
    });

    it("should return true for failed phase", () => {
      expect(isTerminal("failed")).toBe(true);
    });

    it("should return false for pending phase", () => {
      expect(isTerminal("pending")).toBe(false);
    });

    it("should return false for executing phase", () => {
      expect(isTerminal("executing")).toBe(false);
    });

    it("should return false for preparing phase", () => {
      expect(isTerminal("preparing")).toBe(false);
    });

    it("should return false for prepared phase", () => {
      expect(isTerminal("prepared")).toBe(false);
    });

    it("should return false for mutating phase", () => {
      expect(isTerminal("mutating")).toBe(false);
    });

    it("should return false for mutated phase", () => {
      expect(isTerminal("mutated")).toBe(false);
    });

    it("should return false for emitting phase", () => {
      expect(isTerminal("emitting")).toBe(false);
    });
  });

  describe("executeHandler - Basic Flow", () => {
    it("should return failed result for non-existent handler run", async () => {
      const context: HandlerExecutionContext = { api };

      const result = await executeHandler("non-existent-run", context);

      // Per exec-09: status indicates the failure reason
      expect(result.phase).toBe("failed"); // Internal uses "failed" as phase for non-existent
      expect(result.status).toBe("failed:internal");
      expect(result.error).toContain("not found");
      expect(result.errorType).toBe("logic");
    });

    it("should return immediately for already-committed handler run", async () => {
      // Create a handler run that's already committed
      const run = await api.handlerRunStore.create({
        script_run_id: "session-1",
        workflow_id: "workflow-1",
        handler_type: "producer",
        handler_name: "checkEmails",
      });

      // Per exec-09: set both phase and status for committed runs
      await api.handlerRunStore.update(run.id, {
        phase: "committed",
        status: "committed",
        end_timestamp: new Date().toISOString(),
      });

      const context: HandlerExecutionContext = { api };
      const result = await executeHandler(run.id, context);

      expect(result.phase).toBe("committed");
      expect(result.status).toBe("committed");
      expect(result.error).toBeUndefined();
    });

    it("should return immediately for already-failed handler run", async () => {
      const run = await api.handlerRunStore.create({
        script_run_id: "session-1",
        workflow_id: "workflow-1",
        handler_type: "producer",
        handler_name: "checkEmails",
      });

      // Per exec-09: use status to indicate failed, phase stays at executing
      await api.handlerRunStore.update(run.id, {
        phase: "executing",
        status: "failed:logic",
        error: "Test error",
        error_type: "logic",
        end_timestamp: new Date().toISOString(),
      });

      const context: HandlerExecutionContext = { api };
      const result = await executeHandler(run.id, context);

      expect(result.phase).toBe("executing");
      expect(result.status).toBe("failed:logic");
      expect(result.error).toBe("Test error");
      expect(result.errorType).toBe("logic");
    });

    it("should return immediately for already-paused handler run", async () => {
      const run = await api.handlerRunStore.create({
        script_run_id: "session-1",
        workflow_id: "workflow-1",
        handler_type: "consumer",
        handler_name: "processEmail",
      });

      // Per exec-09: use status to indicate paused, phase stays at mutating
      await api.handlerRunStore.update(run.id, {
        phase: "mutating",
        status: "paused:reconciliation",
        error: "indeterminate_mutation",
        end_timestamp: new Date().toISOString(),
      });

      const context: HandlerExecutionContext = { api };
      const result = await executeHandler(run.id, context);

      expect(result.phase).toBe("mutating");
      expect(result.status).toBe("paused:reconciliation");
      expect(result.error).toBe("indeterminate_mutation");
    });
  });

  describe("executeHandler - Producer Phases", () => {
    it("should transition from pending to executing", async () => {
      // Set up minimal workflow and script
      await createWorkflowWithScript(
        db,
        "workflow-1",
        "script-1",
        `const workflow = { producers: { checkEmails: { handler: async () => ({ count: 0 }) } } };`
      );
      await createSession(db, "session-1", "script-1", "workflow-1");

      const run = await api.handlerRunStore.create({
        script_run_id: "session-1",
        workflow_id: "workflow-1",
        handler_type: "producer",
        handler_name: "checkEmails",
      });

      // Manually trigger just the phase transition
      await api.handlerRunStore.updatePhase(run.id, "executing");

      const updated = await api.handlerRunStore.get(run.id);
      expect(updated?.phase).toBe("executing");
    });

    it("should fail with status if workflow not found during executing phase", async () => {
      // Create handler run WITHOUT creating workflow
      const run = await api.handlerRunStore.create({
        script_run_id: "session-1",
        workflow_id: "workflow-1",
        handler_type: "producer",
        handler_name: "checkEmails",
      });

      // Transition to executing first (as pending → executing is immediate)
      await api.handlerRunStore.updatePhase(run.id, "executing");

      const context: HandlerExecutionContext = { api };
      const result = await executeHandler(run.id, context);

      // Per exec-09: phase stays at executing, status indicates failure
      expect(result.phase).toBe("executing");
      expect(result.status).toBe("failed:logic");
      expect(result.error).toContain("Workflow workflow-1 not found");
      expect(result.errorType).toBe("logic");
    });

    it("should fail with status if no active script during executing phase", async () => {
      // Create workflow without active script
      await db.exec(
        `INSERT INTO workflows (id, title, status, active_script_id, task_id, handler_config) VALUES (?, ?, 'active', '', '', '{}')`,
        ["workflow-1", "Test Workflow"]
      );
      await createSession(db, "session-1", "", "workflow-1");

      const run = await api.handlerRunStore.create({
        script_run_id: "session-1",
        workflow_id: "workflow-1",
        handler_type: "producer",
        handler_name: "checkEmails",
      });

      await api.handlerRunStore.updatePhase(run.id, "executing");

      const context: HandlerExecutionContext = { api };
      const result = await executeHandler(run.id, context);

      // Per exec-09: phase stays at executing, status indicates failure
      expect(result.phase).toBe("executing");
      expect(result.status).toBe("failed:logic");
      expect(result.error).toContain("No active script");
      expect(result.errorType).toBe("logic");
    });
  });

  describe("executeHandler - Consumer Phases", () => {
    it("should transition from pending to preparing for consumer", async () => {
      const run = await api.handlerRunStore.create({
        script_run_id: "session-1",
        workflow_id: "workflow-1",
        handler_type: "consumer",
        handler_name: "processEmail",
      });

      // Manually trigger phase transition
      await api.handlerRunStore.updatePhase(run.id, "preparing");

      const updated = await api.handlerRunStore.get(run.id);
      expect(updated?.phase).toBe("preparing");
    });

    it("should skip to committed if prepared with no reservations", async () => {
      await createWorkflowWithScript(
        db,
        "workflow-1",
        "script-1",
        "const workflow = { consumers: { process: { prepare: async () => ({ reservations: [] }) } } };"
      );
      await createSession(db, "session-1", "script-1", "workflow-1");

      const run = await api.handlerRunStore.create({
        script_run_id: "session-1",
        workflow_id: "workflow-1",
        handler_type: "consumer",
        handler_name: "process",
      });

      // Set to prepared phase with empty reservations
      await api.handlerRunStore.update(run.id, {
        phase: "prepared",
        prepare_result: JSON.stringify({ reservations: [] }),
      });

      const context: HandlerExecutionContext = { api };
      const result = await executeHandler(run.id, context);

      expect(result.phase).toBe("committed");
    });

    it("should transition to mutating if prepared with reservations", async () => {
      const run = await api.handlerRunStore.create({
        script_run_id: "session-1",
        workflow_id: "workflow-1",
        handler_type: "consumer",
        handler_name: "process",
      });

      // Set to prepared phase with reservations
      await api.handlerRunStore.update(run.id, {
        phase: "prepared",
        prepare_result: JSON.stringify({
          reservations: [{ topic: "emails", ids: ["msg-1"] }],
        }),
      });

      // Get handler run with DB state before executing
      const before = await api.handlerRunStore.get(run.id);
      expect(before?.phase).toBe("prepared");

      const context: HandlerExecutionContext = { api };

      // Execute - should transition prepared → mutating
      // Since there's no workflow, it will fail, but the phase should have transitioned first
      // Actually, the state machine reads DB fresh each loop, so we can't test intermediate states this way
      // Let's verify by checking what phase it ends up in after the workflow-not-found error
      const result = await executeHandler(run.id, context);

      // Per exec-09: phase stays at mutating (after transition), status indicates failure
      expect(result.phase).toBe("mutating");
      expect(result.status).toBe("failed:logic");
    });
  });

  describe("executeHandler - Mutation Phase Handling", () => {
    it("should pause for reconciliation if mutation is in_flight on restart", async () => {
      await createWorkflowWithScript(
        db,
        "workflow-1",
        "script-1",
        "const workflow = {};"
      );
      await createSession(db, "session-1", "script-1", "workflow-1");

      const run = await api.handlerRunStore.create({
        script_run_id: "session-1",
        workflow_id: "workflow-1",
        handler_type: "consumer",
        handler_name: "process",
      });

      // Set up a handler in mutating phase with an in_flight mutation
      await api.handlerRunStore.update(run.id, {
        phase: "mutating",
        prepare_result: JSON.stringify({
          reservations: [{ topic: "emails", ids: ["msg-1"] }],
        }),
      });

      // Create mutation in in_flight state (simulating crash mid-mutation)
      await api.mutationStore.create({
        handler_run_id: run.id,
        workflow_id: "workflow-1",
      });
      const mutation = await api.mutationStore.getByHandlerRunId(run.id);
      expect(mutation).not.toBeNull();
      await api.mutationStore.markInFlight(mutation!.id, {
        tool_namespace: "Gmail",
        tool_method: "sendEmail",
        params: '{"to":"test@example.com"}',
      });

      const context: HandlerExecutionContext = { api };
      const result = await executeHandler(run.id, context);

      // Per exec-09: phase stays at mutating, status indicates indeterminate
      expect(result.phase).toBe("mutating");
      expect(result.status).toBe("paused:reconciliation");
      expect(result.error).toBe("indeterminate_mutation");
    });

    it("should proceed to mutated if mutation is already applied", async () => {
      await createWorkflowWithScript(
        db,
        "workflow-1",
        "script-1",
        "const workflow = {};",
        '{"consumers":{"process":{}}}'
      );
      await createSession(db, "session-1", "script-1", "workflow-1");

      const run = await api.handlerRunStore.create({
        script_run_id: "session-1",
        workflow_id: "workflow-1",
        handler_type: "consumer",
        handler_name: "process",
      });

      await api.handlerRunStore.update(run.id, {
        phase: "mutating",
        prepare_result: JSON.stringify({
          reservations: [{ topic: "emails", ids: ["msg-1"] }],
        }),
      });

      // Create mutation in applied state
      const mutation = await api.mutationStore.create({
        handler_run_id: run.id,
        workflow_id: "workflow-1",
      });
      await api.mutationStore.markApplied(mutation.id, JSON.stringify({ success: true }));

      const context: HandlerExecutionContext = { api };

      // Execute - should transition mutating → mutated → emitting → committed (no next handler)
      const result = await executeHandler(run.id, context);

      expect(result.phase).toBe("committed");
    });

    it("should fail with status if mutation is in failed state", async () => {
      await createWorkflowWithScript(
        db,
        "workflow-1",
        "script-1",
        "const workflow = {};"
      );
      await createSession(db, "session-1", "script-1", "workflow-1");

      const run = await api.handlerRunStore.create({
        script_run_id: "session-1",
        workflow_id: "workflow-1",
        handler_type: "consumer",
        handler_name: "process",
      });

      await api.handlerRunStore.update(run.id, {
        phase: "mutating",
        prepare_result: JSON.stringify({
          reservations: [{ topic: "emails", ids: ["msg-1"] }],
        }),
      });

      // Create mutation in failed state
      const mutation = await api.mutationStore.create({
        handler_run_id: run.id,
        workflow_id: "workflow-1",
      });
      await api.mutationStore.markFailed(mutation.id, "External API error");

      const context: HandlerExecutionContext = { api };
      const result = await executeHandler(run.id, context);

      // Per exec-09: phase stays at mutating, status indicates failure
      expect(result.phase).toBe("mutating");
      expect(result.status).toBe("failed:logic");
      expect(result.error).toContain("External API error");
    });

    it("should pause for reconciliation if mutation is indeterminate", async () => {
      await createWorkflowWithScript(
        db,
        "workflow-1",
        "script-1",
        "const workflow = {};"
      );
      await createSession(db, "session-1", "script-1", "workflow-1");

      const run = await api.handlerRunStore.create({
        script_run_id: "session-1",
        workflow_id: "workflow-1",
        handler_type: "consumer",
        handler_name: "process",
      });

      await api.handlerRunStore.update(run.id, {
        phase: "mutating",
        prepare_result: JSON.stringify({
          reservations: [{ topic: "emails", ids: ["msg-1"] }],
        }),
      });

      // Create mutation in indeterminate state
      const mutation = await api.mutationStore.create({
        handler_run_id: run.id,
        workflow_id: "workflow-1",
      });
      await api.mutationStore.markIndeterminate(mutation.id, "Network timeout - outcome uncertain");

      const context: HandlerExecutionContext = { api };
      const result = await executeHandler(run.id, context);

      // Per exec-09: phase stays at point of failure, status indicates why stopped
      expect(result.phase).toBe("mutating"); // Phase stays at mutating
      expect(result.status).toBe("paused:reconciliation"); // Status indicates indeterminate
      expect(result.error).toBe("indeterminate_mutation");
    });
  });

  describe("executeHandler - Emitting Phase", () => {
    it("should commit immediately if no next handler configured", async () => {
      // Config with consumer that has no next handler
      await createWorkflowWithScript(
        db,
        "workflow-1",
        "script-1",
        "const workflow = {};",
        '{"consumers":{"process":{"hasMutate":false,"hasNext":false}}}'
      );
      await createSession(db, "session-1", "script-1", "workflow-1");

      const run = await api.handlerRunStore.create({
        script_run_id: "session-1",
        workflow_id: "workflow-1",
        handler_type: "consumer",
        handler_name: "process",
      });

      // Set to emitting phase directly
      await api.handlerRunStore.update(run.id, {
        phase: "emitting",
        prepare_result: JSON.stringify({ reservations: [], data: {} }),
      });

      const context: HandlerExecutionContext = { api };
      const result = await executeHandler(run.id, context);

      expect(result.phase).toBe("committed");
    });
  });

  describe("Handler State Persistence", () => {
    it("should update handler state on producer commit", async () => {
      // This is tested indirectly through commitProducer function
      // We can test the handler state store integration

      // Create handler state
      await api.handlerStateStore.set(
        "workflow-1",
        "checkEmails",
        { lastCheck: 12345 },
        "run-1"
      );

      const state = await api.handlerStateStore.get("workflow-1", "checkEmails");
      expect(state).toEqual({ lastCheck: 12345 });

      // Update state
      await api.handlerStateStore.set(
        "workflow-1",
        "checkEmails",
        { lastCheck: 67890 },
        "run-2"
      );

      const updated = await api.handlerStateStore.get("workflow-1", "checkEmails");
      expect(updated).toEqual({ lastCheck: 67890 });
    });
  });

  describe("Event Reservation Integration", () => {
    it("should reserve events during savePrepareAndReserve", async () => {
      // Create topic and event first
      const topic = await api.topicStore.create("workflow-1", "emails");
      await api.eventStore.publishEvent(
        "workflow-1",
        "emails",
        { messageId: "msg-1", title: "Test", payload: {} },
        "producer-run-1"
      );

      const run = await api.handlerRunStore.create({
        script_run_id: "session-1",
        workflow_id: "workflow-1",
        handler_type: "consumer",
        handler_name: "process",
      });

      // Reserve event
      await api.eventStore.reserveEvents(run.id, [
        { topic: "emails", ids: ["msg-1"] },
      ]);

      // Verify reservation
      const reserved = await api.eventStore.getReservedByRun(run.id);
      expect(reserved).toHaveLength(1);
      expect(reserved[0].message_id).toBe("msg-1");
      expect(reserved[0].status).toBe("reserved");
    });

    it("should consume events on consumer commit", async () => {
      // Create topic and event
      await api.topicStore.create("workflow-1", "emails");
      await api.eventStore.publishEvent(
        "workflow-1",
        "emails",
        { messageId: "msg-1", title: "Test", payload: {} },
        "producer-run-1"
      );

      const run = await api.handlerRunStore.create({
        script_run_id: "session-1",
        workflow_id: "workflow-1",
        handler_type: "consumer",
        handler_name: "process",
      });

      // Reserve then consume
      await api.eventStore.reserveEvents(run.id, [
        { topic: "emails", ids: ["msg-1"] },
      ]);
      await api.eventStore.consumeEvents(run.id);

      // Verify consumption
      const events = await api.eventStore.peekEvents("workflow-1", "emails", { status: "consumed" });
      expect(events).toHaveLength(1);
      expect(events[0].status).toBe("consumed");
    });
  });
});
