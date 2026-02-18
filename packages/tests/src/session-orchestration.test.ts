import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  DBInterface,
  KeepDb,
  KeepDbApi,
} from "@app/db";
import { createDBNode } from "@app/node";
import {
  executeWorkflowSession,
  executeWorkflowSessionIfIdle,
  canStartSession,
  getSessionCost,
  HandlerExecutionContext,
  ExecutionModelManager,
} from "@app/agent";

/**
 * Helper to create all required tables for session orchestration tests.
 * Schema matches the actual database migrations.
 */
async function createTables(db: DBInterface): Promise<void> {
  // Workflows table
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

  // Scripts table
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
      result TEXT NOT NULL DEFAULT '',
      type TEXT NOT NULL DEFAULT 'schedule',
      start_timestamp TEXT NOT NULL DEFAULT '',
      end_timestamp TEXT NOT NULL DEFAULT '',
      error TEXT NOT NULL DEFAULT '',
      error_type TEXT NOT NULL DEFAULT '',
      logs TEXT NOT NULL DEFAULT '',
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

  // Handler state table (includes wake_at from v42)
  await db.exec(`
    CREATE TABLE IF NOT EXISTS handler_state (
      id TEXT PRIMARY KEY NOT NULL DEFAULT '',
      workflow_id TEXT NOT NULL DEFAULT '',
      handler_name TEXT NOT NULL DEFAULT '',
      state TEXT NOT NULL DEFAULT '{}',
      updated_at INTEGER NOT NULL DEFAULT 0,
      updated_by_run_id TEXT NOT NULL DEFAULT '',
      wake_at INTEGER NOT NULL DEFAULT 0,
      UNIQUE(workflow_id, handler_name)
    )
  `);
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_handler_state_wake_at ON handler_state(wake_at)`);

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

  // Producer schedules table (exec-13)
  await db.exec(`
    CREATE TABLE IF NOT EXISTS producer_schedules (
      id TEXT PRIMARY KEY NOT NULL DEFAULT '',
      workflow_id TEXT NOT NULL DEFAULT '',
      producer_name TEXT NOT NULL DEFAULT '',
      schedule_type TEXT NOT NULL DEFAULT '',
      schedule_value TEXT NOT NULL DEFAULT '',
      next_run_at INTEGER NOT NULL DEFAULT 0,
      last_run_at INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL DEFAULT 0
    )
  `);
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_producer_schedules_workflow ON producer_schedules(workflow_id)`);
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_producer_schedules_next_run ON producer_schedules(next_run_at)`);
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
 * Create a topic and events for testing consumer work detection.
 */
async function createTopicWithEvents(
  api: KeepDbApi,
  workflowId: string,
  topicName: string,
  messageIds: string[]
): Promise<void> {
  await api.topicStore.create(workflowId, topicName);
  for (const messageId of messageIds) {
    await api.eventStore.publishEvent(
      workflowId,
      topicName,
      { messageId, title: `Event ${messageId}`, payload: {} },
      "test-producer"
    );
  }
}

describe("Session Orchestration", () => {
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

  describe("executeWorkflowSession - Basic Validation", () => {
    it("should fail if workflow has no active script", async () => {
      // Create workflow without active script
      await db.exec(
        `INSERT INTO workflows (id, title, status, active_script_id, task_id, handler_config) VALUES (?, ?, 'active', '', '', '{}')`,
        ["workflow-1", "Test Workflow"]
      );

      const workflow = await api.scriptStore.getWorkflow("workflow-1");
      const context: HandlerExecutionContext = { api, emm: new ExecutionModelManager(api) };

      const result = await executeWorkflowSession(
        workflow!,
        "schedule",
        context
      );

      expect(result.status).toBe("failed");
      expect(result.error).toContain("no active script");
    });

    it("should fail if handler_config is invalid JSON", async () => {
      await db.exec(
        `INSERT INTO workflows (id, title, status, active_script_id, task_id, handler_config) VALUES (?, ?, 'active', 'script-1', '', 'not-valid-json')`,
        ["workflow-1", "Test Workflow"]
      );
      await db.exec(
        `INSERT INTO scripts (id, workflow_id, code, version, created_at) VALUES (?, ?, ?, 1, datetime('now'))`,
        ["script-1", "workflow-1", "const workflow = {};"]
      );

      const workflow = await api.scriptStore.getWorkflow("workflow-1");
      const context: HandlerExecutionContext = { api, emm: new ExecutionModelManager(api) };

      const result = await executeWorkflowSession(
        workflow!,
        "schedule",
        context
      );

      expect(result.status).toBe("failed");
      expect(result.error).toContain("Invalid handler_config JSON");
    });

    it("should create session record on execution start", async () => {
      await createWorkflowWithScript(
        db,
        "workflow-1",
        "script-1",
        "const workflow = {};",
        '{"producers":{},"consumers":{}}'
      );

      const workflow = await api.scriptStore.getWorkflow("workflow-1");
      const context: HandlerExecutionContext = { api, emm: new ExecutionModelManager(api) };

      const result = await executeWorkflowSession(
        workflow!,
        "schedule",
        context
      );

      expect(result.sessionId).toBeDefined();

      // Verify session was created
      const session = await api.scriptStore.getScriptRun(result.sessionId!);
      expect(session).not.toBeNull();
      expect(session!.workflow_id).toBe("workflow-1");
      expect(session!.type).toBe("schedule");
    });

    it("should complete successfully with no producers and no consumers", async () => {
      await createWorkflowWithScript(
        db,
        "workflow-1",
        "script-1",
        "const workflow = {};",
        '{"producers":{},"consumers":{}}'
      );

      const workflow = await api.scriptStore.getWorkflow("workflow-1");
      const context: HandlerExecutionContext = { api, emm: new ExecutionModelManager(api) };

      const result = await executeWorkflowSession(
        workflow!,
        "schedule",
        context
      );

      expect(result.status).toBe("completed");
    });
  });

  describe("executeWorkflowSession - Session State Management", () => {
    it("should mark session as completed on success", async () => {
      await createWorkflowWithScript(
        db,
        "workflow-1",
        "script-1",
        "const workflow = {};",
        '{"producers":{},"consumers":{}}'
      );

      const workflow = await api.scriptStore.getWorkflow("workflow-1");
      const context: HandlerExecutionContext = { api, emm: new ExecutionModelManager(api) };

      const result = await executeWorkflowSession(
        workflow!,
        "schedule",
        context
      );

      expect(result.status).toBe("completed");

      // Verify session state
      const session = await api.scriptStore.getScriptRun(result.sessionId!);
      expect(session!.result).toBe("completed");
      expect(session!.end_timestamp).not.toBe("");
    });

    it("should mark session as failed and pause workflow on producer failure", async () => {
      // Create workflow with a producer that will fail (no actual handler code)
      await createWorkflowWithScript(
        db,
        "workflow-1",
        "script-1",
        "const workflow = { producers: { badProducer: {} } };",
        '{"producers":{"badProducer":{}},"consumers":{}}'
      );

      const workflow = await api.scriptStore.getWorkflow("workflow-1");
      const context: HandlerExecutionContext = { api, emm: new ExecutionModelManager(api) };

      const result = await executeWorkflowSession(
        workflow!,
        "schedule",
        context
      );

      expect(result.status).toBe("failed");

      // Verify session state
      const session = await api.scriptStore.getScriptRun(result.sessionId!);
      expect(session!.result).toBe("failed");

      // Verify workflow paused
      const updatedWorkflow = await api.scriptStore.getWorkflow("workflow-1");
      expect(updatedWorkflow!.status).toBe("error");
    });
  });

  describe("executeWorkflowSession - Trigger Types", () => {
    it("should run producers for schedule trigger", async () => {
      // Create workflow with handler_config containing producer
      await createWorkflowWithScript(
        db,
        "workflow-1",
        "script-1",
        `const workflow = { producers: { checkEmails: { handler: async () => ({ processed: 0 }) } } };`,
        '{"producers":{"checkEmails":{}},"consumers":{}}'
      );

      const workflow = await api.scriptStore.getWorkflow("workflow-1");
      const context: HandlerExecutionContext = { api, emm: new ExecutionModelManager(api) };

      const result = await executeWorkflowSession(
        workflow!,
        "schedule",
        context
      );

      // Should have attempted to run the producer (may fail without proper script setup)
      expect(result.sessionId).toBeDefined();

      // Check handler run was created for producer
      const runs = await api.handlerRunStore.getBySession(result.sessionId!);
      expect(runs.some(r => r.handler_type === "producer")).toBe(true);
    });

    it("should run producers for manual trigger", async () => {
      await createWorkflowWithScript(
        db,
        "workflow-1",
        "script-1",
        `const workflow = { producers: { checkEmails: { handler: async () => ({}) } } };`,
        '{"producers":{"checkEmails":{}},"consumers":{}}'
      );

      const workflow = await api.scriptStore.getWorkflow("workflow-1");
      const context: HandlerExecutionContext = { api, emm: new ExecutionModelManager(api) };

      const result = await executeWorkflowSession(
        workflow!,
        "manual",
        context
      );

      expect(result.sessionId).toBeDefined();

      // Check handler run was created for producer
      const runs = await api.handlerRunStore.getBySession(result.sessionId!);
      expect(runs.some(r => r.handler_type === "producer")).toBe(true);
    });

    it("should skip producers for event trigger", async () => {
      await createWorkflowWithScript(
        db,
        "workflow-1",
        "script-1",
        `const workflow = { producers: { checkEmails: { handler: async () => ({}) } } };`,
        '{"producers":{"checkEmails":{}},"consumers":{}}'
      );

      const workflow = await api.scriptStore.getWorkflow("workflow-1");
      const context: HandlerExecutionContext = { api, emm: new ExecutionModelManager(api) };

      const result = await executeWorkflowSession(
        workflow!,
        "event",
        context
      );

      expect(result.status).toBe("completed");

      // Check no producer handler runs created
      const runs = await api.handlerRunStore.getBySession(result.sessionId!);
      expect(runs.filter(r => r.handler_type === "producer")).toHaveLength(0);
    });
  });

  describe("executeWorkflowSession - Consumer Loop", () => {
    it("should not create consumer runs if no pending work", async () => {
      await createWorkflowWithScript(
        db,
        "workflow-1",
        "script-1",
        "const workflow = {};",
        '{"producers":{},"consumers":{"processEmail":{"subscribe":["emails"]}}}'
      );

      // Create topic but no events
      await api.topicStore.create("workflow-1", "emails");

      const workflow = await api.scriptStore.getWorkflow("workflow-1");
      const context: HandlerExecutionContext = { api, emm: new ExecutionModelManager(api) };

      const result = await executeWorkflowSession(
        workflow!,
        "schedule",
        context
      );

      expect(result.status).toBe("completed");

      // No consumer runs should be created
      const runs = await api.handlerRunStore.getBySession(result.sessionId!);
      expect(runs.filter(r => r.handler_type === "consumer")).toHaveLength(0);
    });

    it("should create consumer runs when pending events exist", async () => {
      await createWorkflowWithScript(
        db,
        "workflow-1",
        "script-1",
        "const workflow = { consumers: { processEmail: { prepare: async () => ({ reservations: [] }) } } };",
        '{"producers":{},"consumers":{"processEmail":{"subscribe":["emails"]}}}'
      );

      // Create topic with pending events
      await createTopicWithEvents(api, "workflow-1", "emails", ["msg-1"]);

      const workflow = await api.scriptStore.getWorkflow("workflow-1");
      const context: HandlerExecutionContext = { api, emm: new ExecutionModelManager(api) };

      const result = await executeWorkflowSession(
        workflow!,
        "schedule",
        context
      );

      // A consumer run should have been created
      const runs = await api.handlerRunStore.getBySession(result.sessionId!);
      expect(runs.some(r => r.handler_type === "consumer")).toBe(true);
    });
  });

  describe("executeWorkflowSession - Budget Limit", () => {
    it("should respect maxIterations configuration", async () => {
      await createWorkflowWithScript(
        db,
        "workflow-1",
        "script-1",
        "const workflow = { consumers: { processEmail: { prepare: async () => ({ reservations: [] }) } } };",
        '{"producers":{},"consumers":{"processEmail":{"subscribe":["emails"]}}}'
      );

      // Create topic with many pending events
      await createTopicWithEvents(api, "workflow-1", "emails", [
        "msg-1", "msg-2", "msg-3", "msg-4", "msg-5"
      ]);

      const workflow = await api.scriptStore.getWorkflow("workflow-1");
      const context: HandlerExecutionContext = { api, emm: new ExecutionModelManager(api) };

      // Run with low iteration limit
      const result = await executeWorkflowSession(
        workflow!,
        "schedule",
        context,
        { maxIterations: 2 }
      );

      // Should complete but stop at 2 iterations
      const runs = await api.handlerRunStore.getBySession(result.sessionId!);
      const consumerRuns = runs.filter(r => r.handler_type === "consumer");
      expect(consumerRuns.length).toBeLessThanOrEqual(2);
    });
  });

  describe("canStartSession - Single-Threaded Constraint", () => {
    it("should return true when no active runs exist", async () => {
      const canStart = await canStartSession(api, "workflow-1");
      expect(canStart).toBe(true);
    });

    it("should return false when active run exists", async () => {
      // Create an active (non-terminal) handler run
      await api.handlerRunStore.create({
        script_run_id: "session-1",
        workflow_id: "workflow-1",
        handler_type: "consumer",
        handler_name: "process",
      });

      const canStart = await canStartSession(api, "workflow-1");
      expect(canStart).toBe(false);
    });

    it("should return true when all runs are in terminal state", async () => {
      // Create a completed handler run
      const run = await api.handlerRunStore.create({
        script_run_id: "session-1",
        workflow_id: "workflow-1",
        handler_type: "consumer",
        handler_name: "process",
      });
      // Per exec-09: set status to indicate committed, not just phase
      await api.handlerRunStore.update(run.id, {
        phase: "committed",
        status: "committed",
        end_timestamp: new Date().toISOString(),
      });

      const canStart = await canStartSession(api, "workflow-1");
      expect(canStart).toBe(true);
    });
  });

  describe("executeWorkflowSessionIfIdle", () => {
    it("should return null if another session is active", async () => {
      await createWorkflowWithScript(
        db,
        "workflow-1",
        "script-1",
        "const workflow = {};",
        "{}"
      );

      // Create an active handler run
      await api.handlerRunStore.create({
        script_run_id: "session-1",
        workflow_id: "workflow-1",
        handler_type: "consumer",
        handler_name: "process",
      });

      const workflow = await api.scriptStore.getWorkflow("workflow-1");
      const context: HandlerExecutionContext = { api, emm: new ExecutionModelManager(api) };

      const result = await executeWorkflowSessionIfIdle(
        workflow!,
        "schedule",
        context
      );

      expect(result).toBeNull();
    });

    it("should execute session if idle", async () => {
      await createWorkflowWithScript(
        db,
        "workflow-1",
        "script-1",
        "const workflow = {};",
        '{"producers":{},"consumers":{}}'
      );

      const workflow = await api.scriptStore.getWorkflow("workflow-1");
      const context: HandlerExecutionContext = { api, emm: new ExecutionModelManager(api) };

      const result = await executeWorkflowSessionIfIdle(
        workflow!,
        "schedule",
        context
      );

      expect(result).not.toBeNull();
      expect(result!.status).toBe("completed");
    });
  });

  describe("getSessionCost - Cost Aggregation", () => {
    it("should return 0 for session with no handler runs", async () => {
      const cost = await getSessionCost(api, "non-existent-session");
      expect(cost).toBe(0);
    });

    it("should aggregate cost from all handler runs", async () => {
      // Create handler runs with costs
      const run1 = await api.handlerRunStore.create({
        script_run_id: "session-1",
        workflow_id: "workflow-1",
        handler_type: "producer",
        handler_name: "producer1",
      });
      await api.handlerRunStore.update(run1.id, { cost: 100 });

      const run2 = await api.handlerRunStore.create({
        script_run_id: "session-1",
        workflow_id: "workflow-1",
        handler_type: "consumer",
        handler_name: "consumer1",
      });
      await api.handlerRunStore.update(run2.id, { cost: 250 });

      const run3 = await api.handlerRunStore.create({
        script_run_id: "session-1",
        workflow_id: "workflow-1",
        handler_type: "consumer",
        handler_name: "consumer1",
      });
      await api.handlerRunStore.update(run3.id, { cost: 150 });

      const cost = await getSessionCost(api, "session-1");
      expect(cost).toBe(500);
    });

    it("should handle null costs gracefully", async () => {
      // Create handler runs without costs set
      await api.handlerRunStore.create({
        script_run_id: "session-1",
        workflow_id: "workflow-1",
        handler_type: "producer",
        handler_name: "producer1",
      });

      await api.handlerRunStore.create({
        script_run_id: "session-1",
        workflow_id: "workflow-1",
        handler_type: "consumer",
        handler_name: "consumer1",
      });

      const cost = await getSessionCost(api, "session-1");
      expect(cost).toBe(0);
    });
  });

  // resumeIncompleteSessions tests removed — crash recovery now handled by
  // EMM.recoverCrashedRuns() / recoverUnfinishedSessions() / recoverMaintenanceMode().

  describe("Session Handler Run Order", () => {
    it("should create handler runs with correct handler_type and handler_name", async () => {
      await createWorkflowWithScript(
        db,
        "workflow-1",
        "script-1",
        `const workflow = {
          producers: { checkEmails: { handler: async () => ({}) } }
        };`,
        '{"producers":{"checkEmails":{}},"consumers":{}}'
      );

      const workflow = await api.scriptStore.getWorkflow("workflow-1");
      const context: HandlerExecutionContext = { api, emm: new ExecutionModelManager(api) };

      const result = await executeWorkflowSession(
        workflow!,
        "schedule",
        context
      );

      const runs = await api.handlerRunStore.getBySession(result.sessionId!);

      // Verify producer run was created with correct metadata
      const producerRun = runs.find(r => r.handler_type === "producer");
      expect(producerRun).toBeDefined();
      expect(producerRun!.handler_name).toBe("checkEmails");
      expect(producerRun!.workflow_id).toBe("workflow-1");
    });

    it("should run producers before consumers", async () => {
      await createWorkflowWithScript(
        db,
        "workflow-1",
        "script-1",
        `const workflow = {
          producers: { checkEmails: { handler: async () => ({}) } },
          consumers: { processEmail: { prepare: async () => ({ reservations: [] }) } }
        };`,
        '{"producers":{"checkEmails":{}},"consumers":{"processEmail":{"subscribe":["emails"]}}}'
      );

      // Add pending events so consumer has work
      await createTopicWithEvents(api, "workflow-1", "emails", ["msg-1"]);

      const workflow = await api.scriptStore.getWorkflow("workflow-1");
      const context: HandlerExecutionContext = { api, emm: new ExecutionModelManager(api) };

      const result = await executeWorkflowSession(
        workflow!,
        "schedule",
        context
      );

      const runs = await api.handlerRunStore.getBySession(result.sessionId!);

      // If both producer and consumer exist, producer should come first
      const producerIndex = runs.findIndex(r => r.handler_type === "producer");
      const consumerIndex = runs.findIndex(r => r.handler_type === "consumer");

      if (producerIndex !== -1 && consumerIndex !== -1) {
        expect(producerIndex).toBeLessThan(consumerIndex);
      }
    });
  });

  describe("Session Error Handling", () => {
    it("should catch and classify unexpected errors", async () => {
      await createWorkflowWithScript(
        db,
        "workflow-1",
        "script-1",
        "const workflow = {};",
        '{"producers":{"badProducer":{}},"consumers":{}}'
      );

      const workflow = await api.scriptStore.getWorkflow("workflow-1");
      const context: HandlerExecutionContext = { api, emm: new ExecutionModelManager(api) };

      const result = await executeWorkflowSession(
        workflow!,
        "schedule",
        context
      );

      // Should handle failure gracefully
      expect(result.status).toBe("failed");
      expect(result.error).toBeDefined();
    });
  });

  describe("Consumer wakeAt Scheduling (exec-19)", () => {
    it("should not trigger consumer when wakeAt is in the future", async () => {
      await createWorkflowWithScript(
        db,
        "workflow-1",
        "script-1",
        "const workflow = { consumers: { dailyDigest: { prepare: async () => ({ reservations: [] }) } } };",
        '{"producers":{},"consumers":{"dailyDigest":{"subscribe":["notifications"]}}}'
      );

      // Create topic with no pending events
      await api.topicStore.create("workflow-1", "notifications");

      // Set wakeAt in the future
      const futureTime = Date.now() + 60_000; // 1 minute from now
      await api.handlerStateStore.updateWakeAt("workflow-1", "dailyDigest", futureTime);

      const workflow = await api.scriptStore.getWorkflow("workflow-1");
      const context: HandlerExecutionContext = { api, emm: new ExecutionModelManager(api) };

      const result = await executeWorkflowSession(
        workflow!,
        "event",
        context
      );

      expect(result.status).toBe("completed");

      // No consumer runs should be created (no events, wakeAt not due)
      const runs = await api.handlerRunStore.getBySession(result.sessionId!);
      expect(runs.filter(r => r.handler_type === "consumer")).toHaveLength(0);
    });

    it("should trigger consumer when wakeAt is due", async () => {
      await createWorkflowWithScript(
        db,
        "workflow-1",
        "script-1",
        "const workflow = { consumers: { dailyDigest: { prepare: async () => ({ reservations: [] }) } } };",
        '{"producers":{},"consumers":{"dailyDigest":{"subscribe":["notifications"]}}}'
      );

      // Create topic with no pending events
      await api.topicStore.create("workflow-1", "notifications");

      // Set wakeAt in the past (due now)
      const pastTime = Date.now() - 1000; // 1 second ago
      await api.handlerStateStore.updateWakeAt("workflow-1", "dailyDigest", pastTime);

      const workflow = await api.scriptStore.getWorkflow("workflow-1");
      const context: HandlerExecutionContext = { api, emm: new ExecutionModelManager(api) };

      const result = await executeWorkflowSession(
        workflow!,
        "event",
        context
      );

      // A consumer run should have been created due to wakeAt
      const runs = await api.handlerRunStore.getBySession(result.sessionId!);
      expect(runs.some(r => r.handler_type === "consumer")).toBe(true);
    });

    it("should prioritize events over wakeAt", async () => {
      await createWorkflowWithScript(
        db,
        "workflow-1",
        "script-1",
        "const workflow = { consumers: { processEmail: { prepare: async () => ({ reservations: [] }) } } };",
        '{"producers":{},"consumers":{"processEmail":{"subscribe":["emails"]}}}'
      );

      // Create topic with pending events
      await createTopicWithEvents(api, "workflow-1", "emails", ["msg-1"]);

      // Also set wakeAt in the past
      const pastTime = Date.now() - 1000;
      await api.handlerStateStore.updateWakeAt("workflow-1", "processEmail", pastTime);

      const workflow = await api.scriptStore.getWorkflow("workflow-1");
      const context: HandlerExecutionContext = { api, emm: new ExecutionModelManager(api) };

      const result = await executeWorkflowSession(
        workflow!,
        "event",
        context
      );

      // Consumer should have run (triggered by events, not wakeAt)
      const runs = await api.handlerRunStore.getBySession(result.sessionId!);
      expect(runs.some(r => r.handler_type === "consumer")).toBe(true);
    });

    it("should ignore wakeAt for consumers not defined in config", async () => {
      await createWorkflowWithScript(
        db,
        "workflow-1",
        "script-1",
        "const workflow = {};",
        '{"producers":{},"consumers":{}}'
      );

      // Set wakeAt for a consumer that doesn't exist in config
      const pastTime = Date.now() - 1000;
      await api.handlerStateStore.updateWakeAt("workflow-1", "nonExistentConsumer", pastTime);

      const workflow = await api.scriptStore.getWorkflow("workflow-1");
      const context: HandlerExecutionContext = { api, emm: new ExecutionModelManager(api) };

      const result = await executeWorkflowSession(
        workflow!,
        "event",
        context
      );

      expect(result.status).toBe("completed");

      // No consumer runs should be created
      const runs = await api.handlerRunStore.getBySession(result.sessionId!);
      expect(runs.filter(r => r.handler_type === "consumer")).toHaveLength(0);
    });

    it("should handle wakeAt=0 as no scheduled wake", async () => {
      await createWorkflowWithScript(
        db,
        "workflow-1",
        "script-1",
        "const workflow = { consumers: { processEmail: { prepare: async () => ({ reservations: [] }) } } };",
        '{"producers":{},"consumers":{"processEmail":{"subscribe":["emails"]}}}'
      );

      // Create topic with no events
      await api.topicStore.create("workflow-1", "emails");

      // Set wakeAt to 0 (no scheduled wake)
      await api.handlerStateStore.updateWakeAt("workflow-1", "processEmail", 0);

      const workflow = await api.scriptStore.getWorkflow("workflow-1");
      const context: HandlerExecutionContext = { api, emm: new ExecutionModelManager(api) };

      const result = await executeWorkflowSession(
        workflow!,
        "event",
        context
      );

      expect(result.status).toBe("completed");

      // No consumer runs should be created (no events, no wakeAt)
      const runs = await api.handlerRunStore.getBySession(result.sessionId!);
      expect(runs.filter(r => r.handler_type === "consumer")).toHaveLength(0);
    });
  });
});
