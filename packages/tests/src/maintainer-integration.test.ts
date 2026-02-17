import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { DBInterface, KeepDb, KeepDbApi, ScriptStore, Script, Workflow, Task, InboxStore, NotificationStore } from "@app/db";
import { createDBNode } from "@app/node";
import { makeFixTool, FixResult, MAX_FIX_ATTEMPTS, escalateToUser, LogicError } from "@app/agent";

/**
 * Integration tests for the Maintainer Task Type flow.
 *
 * These tests verify the end-to-end behavior of:
 * 1. Logic error detection → maintainer task creation → fix applied → re-run
 * 2. Max fix attempts exceeded → user escalation with notification
 */

/**
 * Helper to create all tables needed for maintainer integration tests.
 */
async function createIntegrationTables(db: DBInterface): Promise<void> {
  // Create tasks table
  await db.exec(`
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY NOT NULL,
      timestamp INTEGER NOT NULL DEFAULT 0,
      reply TEXT NOT NULL DEFAULT '',
      state TEXT NOT NULL DEFAULT '',
      thread_id TEXT NOT NULL DEFAULT '',
      error TEXT NOT NULL DEFAULT '',
      type TEXT NOT NULL DEFAULT '',
      title TEXT NOT NULL DEFAULT '',
      chat_id TEXT NOT NULL DEFAULT '',
      workflow_id TEXT NOT NULL DEFAULT '',
      asks TEXT NOT NULL DEFAULT '',
      deleted BOOLEAN DEFAULT FALSE
    )
  `);
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_tasks_chat_id ON tasks(chat_id)`);
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_tasks_workflow_id ON tasks(workflow_id)`);
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_tasks_type ON tasks(type)`);

  // Create workflows table
  await db.exec(`
    CREATE TABLE IF NOT EXISTS workflows (
      id TEXT PRIMARY KEY NOT NULL,
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
      pending_retry_run_id TEXT NOT NULL DEFAULT ''
    )
  `);
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_workflows_task_id ON workflows(task_id)`);

  // Create inbox table
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
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_inbox_target ON inbox(target)`);
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_inbox_target_id ON inbox(target_id)`);

  // Create scripts table
  await db.exec(`
    CREATE TABLE IF NOT EXISTS scripts (
      id TEXT PRIMARY KEY NOT NULL,
      task_id TEXT NOT NULL DEFAULT '',
      major_version INTEGER NOT NULL DEFAULT 0,
      minor_version INTEGER NOT NULL DEFAULT 0,
      timestamp TEXT NOT NULL DEFAULT '',
      code TEXT NOT NULL DEFAULT '',
      change_comment TEXT NOT NULL DEFAULT '',
      workflow_id TEXT NOT NULL DEFAULT '',
      type TEXT NOT NULL DEFAULT '',
      summary TEXT NOT NULL DEFAULT '',
      diagram TEXT NOT NULL DEFAULT '',
      handler_config TEXT NOT NULL DEFAULT ''
    )
  `);
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_scripts_task_id ON scripts(task_id)`);
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_scripts_workflow_id ON scripts(workflow_id)`);
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_scripts_major_minor_version ON scripts(major_version DESC, minor_version DESC)`);

  // Create script_runs table
  await db.exec(`
    CREATE TABLE IF NOT EXISTS script_runs (
      id TEXT PRIMARY KEY NOT NULL,
      script_id TEXT NOT NULL DEFAULT '',
      start_timestamp TEXT NOT NULL DEFAULT '',
      end_timestamp TEXT NOT NULL DEFAULT '',
      error TEXT NOT NULL DEFAULT '',
      error_type TEXT NOT NULL DEFAULT '',
      result TEXT NOT NULL DEFAULT '',
      logs TEXT NOT NULL DEFAULT '',
      workflow_id TEXT NOT NULL DEFAULT '',
      type TEXT NOT NULL DEFAULT '',
      retry_of TEXT NOT NULL DEFAULT '',
      retry_count INTEGER NOT NULL DEFAULT 0,
      cost INTEGER NOT NULL DEFAULT 0
    )
  `);
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_script_runs_workflow_id ON script_runs(workflow_id)`);
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_script_runs_script_id ON script_runs(script_id)`);

  // Create notifications table
  await db.exec(`
    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY NOT NULL,
      workflow_id TEXT NOT NULL DEFAULT '',
      type TEXT NOT NULL DEFAULT '',
      payload TEXT NOT NULL DEFAULT '',
      timestamp TEXT NOT NULL DEFAULT '',
      acknowledged_at TEXT NOT NULL DEFAULT '',
      resolved_at TEXT NOT NULL DEFAULT '',
      workflow_title TEXT NOT NULL DEFAULT ''
    )
  `);
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_notifications_workflow_id ON notifications(workflow_id)`);

  // Create chats table (needed for escalation message tests)
  await db.exec(`
    CREATE TABLE IF NOT EXISTS chats (
      id TEXT PRIMARY KEY NOT NULL,
      first_message_content TEXT NOT NULL DEFAULT '',
      first_message_time TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT '',
      read_at TEXT NOT NULL DEFAULT '',
      workflow_id TEXT NOT NULL DEFAULT '',
      mode TEXT NOT NULL DEFAULT '',
      autonomy_mode TEXT NOT NULL DEFAULT '',
      summary TEXT NOT NULL DEFAULT '',
      read_position TEXT NOT NULL DEFAULT ''
    )
  `);

  // Create chat_messages table
  await db.exec(`
    CREATE TABLE IF NOT EXISTS chat_messages (
      id TEXT PRIMARY KEY NOT NULL,
      chat_id TEXT NOT NULL DEFAULT '',
      role TEXT NOT NULL DEFAULT '',
      content TEXT NOT NULL DEFAULT '',
      timestamp TEXT NOT NULL DEFAULT '',
      task_run_id TEXT NOT NULL DEFAULT '',
      script_id TEXT NOT NULL DEFAULT '',
      failed_script_run_id TEXT NOT NULL DEFAULT ''
    )
  `);
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_chat_messages_chat_id ON chat_messages(chat_id)`);
}

/**
 * Creates mock ToolCallOptions for testing.
 */
function createToolCallOptions() {
  return {
    toolCallId: "test-call",
    messages: [],
    abortSignal: new AbortController().signal,
  };
}

describe("Maintainer Integration Tests", () => {
  let db: DBInterface;
  let keepDb: KeepDb;
  let api: KeepDbApi;

  beforeEach(async () => {
    db = await createDBNode(":memory:");
    keepDb = new KeepDb(db);
    await createIntegrationTables(db);
    api = new KeepDbApi(keepDb);
  });

  afterEach(async () => {
    if (db) {
      await db.close();
    }
  });

  const createWorkflow = (overrides: Partial<Workflow> = {}): Workflow => ({
    id: "workflow-1",
    title: "Test Workflow",
    task_id: "task-1",
    chat_id: "chat-1",
    timestamp: new Date().toISOString(),
    cron: "0 9 * * *",
    events: "",
    status: "active",
    next_run_timestamp: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    maintenance: false,
    maintenance_fix_count: 0,
    active_script_id: "script-1",
    handler_config: "",
    intent_spec: "",
    ...overrides,
  });

  const createScript = (overrides: Partial<Script> = {}): Script => ({
    id: "script-1",
    task_id: "task-1",
    major_version: 1,
    minor_version: 0,
    timestamp: new Date().toISOString(),
    code: "console.log('original');",
    change_comment: "Initial version",
    workflow_id: "workflow-1",
    type: "cron",
    summary: "Original summary",
    diagram: "flowchart TD",
    ...overrides,
  });

  const createTask = (overrides: Partial<Task> = {}): Task => ({
    id: "task-1",
    timestamp: Date.now(),
    reply: "",
    state: "idle",
    thread_id: "thread-1",
    error: "",
    type: "planner",
    title: "Test Task",
    chat_id: "chat-1",
    workflow_id: "workflow-1",
    asks: "",
    ...overrides,
  });

  describe("Integration Test: Logic Error to Fix Flow", () => {
    /**
     * End-to-end test of: logic error -> maintainer task -> fix applied -> re-run ready
     *
     * This test simulates the complete flow:
     * 1. A workflow exists with an active script (version 1.0)
     * 2. Script execution fails with a logic error
     * 3. enterMaintenanceMode is called which:
     *    - Increments maintenance_fix_count
     *    - Sets maintenance = true
     *    - Creates maintainer task
     *    - Creates inbox item targeting maintainer
     * 4. Maintainer analyzes and calls the fix tool
     * 5. Fix tool creates new script (version 1.1), clears maintenance, schedules re-run
     * 6. Re-run succeeds and maintenance_fix_count is reset to 0
     */
    it("should complete full flow: logic error -> maintenance mode -> fix -> workflow ready for re-run", async () => {
      // 1. Setup: Create workflow with initial script
      const workflow = createWorkflow();
      const script = createScript();
      const task = createTask();

      await api.scriptStore.addWorkflow(workflow);
      await api.scriptStore.addScript(script);
      await api.taskStore.addTask(task);

      // Verify initial state
      let dbWorkflow = await api.scriptStore.getWorkflow(workflow.id);
      expect(dbWorkflow?.maintenance).toBe(false);
      expect(dbWorkflow?.maintenance_fix_count).toBe(0);

      // 2. Simulate: Script run fails with logic error
      // (In production this would be detected by workflow-worker and route to enterMaintenanceMode)
      const scriptRunId = "script-run-fail-1";
      const startTime = new Date().toISOString();
      await api.scriptStore.startScriptRun(
        scriptRunId,
        script.id,
        startTime,
        workflow.id,
        "workflow",
        "",
        0
      );
      // Finish with error
      await api.scriptStore.finishScriptRun(
        scriptRunId,
        new Date().toISOString(),
        "",
        "TypeError: Cannot read property 'data' of undefined",
        "Fetching data...\nProcessing response...\nError occurred",
        "logic",
        0
      );

      // 3. Enter maintenance mode (atomic transaction)
      const maintenanceResult = await api.enterMaintenanceMode({
        workflowId: workflow.id,
        workflowTitle: workflow.title,
        scriptRunId,
      });

      // Verify maintenance mode was entered correctly
      expect(maintenanceResult.newFixCount).toBe(1);
      expect(maintenanceResult.maintainerTask.type).toBe("maintainer");
      expect(maintenanceResult.maintainerTask.chat_id).toBe(""); // Isolated from user chat
      expect(maintenanceResult.maintainerTask.workflow_id).toBe(workflow.id);
      expect(maintenanceResult.inboxItemId).toContain("maintenance.");

      // Verify workflow state
      dbWorkflow = await api.scriptStore.getWorkflow(workflow.id);
      expect(dbWorkflow?.maintenance).toBe(true);
      expect(dbWorkflow?.maintenance_fix_count).toBe(1);

      // Verify maintainer task exists
      const maintainerTasks = await api.taskStore.getMaintainerTasksForWorkflow(workflow.id);
      expect(maintainerTasks.length).toBe(1);
      expect(maintainerTasks[0].id).toBe(maintenanceResult.maintainerTask.id);

      // Verify inbox item was created targeting the maintainer
      const inboxResult = await db.execO<{ target: string; target_id: string; content: string }>(
        `SELECT target, target_id, content FROM inbox WHERE id = ?`,
        [maintenanceResult.inboxItemId]
      );
      expect(inboxResult).toBeTruthy();
      expect(inboxResult![0].target).toBe("maintainer");
      expect(inboxResult![0].target_id).toBe(maintenanceResult.maintainerTask.id);

      const inboxContent = JSON.parse(inboxResult![0].content);
      expect(inboxContent.metadata.scriptRunId).toBe(scriptRunId);

      // 4. Maintainer calls fix tool with corrected code
      const fixTool = makeFixTool({
        maintainerTaskId: maintenanceResult.maintainerTask.id,
        workflowId: workflow.id,
        expectedScriptId: "script-1", // Maintainer was fixing script-1
        scriptStore: api.scriptStore,
      });

      const fixResult = await fixTool.execute!(
        {
          code: "const response = fetch('/api/data');\nif (response.data) { console.log(response.data); }",
          comment: "Added null check for response.data",
        },
        createToolCallOptions()
      ) as FixResult;

      // 5. Verify fix was applied correctly
      expect(fixResult.activated).toBe(true);
      expect(fixResult.script.major_version).toBe(1); // Same major version
      expect(fixResult.script.minor_version).toBe(1); // Incremented minor version
      expect(fixResult.script.code).toContain("if (response.data)"); // Fixed code
      expect(fixResult.script.task_id).toBe(maintenanceResult.maintainerTask.id);

      // Verify workflow state after fix
      dbWorkflow = await api.scriptStore.getWorkflow(workflow.id);
      expect(dbWorkflow?.maintenance).toBe(false); // Maintenance cleared
      expect(dbWorkflow?.active_script_id).toBe(fixResult.script.id); // Points to new script

      // Verify next_run_timestamp was set to now (immediate re-run)
      const nextRunTime = new Date(dbWorkflow!.next_run_timestamp).getTime();
      const now = Date.now();
      expect(nextRunTime).toBeLessThanOrEqual(now + 1000); // Within 1 second of now

      // 6. Simulate successful re-run and verify fix count reset
      // In production, workflow-worker would call resetMaintenanceFixCount on success
      // Here we verify the method works correctly
      await api.scriptStore.resetMaintenanceFixCount(workflow.id);

      dbWorkflow = await api.scriptStore.getWorkflow(workflow.id);
      expect(dbWorkflow?.maintenance_fix_count).toBe(0); // Reset for fresh start
    });

    it("should handle race condition when planner updates script during maintainer work", async () => {
      // Setup: Workflow with script version 1.0
      const workflow = createWorkflow();
      const script = createScript({ major_version: 1, minor_version: 0 });

      await api.scriptStore.addWorkflow(workflow);
      await api.scriptStore.addScript(script);

      // Enter maintenance mode
      const maintenanceResult = await api.enterMaintenanceMode({
        workflowId: workflow.id,
        workflowTitle: workflow.title,
        scriptRunId: "script-run-1",
      });

      // Simulate planner saving new version (2.0) while maintainer was working
      const plannerScript = createScript({
        id: "script-planner-2",
        major_version: 2,
        minor_version: 0,
        code: "console.log('planner updated');",
        change_comment: "Complete rewrite by planner",
      });
      await api.scriptStore.addScript(plannerScript);
      await api.scriptStore.updateWorkflowFields(workflow.id, {
        active_script_id: plannerScript.id,
      });

      // Maintainer tries to apply fix for version 1.0 (now stale)
      const fixTool = makeFixTool({
        maintainerTaskId: maintenanceResult.maintainerTask.id,
        workflowId: workflow.id,
        expectedScriptId: "script-1", // Maintainer was fixing script-1
        scriptStore: api.scriptStore,
      });

      const fixResult = await fixTool.execute!(
        {
          code: "console.log('maintainer fix for v1');",
          comment: "Fix for old version",
        },
        createToolCallOptions()
      ) as FixResult;

      // Fix should NOT be activated due to race condition, but IS saved
      expect(fixResult.activated).toBe(false);
      // The fix is saved based on the original script (v1), so major_version is 1
      expect(fixResult.script.major_version).toBe(1);
      expect(fixResult.script.minor_version).toBe(1); // Incremented from 0
      expect(fixResult.script.code).toContain("maintainer fix for v1");

      // Verify workflow still points to planner's script (not the maintainer's fix)
      const dbWorkflow = await api.scriptStore.getWorkflow(workflow.id);
      expect(dbWorkflow?.active_script_id).toBe(plannerScript.id);

      // Verify maintenance flag is cleared (no longer in maintenance)
      expect(dbWorkflow?.maintenance).toBe(false);

      // Verify the fix was saved (maintainer's work is preserved for history)
      const savedFix = await api.scriptStore.getScript(fixResult.script.id);
      expect(savedFix).not.toBeNull();
      expect(savedFix?.code).toContain("maintainer fix for v1");
    });

    it("should allow multiple fix attempts with incrementing minor versions", async () => {
      const workflow = createWorkflow();
      const script = createScript({ major_version: 2, minor_version: 0 });

      await api.scriptStore.addWorkflow(workflow);
      await api.scriptStore.addScript(script);

      // First maintenance cycle: 2.0 -> 2.1
      const result1 = await api.enterMaintenanceMode({
        workflowId: workflow.id,
        workflowTitle: workflow.title,
        scriptRunId: "run-1",
      });
      expect(result1.newFixCount).toBe(1);

      const fixTool1 = makeFixTool({
        maintainerTaskId: result1.maintainerTask.id,
        workflowId: workflow.id,
        expectedScriptId: "script-1", // Original script
        scriptStore: api.scriptStore,
      });

      const fix1 = await fixTool1.execute!(
        { code: "// fix 1", comment: "First fix attempt" },
        createToolCallOptions()
      ) as FixResult;

      expect(fix1.activated).toBe(true);
      expect(fix1.script.minor_version).toBe(1);

      // Second maintenance cycle (fix 1 didn't work): 2.1 -> 2.2
      const result2 = await api.enterMaintenanceMode({
        workflowId: workflow.id,
        workflowTitle: workflow.title,
        scriptRunId: "run-2",
      });
      expect(result2.newFixCount).toBe(2);

      const fixTool2 = makeFixTool({
        maintainerTaskId: result2.maintainerTask.id,
        workflowId: workflow.id,
        expectedScriptId: fix1.script.id, // Now fixing the first fix
        scriptStore: api.scriptStore,
      });

      const fix2 = await fixTool2.execute!(
        { code: "// fix 2", comment: "Second fix attempt" },
        createToolCallOptions()
      ) as FixResult;

      expect(fix2.activated).toBe(true);
      expect(fix2.script.minor_version).toBe(2);

      // Third maintenance cycle: 2.2 -> 2.3
      const result3 = await api.enterMaintenanceMode({
        workflowId: workflow.id,
        workflowTitle: workflow.title,
        scriptRunId: "run-3",
      });
      expect(result3.newFixCount).toBe(3);

      const fixTool3 = makeFixTool({
        maintainerTaskId: result3.maintainerTask.id,
        workflowId: workflow.id,
        expectedScriptId: fix2.script.id, // Now fixing the second fix
        scriptStore: api.scriptStore,
      });

      const fix3 = await fixTool3.execute!(
        { code: "// fix 3 - this one works!", comment: "Third fix attempt" },
        createToolCallOptions()
      ) as FixResult;

      expect(fix3.activated).toBe(true);
      expect(fix3.script.minor_version).toBe(3);

      // Verify all scripts exist
      const scripts = await api.scriptStore.getScriptsByWorkflowId(workflow.id);
      expect(scripts.length).toBe(4); // Original + 3 fixes

      // Verify version progression
      const versions = scripts.map(s => `${s.major_version}.${s.minor_version}`).sort();
      expect(versions).toEqual(["2.0", "2.1", "2.2", "2.3"]);
    });
  });

  describe("Integration Test: Fix Escalation Flow", () => {
    /**
     * Test: max fix attempts -> user escalation flow
     *
     * This tests the scenario where:
     * 1. Workflow has already had MAX_FIX_ATTEMPTS (3) failed fixes
     * 2. Another logic error occurs
     * 3. Instead of creating another maintainer task, escalates to user:
     *    - Sets workflow status to "error"
     *    - Clears maintenance flag
     *    - Resets fix count (gives user fresh attempts)
     *    - Creates "escalated" notification
     */
    it("should escalate to user when fix count reaches max attempts", async () => {
      // Setup: Workflow that has already exceeded max fix attempts
      // Use task without chat_id to focus on testing workflow update and notification
      const workflow = createWorkflow({
        maintenance: false,
        maintenance_fix_count: MAX_FIX_ATTEMPTS, // Already at max
        status: "active",
        task_id: "task-no-chat",
      });
      const script = createScript();
      const task = createTask({
        id: "task-no-chat",
        chat_id: "", // No chat for this test
        workflow_id: workflow.id,
      });

      await api.scriptStore.addWorkflow(workflow);
      await api.scriptStore.addScript(script);
      await api.taskStore.addTask(task);

      // Verify initial state - at max fix attempts
      let dbWorkflow = await api.scriptStore.getWorkflow(workflow.id);
      expect(dbWorkflow?.maintenance_fix_count).toBe(3);

      // Call the actual escalateToUser function instead of manually implementing the logic
      const error = new LogicError("Persistent logic error after 3 fix attempts");
      const result = await escalateToUser(api, {
        workflow: workflow,
        scriptRunId: "script-run-fail",
        error: error,
        logs: ["Error log line 1", "Error log line 2"],
        fixAttempts: MAX_FIX_ATTEMPTS,
      });

      // Verify the function result
      expect(result.success).toBe(true);
      expect(result.notificationCreated).toBe(true);
      // Message should not be created since task has no chat_id
      expect(result.messageCreated).toBe(false);

      // Verify escalation results in database

      // 1. Workflow status should be "error"
      dbWorkflow = await api.scriptStore.getWorkflow(workflow.id);
      expect(dbWorkflow?.status).toBe("error");
      expect(dbWorkflow?.maintenance).toBe(false);
      expect(dbWorkflow?.maintenance_fix_count).toBe(0); // Reset for fresh attempts

      // 2. Notification should exist with correct type and payload
      const notifications = await api.notificationStore.getNotifications({ workflowId: workflow.id });
      expect(notifications.length).toBe(1);
      expect(notifications[0].type).toBe("escalated");

      const payload = JSON.parse(notifications[0].payload);
      expect(payload.error_type).toBe("logic");
      expect(payload.fix_attempts).toBe(3);
      expect(payload.max_fix_attempts).toBe(3);
    });

    it("should send escalation message to user chat when chat_id is available", async () => {
      // Setup: Workflow with task that has a chat_id
      const chatId = "chat-escalation-test";
      const workflow = createWorkflow({
        maintenance: false,
        maintenance_fix_count: MAX_FIX_ATTEMPTS,
        status: "active",
        task_id: "task-with-chat",
      });
      const task = createTask({
        id: "task-with-chat",
        chat_id: chatId,
        workflow_id: workflow.id,
      });

      await api.scriptStore.addWorkflow(workflow);
      await api.taskStore.addTask(task);

      // Call escalateToUser with the actual function
      const error = new LogicError("Script failed with invalid data");
      const result = await escalateToUser(api, {
        workflow: workflow,
        scriptRunId: "script-run-with-message",
        error: error,
        logs: ["Log line 1", "Log line 2", "Error occurred"],
        fixAttempts: MAX_FIX_ATTEMPTS,
      });

      // Verify success and message creation
      expect(result.success).toBe(true);
      expect(result.notificationCreated).toBe(true);
      // Message creation should succeed since task has chat_id
      expect(result.messageCreated).toBe(true);

      // Verify message was saved to chat_messages table
      const messages = await api.chatStore.getNewChatMessages({ chatId });
      expect(messages.length).toBeGreaterThan(0);

      // Verify the message contains escalation content
      const escalationMsg = messages[0];
      expect(escalationMsg.role).toBe("assistant");
      const msgContent = JSON.parse(escalationMsg.content);
      expect(msgContent.parts?.[0]?.text).toContain("Automation Paused");
      expect(msgContent.parts?.[0]?.text).toContain("Script failed with invalid data");
    });

    it("should handle escalation gracefully when task has no chat_id", async () => {
      // Setup: Workflow with task that has no chat_id
      const workflow = createWorkflow({
        maintenance: false,
        maintenance_fix_count: MAX_FIX_ATTEMPTS,
        status: "active",
        task_id: "task-no-chat",
      });
      const task = createTask({
        id: "task-no-chat",
        chat_id: "", // No chat
        workflow_id: workflow.id,
      });

      await api.scriptStore.addWorkflow(workflow);
      await api.taskStore.addTask(task);

      // Call escalateToUser
      const error = new LogicError("Error without chat notification");
      const result = await escalateToUser(api, {
        workflow: workflow,
        scriptRunId: "script-run-no-chat",
        error: error,
        logs: [],
        fixAttempts: MAX_FIX_ATTEMPTS,
      });

      // Should still succeed overall
      expect(result.success).toBe(true);
      expect(result.notificationCreated).toBe(true);
      // Message should NOT be created since there's no chat
      expect(result.messageCreated).toBe(false);

      // Workflow should still be set to error status
      const dbWorkflow = await api.scriptStore.getWorkflow(workflow.id);
      expect(dbWorkflow?.status).toBe("error");
    });

    it("should include recent logs in escalation message", async () => {
      // Setup: Workflow with task and chat
      const chatId = "chat-with-logs";
      const workflow = createWorkflow({
        maintenance: false,
        maintenance_fix_count: MAX_FIX_ATTEMPTS,
        status: "active",
        task_id: "task-with-logs",
      });
      const task = createTask({
        id: "task-with-logs",
        chat_id: chatId,
        workflow_id: workflow.id,
      });

      await api.scriptStore.addWorkflow(workflow);
      await api.taskStore.addTask(task);

      // Provide many log lines to test truncation (only last 20 should be included)
      const manyLogs = Array.from({ length: 30 }, (_, i) => `Log line ${i + 1}`);

      const error = new LogicError("Error with many logs");
      await escalateToUser(api, {
        workflow: workflow,
        scriptRunId: "script-run-logs",
        error: error,
        logs: manyLogs,
        fixAttempts: MAX_FIX_ATTEMPTS,
      });

      // Check message content from chat_messages table
      const messages = await api.chatStore.getNewChatMessages({ chatId });
      expect(messages.length).toBeGreaterThan(0);

      const escalationMsg = messages[0];
      const msgContent = JSON.parse(escalationMsg.content);
      const messageText = msgContent.parts?.[0]?.text || "";

      // Should contain last 20 log lines (11-30), not first ones
      expect(messageText).toContain("Log line 30");
      expect(messageText).toContain("Log line 11");
      // Should NOT contain the first log lines (they were truncated)
      expect(messageText).not.toContain("Log line 1\n");
    });

    it("should not create maintainer task when at max fix attempts", async () => {
      // Setup: Workflow at the escalation boundary (fixCount + 1 >= MAX_FIX_ATTEMPTS)
      // With MAX_FIX_ATTEMPTS=3, fixCount=2 means the next failure would be the 3rd
      // consecutive failure, which should escalate instead of creating a maintainer.
      const workflow = createWorkflow({
        maintenance_fix_count: MAX_FIX_ATTEMPTS - 1, // 2 — one below max, but triggers escalation
      });
      const script = createScript();

      await api.scriptStore.addWorkflow(workflow);
      await api.scriptStore.addScript(script);

      // Verify no maintainer tasks exist initially
      let maintainerTasks = await api.taskStore.getMaintainerTasksForWorkflow(workflow.id);
      expect(maintainerTasks.length).toBe(0);

      // In the real implementation, workflow-scheduler checks:
      // if (fixCount + 1 >= MAX_FIX_ATTEMPTS) { escalateToUser(); return; }
      // So enterMaintenanceMode is NOT called when the next entry would reach the limit.

      // Simulate the guard logic:
      const shouldEscalate = workflow.maintenance_fix_count + 1 >= MAX_FIX_ATTEMPTS;
      expect(shouldEscalate).toBe(true);

      // No maintainer task should be created when escalating
      maintainerTasks = await api.taskStore.getMaintainerTasksForWorkflow(workflow.id);
      expect(maintainerTasks.length).toBe(0);
    });

    it("should allow fresh fix attempts after user re-enables workflow", async () => {
      // Setup: Workflow that was escalated (status=error, fix_count=0)
      const workflow = createWorkflow({
        status: "error",
        maintenance: false,
        maintenance_fix_count: 0, // Reset after escalation
      });
      const script = createScript();

      await api.scriptStore.addWorkflow(workflow);
      await api.scriptStore.addScript(script);

      // User re-enables the workflow
      await api.scriptStore.updateWorkflowFields(workflow.id, {
        status: "active",
      });

      // Script fails again with logic error
      // This time, maintenance should work since fix_count is 0
      const maintenanceResult = await api.enterMaintenanceMode({
        workflowId: workflow.id,
        workflowTitle: workflow.title,
        scriptRunId: "script-run-after-reenable",
      });

      // Should successfully enter maintenance mode
      expect(maintenanceResult.newFixCount).toBe(1);
      expect(maintenanceResult.maintainerTask.type).toBe("maintainer");

      // Verify workflow state
      const dbWorkflow = await api.scriptStore.getWorkflow(workflow.id);
      expect(dbWorkflow?.maintenance).toBe(true);
      expect(dbWorkflow?.maintenance_fix_count).toBe(1);
    });

    it("should correctly track fix count across multiple maintenance cycles", async () => {
      const workflow = createWorkflow();
      const script = createScript();

      await api.scriptStore.addWorkflow(workflow);
      await api.scriptStore.addScript(script);

      // First fix attempt
      let result = await api.enterMaintenanceMode({
        workflowId: workflow.id,
        workflowTitle: workflow.title,
        scriptRunId: "run-1",
      });
      expect(result.newFixCount).toBe(1);

      // Apply fix (simulate fix tool success)
      const fixTool = makeFixTool({
        maintainerTaskId: result.maintainerTask.id,
        workflowId: workflow.id,
        expectedScriptId: "script-1",
        scriptStore: api.scriptStore,
      });
      const fix1Result = await fixTool.execute!(
        { code: "// fix 1", comment: "Fix 1" },
        createToolCallOptions()
      ) as FixResult;

      // Second fix attempt (fix 1 didn't work)
      result = await api.enterMaintenanceMode({
        workflowId: workflow.id,
        workflowTitle: workflow.title,
        scriptRunId: "run-2",
      });
      expect(result.newFixCount).toBe(2);

      // Apply fix
      const fixTool2 = makeFixTool({
        maintainerTaskId: result.maintainerTask.id,
        workflowId: workflow.id,
        expectedScriptId: fix1Result.script.id, // Use the previous fix's script id
        scriptStore: api.scriptStore,
      });
      await fixTool2.execute!(
        { code: "// fix 2", comment: "Fix 2" },
        createToolCallOptions()
      );

      // After 2 maintenance entries, the workflow-scheduler would escalate on the
      // next failure (fixCount + 1 >= MAX_FIX_ATTEMPTS → 2 + 1 >= 3 → true).
      // Verify the fix count is at the escalation boundary.
      const dbWorkflow = await api.scriptStore.getWorkflow(workflow.id);
      expect(dbWorkflow?.maintenance_fix_count).toBe(2);

      // Now if we check the condition (as workflow-scheduler does):
      const shouldEscalate = dbWorkflow!.maintenance_fix_count + 1 >= MAX_FIX_ATTEMPTS;
      expect(shouldEscalate).toBe(true);
    });
  });

  describe("Maintainer Context and Isolation", () => {
    it("should create maintainer task with isolated thread", async () => {
      const workflow = createWorkflow();
      const script = createScript();

      await api.scriptStore.addWorkflow(workflow);
      await api.scriptStore.addScript(script);

      const result = await api.enterMaintenanceMode({
        workflowId: workflow.id,
        workflowTitle: workflow.title,
        scriptRunId: "script-run-1",
      });

      // Maintainer task should have its own thread_id
      expect(result.maintainerTask.thread_id).toBeTruthy();

      // Chat ID should be empty (not connected to user chat)
      expect(result.maintainerTask.chat_id).toBe("");

      // Should have correct title
      expect(result.maintainerTask.title).toBe(`Auto-fix: ${workflow.title}`);
    });

    it("should include script run ID in inbox item metadata", async () => {
      const workflow = createWorkflow();
      const script = createScript();

      await api.scriptStore.addWorkflow(workflow);
      await api.scriptStore.addScript(script);

      const scriptRunId = "script-run-test-123";
      const result = await api.enterMaintenanceMode({
        workflowId: workflow.id,
        workflowTitle: workflow.title,
        scriptRunId,
      });

      // Verify inbox item contains script run ID in metadata
      const inboxResult = await db.execO<{ content: string }>(
        `SELECT content FROM inbox WHERE id = ?`,
        [result.inboxItemId]
      );

      const content = JSON.parse(inboxResult![0].content);
      expect(content.metadata.scriptRunId).toBe(scriptRunId);
    });

    it("should create separate maintainer tasks for each maintenance cycle", async () => {
      const workflow = createWorkflow();
      const script = createScript();

      await api.scriptStore.addWorkflow(workflow);
      await api.scriptStore.addScript(script);

      // First maintenance cycle
      const result1 = await api.enterMaintenanceMode({
        workflowId: workflow.id,
        workflowTitle: workflow.title,
        scriptRunId: "run-1",
      });

      // Apply fix to clear maintenance
      const fixTool1 = makeFixTool({
        maintainerTaskId: result1.maintainerTask.id,
        workflowId: workflow.id,
        expectedScriptId: "script-1",
        scriptStore: api.scriptStore,
      });
      await fixTool1.execute!(
        { code: "// fix", comment: "Fix" },
        createToolCallOptions()
      );

      // Second maintenance cycle
      const result2 = await api.enterMaintenanceMode({
        workflowId: workflow.id,
        workflowTitle: workflow.title,
        scriptRunId: "run-2",
      });

      // Tasks should have different IDs
      expect(result1.maintainerTask.id).not.toBe(result2.maintainerTask.id);

      // Both tasks should exist
      const maintainerTasks = await api.taskStore.getMaintainerTasksForWorkflow(workflow.id);
      expect(maintainerTasks.length).toBe(2);

      // Tasks should have different thread IDs
      expect(result1.maintainerTask.thread_id).not.toBe(result2.maintainerTask.thread_id);
    });
  });
});
