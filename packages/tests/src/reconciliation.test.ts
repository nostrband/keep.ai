/**
 * Reconciliation Tests (exec-18)
 *
 * Tests for the mutation reconciliation system per docs/dev/13-reconciliation.md.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { DBInterface, KeepDb, KeepDbApi } from "@app/db";
import { createDBNode } from "@app/node";
import {
  ReconciliationRegistry,
  ReconciliationScheduler,
  calculateBackoff,
  DEFAULT_RECONCILIATION_POLICY,
  type MutationParams,
} from "@app/agent";

/**
 * Helper to create all required tables for reconciliation tests.
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
      type TEXT NOT NULL DEFAULT 'schedule',
      start_timestamp TEXT NOT NULL DEFAULT '',
      end_timestamp TEXT NOT NULL DEFAULT '',
      error TEXT NOT NULL DEFAULT '',
      error_type TEXT NOT NULL DEFAULT '',
      handler_run_count INTEGER NOT NULL DEFAULT 0,
      retry_of TEXT NOT NULL DEFAULT '',
      retry_count INTEGER NOT NULL DEFAULT 0,
      cost INTEGER NOT NULL DEFAULT 0,
      trigger TEXT NOT NULL DEFAULT '',
      result TEXT NOT NULL DEFAULT '',
      logs TEXT NOT NULL DEFAULT ''
    )
  `);

  // Handler runs table
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
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_mutations_status ON mutations(status)`);
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_mutations_workflow ON mutations(workflow_id)`);
}

describe("Reconciliation Types", () => {
  describe("calculateBackoff", () => {
    it("should calculate exponential backoff", () => {
      // First attempt: 10s
      expect(calculateBackoff(1)).toBe(10_000);
      // Second attempt: 20s
      expect(calculateBackoff(2)).toBe(20_000);
      // Third attempt: 40s
      expect(calculateBackoff(3)).toBe(40_000);
      // Fourth attempt: 80s
      expect(calculateBackoff(4)).toBe(80_000);
      // Fifth attempt: 160s
      expect(calculateBackoff(5)).toBe(160_000);
    });

    it("should cap at max backoff", () => {
      // Max is 10 minutes = 600_000ms
      expect(calculateBackoff(10)).toBe(600_000);
      expect(calculateBackoff(20)).toBe(600_000);
    });

    it("should use custom policy", () => {
      const policy = {
        maxAttempts: 3,
        baseBackoffMs: 5_000,
        maxBackoffMs: 30_000,
        immediateTimeoutMs: 10_000,
      };
      expect(calculateBackoff(1, policy)).toBe(5_000);
      expect(calculateBackoff(2, policy)).toBe(10_000);
      expect(calculateBackoff(3, policy)).toBe(20_000);
      expect(calculateBackoff(4, policy)).toBe(30_000); // Capped at max
    });
  });
});

describe("ReconciliationRegistry", () => {
  beforeEach(() => {
    ReconciliationRegistry.clear();
  });

  it("should register a reconcile method", () => {
    const mockReconcile = vi.fn().mockResolvedValue({ status: "applied" });

    ReconciliationRegistry.register({
      namespace: "TestTool",
      method: "testMethod",
      reconcile: mockReconcile,
    });

    expect(ReconciliationRegistry.hasReconcileMethod("TestTool", "testMethod")).toBe(true);
  });

  it("should return false for unregistered methods", () => {
    expect(ReconciliationRegistry.hasReconcileMethod("Unknown", "method")).toBe(false);
  });

  it("should unregister a method", () => {
    const mockReconcile = vi.fn();
    ReconciliationRegistry.register({
      namespace: "TestTool",
      method: "testMethod",
      reconcile: mockReconcile,
    });

    const result = ReconciliationRegistry.unregister("TestTool", "testMethod");
    expect(result).toBe(true);
    expect(ReconciliationRegistry.hasReconcileMethod("TestTool", "testMethod")).toBe(false);
  });

  it("should execute reconcile and return applied", async () => {
    const mockResult = { status: "applied" as const, result: { messageId: "123" } };
    const mockReconcile = vi.fn().mockResolvedValue(mockResult);

    ReconciliationRegistry.register({
      namespace: "Gmail",
      method: "send",
      reconcile: mockReconcile,
    });

    const params: MutationParams = {
      toolNamespace: "Gmail",
      toolMethod: "send",
      params: JSON.stringify({ to: "test@example.com" }),
      idempotencyKey: "key-123",
    };

    const result = await ReconciliationRegistry.reconcile(params);
    expect(result).toEqual(mockResult);
    expect(mockReconcile).toHaveBeenCalledWith(params);
  });

  it("should return null for unregistered tool", async () => {
    const params: MutationParams = {
      toolNamespace: "Unknown",
      toolMethod: "method",
      params: "{}",
    };

    const result = await ReconciliationRegistry.reconcile(params);
    expect(result).toBeNull();
  });

  it("should return retry when reconcile throws", async () => {
    const mockReconcile = vi.fn().mockRejectedValue(new Error("Network error"));

    ReconciliationRegistry.register({
      namespace: "Gmail",
      method: "send",
      reconcile: mockReconcile,
    });

    const params: MutationParams = {
      toolNamespace: "Gmail",
      toolMethod: "send",
      params: "{}",
    };

    const result = await ReconciliationRegistry.reconcile(params);
    expect(result).toEqual({ status: "retry" });
  });

  it("should list registered tools", () => {
    ReconciliationRegistry.register({
      namespace: "Gmail",
      method: "send",
      reconcile: vi.fn(),
    });
    ReconciliationRegistry.register({
      namespace: "Sheets",
      method: "appendRow",
      reconcile: vi.fn(),
    });

    const tools = ReconciliationRegistry.getRegisteredTools();
    expect(tools).toHaveLength(2);
    expect(tools).toContainEqual({ namespace: "Gmail", method: "send" });
    expect(tools).toContainEqual({ namespace: "Sheets", method: "appendRow" });
  });
});

describe("MutationStore Reconciliation Methods", () => {
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

  it("should mark mutation as needs_reconcile", async () => {
    // Create a script run first (startScriptRun takes id, script_id, timestamp, workflow_id, type)
    const scriptRunId = "script-run-1";
    await api.scriptStore.startScriptRun(scriptRunId, "script-1", new Date().toISOString(), "workflow-1", "schedule");
    const handlerRun = await api.handlerRunStore.create({
      script_run_id: scriptRunId,
      workflow_id: "workflow-1",
      handler_type: "consumer",
      handler_name: "handler-1",
    });

    // Create mutation
    const mutation = await api.mutationStore.create({
      handler_run_id: handlerRun.id,
      workflow_id: "workflow-1",
    });

    // Mark as in_flight first
    await api.mutationStore.markInFlight(mutation.id, {
      tool_namespace: "Gmail",
      tool_method: "send",
      params: JSON.stringify({ to: "test@example.com" }),
      idempotency_key: "key-123",
    });

    // Mark as needs_reconcile
    await api.mutationStore.markNeedsReconcile(mutation.id, "Uncertain outcome");

    const updated = await api.mutationStore.get(mutation.id);
    expect(updated?.status).toBe("needs_reconcile");
    expect(updated?.error).toBe("Uncertain outcome");
    expect(updated?.next_reconcile_at).toBeGreaterThan(0);
  });

  it("should get mutations due for reconciliation", async () => {
    // Create script run
    const scriptRunId = "script-run-2";
    await api.scriptStore.startScriptRun(scriptRunId, "script-1", new Date().toISOString(), "workflow-1", "schedule");
    const handlerRun = await api.handlerRunStore.create({
      script_run_id: scriptRunId,
      workflow_id: "workflow-1",
      handler_type: "consumer",
      handler_name: "handler-1",
    });

    // Create mutation and mark as needs_reconcile
    const mutation = await api.mutationStore.create({
      handler_run_id: handlerRun.id,
      workflow_id: "workflow-1",
    });
    await api.mutationStore.markNeedsReconcile(mutation.id, "Test");

    // Should find it (next_reconcile_at is in the past/now)
    const dueMutations = await api.mutationStore.getDueForReconciliation();
    expect(dueMutations.length).toBe(1);
    expect(dueMutations[0].id).toBe(mutation.id);
  });

  it("should not return mutations with future next_reconcile_at", async () => {
    // Create script run
    const scriptRunId = "script-run-3";
    await api.scriptStore.startScriptRun(scriptRunId, "script-1", new Date().toISOString(), "workflow-1", "schedule");
    const handlerRun = await api.handlerRunStore.create({
      script_run_id: scriptRunId,
      workflow_id: "workflow-1",
      handler_type: "consumer",
      handler_name: "handler-1",
    });

    // Create mutation
    const mutation = await api.mutationStore.create({
      handler_run_id: handlerRun.id,
      workflow_id: "workflow-1",
    });
    await api.mutationStore.markNeedsReconcile(mutation.id, "Test");

    // Schedule next attempt far in the future
    await api.mutationStore.scheduleNextReconcile(mutation.id, 1000000);

    // Should not find it
    const dueMutations = await api.mutationStore.getDueForReconciliation();
    expect(dueMutations.length).toBe(0);
  });

  it("should schedule next reconcile with backoff", async () => {
    // Create script run
    const scriptRunId = "script-run-4";
    await api.scriptStore.startScriptRun(scriptRunId, "script-1", new Date().toISOString(), "workflow-1", "schedule");
    const handlerRun = await api.handlerRunStore.create({
      script_run_id: scriptRunId,
      workflow_id: "workflow-1",
      handler_type: "consumer",
      handler_name: "handler-1",
    });

    // Create mutation
    const mutation = await api.mutationStore.create({
      handler_run_id: handlerRun.id,
      workflow_id: "workflow-1",
    });
    await api.mutationStore.markNeedsReconcile(mutation.id, "Test");

    const before = await api.mutationStore.get(mutation.id);
    expect(before?.reconcile_attempts).toBe(0);

    // Schedule next with 10 second delay
    await api.mutationStore.scheduleNextReconcile(mutation.id, 10000);

    const after = await api.mutationStore.get(mutation.id);
    expect(after?.reconcile_attempts).toBe(1);
    expect(after?.next_reconcile_at).toBeGreaterThan(Date.now());
    expect(after?.last_reconcile_at).toBeGreaterThan(0);
  });

  it("should get needs_reconcile mutations for workflow", async () => {
    // Create script runs for different workflows
    const scriptRunId1 = "script-run-5a";
    const scriptRunId2 = "script-run-5b";
    await api.scriptStore.startScriptRun(scriptRunId1, "script-1", new Date().toISOString(), "workflow-1", "schedule");
    await api.scriptStore.startScriptRun(scriptRunId2, "script-2", new Date().toISOString(), "workflow-2", "schedule");

    const handlerRun1 = await api.handlerRunStore.create({
      script_run_id: scriptRunId1,
      workflow_id: "workflow-1",
      handler_type: "consumer",
      handler_name: "handler-1",
    });
    const handlerRun2 = await api.handlerRunStore.create({
      script_run_id: scriptRunId2,
      workflow_id: "workflow-2",
      handler_type: "consumer",
      handler_name: "handler-2",
    });

    // Create mutations
    const mutation1 = await api.mutationStore.create({
      handler_run_id: handlerRun1.id,
      workflow_id: "workflow-1",
    });
    const mutation2 = await api.mutationStore.create({
      handler_run_id: handlerRun2.id,
      workflow_id: "workflow-2",
    });

    await api.mutationStore.markNeedsReconcile(mutation1.id, "Test 1");
    await api.mutationStore.markNeedsReconcile(mutation2.id, "Test 2");

    // Get for specific workflow
    const workflow1Mutations = await api.mutationStore.getNeedsReconcile("workflow-1");
    expect(workflow1Mutations.length).toBe(1);
    expect(workflow1Mutations[0].id).toBe(mutation1.id);

    // Get all
    const allMutations = await api.mutationStore.getNeedsReconcile();
    expect(allMutations.length).toBe(2);
  });
});

describe("ReconciliationScheduler", () => {
  let db: DBInterface;
  let keepDb: KeepDb;
  let api: KeepDbApi;
  let scheduler: ReconciliationScheduler;

  beforeEach(async () => {
    db = await createDBNode(":memory:");
    keepDb = new KeepDb(db);
    await createTables(db);
    api = new KeepDbApi(keepDb);
    ReconciliationRegistry.clear();
  });

  afterEach(async () => {
    scheduler?.stop();
    if (db) {
      await db.close();
    }
  });

  it("should be created with default config", () => {
    scheduler = new ReconciliationScheduler({ api });
    expect(scheduler).toBeDefined();
  });

  it("should start and stop", () => {
    scheduler = new ReconciliationScheduler({ api, checkIntervalMs: 100 });
    scheduler.start();
    scheduler.stop();
    // Should not throw
  });

  it("should process mutation when reconcile returns applied", async () => {
    // Register mock reconcile method
    const mockReconcile = vi.fn().mockResolvedValue({
      status: "applied",
      result: { messageId: "msg-123" },
    });
    ReconciliationRegistry.register({
      namespace: "Gmail",
      method: "send",
      reconcile: mockReconcile,
    });

    // Create workflow first
    await db.exec(
      `INSERT INTO workflows (id, title, status, task_id) VALUES ('workflow-1', 'Test Workflow', 'active', 'task-1')`
    );

    // Create mutation in needs_reconcile state
    const scriptRunId = "script-run-6";
    await api.scriptStore.startScriptRun(scriptRunId, "script-1", new Date().toISOString(), "workflow-1", "schedule");
    const handlerRun = await api.handlerRunStore.create({
      script_run_id: scriptRunId,
      workflow_id: "workflow-1",
      handler_type: "consumer",
      handler_name: "handler-1",
    });
    await api.handlerRunStore.update(handlerRun.id, { status: "paused:reconciliation" });

    const mutation = await api.mutationStore.create({
      handler_run_id: handlerRun.id,
      workflow_id: "workflow-1",
    });
    await api.mutationStore.markInFlight(mutation.id, {
      tool_namespace: "Gmail",
      tool_method: "send",
      params: JSON.stringify({ to: "test@example.com" }),
      idempotency_key: "key-123",
    });
    await api.mutationStore.markNeedsReconcile(mutation.id, "Test");

    // Create scheduler and start
    scheduler = new ReconciliationScheduler({ api, checkIntervalMs: 50 });
    scheduler.start();

    // Wait for scheduler to process
    await new Promise((resolve) => setTimeout(resolve, 200));

    // Verify mutation was resolved
    const updated = await api.mutationStore.get(mutation.id);
    expect(updated?.status).toBe("applied");
    expect(updated?.result).toContain("msg-123");
    expect(mockReconcile).toHaveBeenCalled();
  });

  it("should mark indeterminate when max attempts exhausted", async () => {
    // Register mock reconcile method that always returns retry
    const mockReconcile = vi.fn().mockResolvedValue({ status: "retry" });
    ReconciliationRegistry.register({
      namespace: "Gmail",
      method: "send",
      reconcile: mockReconcile,
    });

    // Create workflow
    await db.exec(
      `INSERT INTO workflows (id, title, status, task_id) VALUES ('workflow-1', 'Test Workflow', 'active', 'task-1')`
    );

    // Create mutation with max attempts already reached
    const scriptRunId = "script-run-7";
    await api.scriptStore.startScriptRun(scriptRunId, "script-1", new Date().toISOString(), "workflow-1", "schedule");
    const handlerRun = await api.handlerRunStore.create({
      script_run_id: scriptRunId,
      workflow_id: "workflow-1",
      handler_type: "consumer",
      handler_name: "handler-1",
    });

    const mutation = await api.mutationStore.create({
      handler_run_id: handlerRun.id,
      workflow_id: "workflow-1",
    });
    await api.mutationStore.markInFlight(mutation.id, {
      tool_namespace: "Gmail",
      tool_method: "send",
      params: "{}",
    });
    await api.mutationStore.markNeedsReconcile(mutation.id, "Test");

    // Simulate max attempts reached
    for (let i = 0; i < 5; i++) {
      await api.mutationStore.scheduleNextReconcile(mutation.id, 0);
    }

    // Create scheduler with short interval
    scheduler = new ReconciliationScheduler({
      api,
      checkIntervalMs: 50,
      policy: { ...DEFAULT_RECONCILIATION_POLICY, maxAttempts: 5 },
    });
    scheduler.start();

    // Wait for scheduler to process
    await new Promise((resolve) => setTimeout(resolve, 200));

    // Verify mutation was marked indeterminate
    const updated = await api.mutationStore.get(mutation.id);
    expect(updated?.status).toBe("indeterminate");

    // Verify workflow was paused
    const workflow = await api.scriptStore.getWorkflow("workflow-1");
    expect(workflow?.status).toBe("paused");
  });
});
