import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DBInterface, KeepDb, ScriptStore, Script, Workflow } from "@app/db";
import { createDBNode } from "@app/node";
import { makeFixTool, FixResult } from "@app/agent";

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

/**
 * Helper to create scripts, workflows tables without full migration system.
 * This allows testing the fix tool in isolation without CR-SQLite dependencies.
 */
async function createFixToolTables(db: DBInterface): Promise<void> {
  // Create scripts table (matches production v11 + v16 + v34 migrations)
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
      diagram TEXT NOT NULL DEFAULT ''
    )
  `);
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_scripts_task_id ON scripts(task_id)`);
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_scripts_workflow_id ON scripts(workflow_id)`);
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_scripts_major_minor_version ON scripts(major_version DESC, minor_version DESC)`);

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
      intent_spec TEXT NOT NULL DEFAULT ''
    )
  `);
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_workflows_task_id ON workflows(task_id)`);
}

describe("Fix Tool", () => {
  let db: DBInterface;
  let keepDb: KeepDb;
  let scriptStore: ScriptStore;

  beforeEach(async () => {
    db = await createDBNode(":memory:");
    keepDb = new KeepDb(db);
    await createFixToolTables(db);
    scriptStore = new ScriptStore(keepDb);
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
    maintenance: true,
    maintenance_fix_count: 1,
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

  describe("Successful fix application", () => {
    it("should create new script with incremented minor_version", async () => {
      const workflow = createWorkflow();
      const script = createScript({ major_version: 2, minor_version: 0 });
      await scriptStore.addWorkflow(workflow);
      await scriptStore.addScript(script);

      const fixTool = makeFixTool({
        maintainerTaskId: "maintainer-task-1",
        workflowId: "workflow-1",
        expectedScriptId: "script-1",
        scriptStore,
      });

      const result = await fixTool.execute!(
        { issue: "Console output broken", code: "console.log('fixed');", comment: "Fixed the bug" },
        createToolCallOptions()
      ) as FixResult;

      expect(result.activated).toBe(true);
      expect(result.script.major_version).toBe(2);
      expect(result.script.minor_version).toBe(1);
      expect(result.script.code).toBe("console.log('fixed');");
      expect(result.script.change_comment).toBe("Fixed the bug");
    });

    it("should preserve major_version when creating fix", async () => {
      const workflow = createWorkflow();
      const script = createScript({ major_version: 5, minor_version: 3 });
      await scriptStore.addWorkflow(workflow);
      await scriptStore.addScript(script);

      const fixTool = makeFixTool({
        maintainerTaskId: "maintainer-task-1",
        workflowId: "workflow-1",
        expectedScriptId: "script-1",
        scriptStore,
      });

      const result = await fixTool.execute!(
        { issue: "Test issue", code: "console.log('fixed');", comment: "Fixed" },
        createToolCallOptions()
      ) as FixResult;

      expect(result.activated).toBe(true);
      expect(result.script.major_version).toBe(5); // Same major version
      expect(result.script.minor_version).toBe(4); // Incremented from 3
    });

    it("should preserve script metadata (type, summary, diagram)", async () => {
      const workflow = createWorkflow();
      const script = createScript({
        type: "event",
        summary: "This does something important",
        diagram: "flowchart LR\nA-->B",
      });
      await scriptStore.addWorkflow(workflow);
      await scriptStore.addScript(script);

      const fixTool = makeFixTool({
        maintainerTaskId: "maintainer-task-1",
        workflowId: "workflow-1",
        expectedScriptId: "script-1",
        scriptStore,
      });

      const result = await fixTool.execute!(
        { issue: "Test issue", code: "console.log('fixed');", comment: "Bug fix" },
        createToolCallOptions()
      ) as FixResult;

      expect(result.activated).toBe(true);
      expect(result.script.type).toBe("event");
      expect(result.script.summary).toBe("This does something important");
      expect(result.script.diagram).toBe("flowchart LR\nA-->B");
    });

    it("should set task_id to maintainer task ID", async () => {
      const workflow = createWorkflow();
      const script = createScript();
      await scriptStore.addWorkflow(workflow);
      await scriptStore.addScript(script);

      const fixTool = makeFixTool({
        maintainerTaskId: "maintainer-task-123",
        workflowId: "workflow-1",
        expectedScriptId: "script-1",
        scriptStore,
      });

      const result = await fixTool.execute!(
        { issue: "Test issue", code: "fixed code", comment: "Fix" },
        createToolCallOptions()
      ) as FixResult;

      expect(result.script.task_id).toBe("maintainer-task-123");
    });

    it("should update workflow active_script_id to new script", async () => {
      const workflow = createWorkflow();
      const script = createScript();
      await scriptStore.addWorkflow(workflow);
      await scriptStore.addScript(script);

      const fixTool = makeFixTool({
        maintainerTaskId: "maintainer-task-1",
        workflowId: "workflow-1",
        expectedScriptId: "script-1",
        scriptStore,
      });

      const result = await fixTool.execute!(
        { issue: "Test issue", code: "fixed code", comment: "Fix" },
        createToolCallOptions()
      ) as FixResult;

      const updatedWorkflow = await scriptStore.getWorkflow("workflow-1");
      expect(updatedWorkflow?.active_script_id).toBe(result.script.id);
    });

    it("should clear maintenance flag after successful fix", async () => {
      const workflow = createWorkflow({ maintenance: true });
      const script = createScript();
      await scriptStore.addWorkflow(workflow);
      await scriptStore.addScript(script);

      const fixTool = makeFixTool({
        maintainerTaskId: "maintainer-task-1",
        workflowId: "workflow-1",
        expectedScriptId: "script-1",
        scriptStore,
      });

      await fixTool.execute!(
        { issue: "Test issue", code: "fixed code", comment: "Fix" },
        createToolCallOptions()
      );

      const updatedWorkflow = await scriptStore.getWorkflow("workflow-1");
      expect(updatedWorkflow?.maintenance).toBe(false);
    });

    it("should set next_run_timestamp to now for immediate re-run", async () => {
      const futureTime = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
      const workflow = createWorkflow({ next_run_timestamp: futureTime });
      const script = createScript();
      await scriptStore.addWorkflow(workflow);
      await scriptStore.addScript(script);

      const beforeFix = Date.now();

      const fixTool = makeFixTool({
        maintainerTaskId: "maintainer-task-1",
        workflowId: "workflow-1",
        expectedScriptId: "script-1",
        scriptStore,
      });

      await fixTool.execute!(
        { issue: "Test issue", code: "fixed code", comment: "Fix" },
        createToolCallOptions()
      );

      const afterFix = Date.now();

      const updatedWorkflow = await scriptStore.getWorkflow("workflow-1");
      // next_run_timestamp should be set to approximately now (within a reasonable window)
      const nextRunTime = new Date(updatedWorkflow!.next_run_timestamp).getTime();
      expect(nextRunTime).toBeGreaterThanOrEqual(beforeFix);
      expect(nextRunTime).toBeLessThanOrEqual(afterFix);
    });

    it("should persist new script to database", async () => {
      const workflow = createWorkflow();
      const script = createScript();
      await scriptStore.addWorkflow(workflow);
      await scriptStore.addScript(script);

      const fixTool = makeFixTool({
        maintainerTaskId: "maintainer-task-1",
        workflowId: "workflow-1",
        expectedScriptId: "script-1",
        scriptStore,
      });

      const result = await fixTool.execute!(
        { issue: "Test issue", code: "console.log('persisted');", comment: "Persisted fix" },
        createToolCallOptions()
      ) as FixResult;

      // Verify script was actually saved to database
      const savedScript = await scriptStore.getScript(result.script.id);
      expect(savedScript).not.toBeNull();
      expect(savedScript?.code).toBe("console.log('persisted');");
      expect(savedScript?.change_comment).toBe("Persisted fix");
    });
  });

  describe("Race condition handling - fix always saved but may not activate", () => {
    it("should return activated=false when active_script_id changed", async () => {
      // Maintainer started with script-1, but planner updated to script-2
      const workflow = createWorkflow({ active_script_id: "script-2" });
      const originalScript = createScript({ id: "script-1", major_version: 2, minor_version: 0 });
      const newPlannerScript = createScript({ id: "script-2", major_version: 3, minor_version: 0 });
      await scriptStore.addWorkflow(workflow);
      await scriptStore.addScript(originalScript);
      await scriptStore.addScript(newPlannerScript);

      const fixTool = makeFixTool({
        maintainerTaskId: "maintainer-task-1",
        workflowId: "workflow-1",
        expectedScriptId: "script-1", // Maintainer was fixing script-1
        scriptStore,
      });

      const result = await fixTool.execute!(
        { issue: "Test issue", code: "console.log('fix for v2');", comment: "Fix for original script" },
        createToolCallOptions()
      ) as FixResult;

      expect(result.activated).toBe(false);
      // Fix was saved - maintainer's work is NOT discarded
      expect(result.script.code).toBe("console.log('fix for v2');");
      expect(result.script.major_version).toBe(2); // Based on original script
    });

    it("should SAVE new script even when race condition detected", async () => {
      // Maintainer started with script-1, but planner updated to script-2
      const workflow = createWorkflow({ active_script_id: "script-2" });
      const originalScript = createScript({ id: "script-1", major_version: 2 });
      const newPlannerScript = createScript({ id: "script-2", major_version: 3 });
      await scriptStore.addWorkflow(workflow);
      await scriptStore.addScript(originalScript);
      await scriptStore.addScript(newPlannerScript);

      const scriptCountBefore = (await scriptStore.getScriptsByWorkflowId("workflow-1")).length;

      const fixTool = makeFixTool({
        maintainerTaskId: "maintainer-task-1",
        workflowId: "workflow-1",
        expectedScriptId: "script-1", // Stale script
        scriptStore,
      });

      const result = await fixTool.execute!(
        { issue: "Test issue", code: "stale fix", comment: "Fix based on old version" },
        createToolCallOptions()
      ) as FixResult;

      const scriptCountAfter = (await scriptStore.getScriptsByWorkflowId("workflow-1")).length;
      // Fix IS saved even though race detected
      expect(scriptCountAfter).toBe(scriptCountBefore + 1);
      expect(result.script.code).toBe("stale fix");
    });

    it("should clear maintenance flag when race condition detected", async () => {
      const workflow = createWorkflow({ maintenance: true, active_script_id: "script-2" });
      const originalScript = createScript({ id: "script-1", major_version: 2 });
      const newPlannerScript = createScript({ id: "script-2", major_version: 3 });
      await scriptStore.addWorkflow(workflow);
      await scriptStore.addScript(originalScript);
      await scriptStore.addScript(newPlannerScript);

      const fixTool = makeFixTool({
        maintainerTaskId: "maintainer-task-1",
        workflowId: "workflow-1",
        expectedScriptId: "script-1", // Stale script
        scriptStore,
      });

      await fixTool.execute!(
        { issue: "Test issue", code: "stale fix", comment: "Stale" },
        createToolCallOptions()
      );

      const updatedWorkflow = await scriptStore.getWorkflow("workflow-1");
      expect(updatedWorkflow?.maintenance).toBe(false);
    });

    it("should NOT update active_script_id when race condition detected", async () => {
      const workflow = createWorkflow({ active_script_id: "script-2" });
      const originalScript = createScript({ id: "script-1", major_version: 2 });
      const newPlannerScript = createScript({ id: "script-2", major_version: 3 });
      await scriptStore.addWorkflow(workflow);
      await scriptStore.addScript(originalScript);
      await scriptStore.addScript(newPlannerScript);

      const fixTool = makeFixTool({
        maintainerTaskId: "maintainer-task-1",
        workflowId: "workflow-1",
        expectedScriptId: "script-1", // Stale script
        scriptStore,
      });

      await fixTool.execute!(
        { issue: "Test issue", code: "stale fix", comment: "Should not update active_script_id" },
        createToolCallOptions()
      );

      const updatedWorkflow = await scriptStore.getWorkflow("workflow-1");
      // Active script should still be the planner's new version
      expect(updatedWorkflow?.active_script_id).toBe("script-2");
    });
  });

  describe("onCalled callback", () => {
    it("should invoke onCalled callback when fix tool executes", async () => {
      const workflow = createWorkflow();
      const script = createScript();
      await scriptStore.addWorkflow(workflow);
      await scriptStore.addScript(script);

      let callbackResult: FixResult | null = null;
      const fixTool = makeFixTool({
        maintainerTaskId: "maintainer-task-1",
        workflowId: "workflow-1",
        expectedScriptId: "script-1",
        scriptStore,
        onCalled: (result) => {
          callbackResult = result;
        },
      });

      const executeResult = await fixTool.execute!(
        { issue: "Test issue", code: "fixed code", comment: "Fix" },
        createToolCallOptions()
      ) as FixResult;

      expect(callbackResult).not.toBeNull();
      expect(callbackResult!.activated).toBe(true);
      expect(callbackResult!.script.id).toBe(executeResult.script.id);
    });

    it("should invoke onCalled callback even on race condition", async () => {
      const workflow = createWorkflow({ active_script_id: "script-2" });
      const originalScript = createScript({ id: "script-1" });
      const newPlannerScript = createScript({ id: "script-2", major_version: 2 });
      await scriptStore.addWorkflow(workflow);
      await scriptStore.addScript(originalScript);
      await scriptStore.addScript(newPlannerScript);

      let callbackInvoked = false;
      let callbackActivated: boolean | null = null;
      const fixTool = makeFixTool({
        maintainerTaskId: "maintainer-task-1",
        workflowId: "workflow-1",
        expectedScriptId: "script-1",
        scriptStore,
        onCalled: (result) => {
          callbackInvoked = true;
          callbackActivated = result.activated;
        },
      });

      await fixTool.execute!(
        { issue: "Test issue", code: "stale fix", comment: "Stale fix" },
        createToolCallOptions()
      );

      expect(callbackInvoked).toBe(true);
      expect(callbackActivated).toBe(false);
    });
  });

  describe("Error handling", () => {
    it("should throw error if workflow not found", async () => {
      const fixTool = makeFixTool({
        maintainerTaskId: "maintainer-task-1",
        workflowId: "non-existent-workflow",
        expectedScriptId: "script-1",
        scriptStore,
      });

      await expect(
        fixTool.execute!(
          { issue: "Test issue", code: "code", comment: "comment" },
          createToolCallOptions()
        )
      ).rejects.toThrow("Workflow not found: non-existent-workflow");
    });

    it("should throw error if workflow has no active script", async () => {
      const workflow = createWorkflow({ active_script_id: "" });
      await scriptStore.addWorkflow(workflow);

      const fixTool = makeFixTool({
        maintainerTaskId: "maintainer-task-1",
        workflowId: "workflow-1",
        expectedScriptId: "script-1",
        scriptStore,
      });

      await expect(
        fixTool.execute!(
          { issue: "Test issue", code: "code", comment: "comment" },
          createToolCallOptions()
        )
      ).rejects.toThrow("Workflow workflow-1 has no active script");
    });

    it("should throw error if expected script not found", async () => {
      const workflow = createWorkflow();
      await scriptStore.addWorkflow(workflow);
      // Don't add any scripts

      const fixTool = makeFixTool({
        maintainerTaskId: "maintainer-task-1",
        workflowId: "workflow-1",
        expectedScriptId: "non-existent-script",
        scriptStore,
      });

      await expect(
        fixTool.execute!(
          { issue: "Test issue", code: "code", comment: "comment" },
          createToolCallOptions()
        )
      ).rejects.toThrow("Original script not found: non-existent-script");
    });
  });

  describe("Multiple minor version increments", () => {
    it("should correctly increment minor version on successive fixes", async () => {
      const workflow = createWorkflow();
      const script = createScript({ major_version: 2, minor_version: 0 });
      await scriptStore.addWorkflow(workflow);
      await scriptStore.addScript(script);

      // First fix: 2.0 -> 2.1
      const fixTool1 = makeFixTool({
        maintainerTaskId: "maintainer-task-1",
        workflowId: "workflow-1",
        expectedScriptId: "script-1",
        scriptStore,
      });

      const result1 = await fixTool1.execute!(
        { issue: "Test issue", code: "fix 1", comment: "First fix" },
        createToolCallOptions()
      ) as FixResult;

      expect(result1.script.major_version).toBe(2);
      expect(result1.script.minor_version).toBe(1);

      // Second fix: need to use the new script as expected
      const fixTool2 = makeFixTool({
        maintainerTaskId: "maintainer-task-2",
        workflowId: "workflow-1",
        expectedScriptId: result1.script.id, // Use the new script ID
        scriptStore,
      });

      const result2 = await fixTool2.execute!(
        { issue: "Test issue", code: "fix 2", comment: "Second fix" },
        createToolCallOptions()
      ) as FixResult;

      expect(result2.script.major_version).toBe(2);
      expect(result2.script.minor_version).toBe(2);
    });
  });

  describe("Workflow ID preservation", () => {
    it("should set workflow_id correctly on new script", async () => {
      const workflow = createWorkflow({ id: "my-workflow-123", active_script_id: "my-script" });
      const script = createScript({ id: "my-script", workflow_id: "my-workflow-123" });
      await scriptStore.addWorkflow(workflow);
      await scriptStore.addScript(script);

      const fixTool = makeFixTool({
        maintainerTaskId: "maintainer-task-1",
        workflowId: "my-workflow-123",
        expectedScriptId: "my-script",
        scriptStore,
      });

      const result = await fixTool.execute!(
        { issue: "Test issue", code: "fixed", comment: "Fix" },
        createToolCallOptions()
      ) as FixResult;

      expect(result.script.workflow_id).toBe("my-workflow-123");
    });
  });
});
