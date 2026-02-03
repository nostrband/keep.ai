import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DBInterface, KeepDb, ScriptStore, Script, Workflow } from "@app/db";
import { createDBNode } from "@app/node";
import { makeSaveTool, SaveResult } from "@app/agent";

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
 * Helper to create scripts, workflows, tasks tables without full migration system.
 * This allows testing the save tool in isolation without CR-SQLite dependencies.
 */
async function createSaveToolTables(db: DBInterface): Promise<void> {
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
      handler_config TEXT NOT NULL DEFAULT ''
    )
  `);
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_workflows_task_id ON workflows(task_id)`);

  // Create tasks table (needed for some queries)
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
}

describe("Save Tool", () => {
  let db: DBInterface;
  let keepDb: KeepDb;
  let scriptStore: ScriptStore;

  beforeEach(async () => {
    db = await createDBNode(":memory:");
    keepDb = new KeepDb(db);
    await createSaveToolTables(db);
    scriptStore = new ScriptStore(keepDb);
  });

  afterEach(async () => {
    if (db) {
      await db.close();
    }
  });

  const createWorkflow = (overrides: Partial<Workflow> = {}): Workflow => ({
    id: "workflow-1",
    title: "",
    task_id: "task-1",
    chat_id: "chat-1",
    timestamp: new Date().toISOString(),
    cron: "",
    events: "",
    status: "draft",
    next_run_timestamp: "",
    maintenance: false,
    maintenance_fix_count: 0,
    active_script_id: "",
    handler_config: "",
    ...overrides,
  });

  const createScript = (overrides: Partial<Script> = {}): Script => ({
    id: "script-1",
    task_id: "task-1",
    major_version: 1,
    minor_version: 0,
    timestamp: new Date().toISOString(),
    code: "console.log('original');",
    change_comment: "",
    workflow_id: "workflow-1",
    type: "",
    summary: "",
    diagram: "",
    ...overrides,
  });

  describe("Version management", () => {
    it("should start first script at version 1.0", async () => {
      const workflow = createWorkflow();
      await scriptStore.addWorkflow(workflow);

      const saveTool = makeSaveTool({
        taskId: "task-1",
        taskRunId: "run-1",
        chatId: "chat-1",
        scriptStore,
      });

      const result = await saveTool.execute!(
        { code: "console.log('first');", title: "My Workflow" },
        createToolCallOptions()
      ) as SaveResult;

      expect(result.script.major_version).toBe(1);
      expect(result.script.minor_version).toBe(0);
    });

    it("should increment major_version and reset minor_version to 0", async () => {
      const workflow = createWorkflow();
      const existingScript = createScript({
        major_version: 2,
        minor_version: 3, // Has minor version from previous maintainer fixes
      });
      await scriptStore.addWorkflow(workflow);
      await scriptStore.addScript(existingScript);

      const saveTool = makeSaveTool({
        taskId: "task-1",
        taskRunId: "run-1",
        chatId: "chat-1",
        scriptStore,
      });

      const result = await saveTool.execute!(
        { code: "console.log('new major');", title: "Updated Workflow" },
        createToolCallOptions()
      ) as SaveResult;

      expect(result.script.major_version).toBe(3); // Incremented from 2
      expect(result.script.minor_version).toBe(0); // Reset from 3
    });

    it("should correctly version from 1.5 to 2.0", async () => {
      const workflow = createWorkflow();
      const existingScript = createScript({
        major_version: 1,
        minor_version: 5, // Multiple maintainer fixes on version 1
      });
      await scriptStore.addWorkflow(workflow);
      await scriptStore.addScript(existingScript);

      const saveTool = makeSaveTool({
        taskId: "task-1",
        taskRunId: "run-1",
        chatId: "chat-1",
        scriptStore,
      });

      const result = await saveTool.execute!(
        { code: "major update", title: "Title" },
        createToolCallOptions()
      ) as SaveResult;

      expect(result.script.major_version).toBe(2);
      expect(result.script.minor_version).toBe(0);
    });
  });

  describe("Maintenance mode handling", () => {
    it("should return wasMaintenanceFix=true when workflow was in maintenance mode", async () => {
      const workflow = createWorkflow({ maintenance: true });
      await scriptStore.addWorkflow(workflow);

      const saveTool = makeSaveTool({
        taskId: "task-1",
        taskRunId: "run-1",
        chatId: "chat-1",
        scriptStore,
      });

      const result = await saveTool.execute!(
        { code: "code", title: "Title" },
        createToolCallOptions()
      ) as SaveResult;

      expect(result.wasMaintenanceFix).toBe(true);
    });

    it("should return wasMaintenanceFix=false when workflow was not in maintenance mode", async () => {
      const workflow = createWorkflow({ maintenance: false });
      await scriptStore.addWorkflow(workflow);

      const saveTool = makeSaveTool({
        taskId: "task-1",
        taskRunId: "run-1",
        chatId: "chat-1",
        scriptStore,
      });

      const result = await saveTool.execute!(
        { code: "code", title: "Title" },
        createToolCallOptions()
      ) as SaveResult;

      expect(result.wasMaintenanceFix).toBe(false);
    });

    it("should clear maintenance flag after save", async () => {
      const workflow = createWorkflow({ maintenance: true });
      await scriptStore.addWorkflow(workflow);

      const saveTool = makeSaveTool({
        taskId: "task-1",
        taskRunId: "run-1",
        chatId: "chat-1",
        scriptStore,
      });

      await saveTool.execute!(
        { code: "code", title: "Title" },
        createToolCallOptions()
      );

      const updatedWorkflow = await scriptStore.getWorkflow("workflow-1");
      expect(updatedWorkflow?.maintenance).toBe(false);
    });

    it("should set next_run_timestamp when clearing maintenance", async () => {
      const futureTime = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
      const workflow = createWorkflow({
        maintenance: true,
        next_run_timestamp: futureTime,
      });
      await scriptStore.addWorkflow(workflow);

      const beforeSave = Date.now();

      const saveTool = makeSaveTool({
        taskId: "task-1",
        taskRunId: "run-1",
        chatId: "chat-1",
        scriptStore,
      });

      await saveTool.execute!(
        { code: "code", title: "Title" },
        createToolCallOptions()
      );

      const afterSave = Date.now();
      const updatedWorkflow = await scriptStore.getWorkflow("workflow-1");

      // Should be set to approximately now for immediate re-run
      const nextRunTime = new Date(updatedWorkflow!.next_run_timestamp).getTime();
      expect(nextRunTime).toBeGreaterThanOrEqual(beforeSave);
      expect(nextRunTime).toBeLessThanOrEqual(afterSave);
    });
  });

  describe("Workflow status transitions", () => {
    it("should transition workflow from draft to ready on first save", async () => {
      const workflow = createWorkflow({ status: "draft" });
      await scriptStore.addWorkflow(workflow);

      const saveTool = makeSaveTool({
        taskId: "task-1",
        taskRunId: "run-1",
        chatId: "chat-1",
        scriptStore,
      });

      await saveTool.execute!(
        { code: "code", title: "My Workflow" },
        createToolCallOptions()
      );

      const updatedWorkflow = await scriptStore.getWorkflow("workflow-1");
      expect(updatedWorkflow?.status).toBe("ready");
    });

    it("should NOT change status for non-draft workflows", async () => {
      const workflow = createWorkflow({ status: "active" });
      const script = createScript();
      await scriptStore.addWorkflow(workflow);
      await scriptStore.addScript(script);

      const saveTool = makeSaveTool({
        taskId: "task-1",
        taskRunId: "run-1",
        chatId: "chat-1",
        scriptStore,
      });

      await saveTool.execute!(
        { code: "updated code", title: "Updated" },
        createToolCallOptions()
      );

      const updatedWorkflow = await scriptStore.getWorkflow("workflow-1");
      expect(updatedWorkflow?.status).toBe("active");
    });
  });

  describe("Title handling", () => {
    it("should set workflow title on first save when workflow has no title", async () => {
      const workflow = createWorkflow({ title: "" });
      await scriptStore.addWorkflow(workflow);

      const saveTool = makeSaveTool({
        taskId: "task-1",
        taskRunId: "run-1",
        chatId: "chat-1",
        scriptStore,
      });

      await saveTool.execute!(
        { code: "code", title: "My New Workflow" },
        createToolCallOptions()
      );

      const updatedWorkflow = await scriptStore.getWorkflow("workflow-1");
      expect(updatedWorkflow?.title).toBe("My New Workflow");
    });

    it("should NOT overwrite existing workflow title", async () => {
      const workflow = createWorkflow({ title: "Original Title" });
      const script = createScript();
      await scriptStore.addWorkflow(workflow);
      await scriptStore.addScript(script);

      const saveTool = makeSaveTool({
        taskId: "task-1",
        taskRunId: "run-1",
        chatId: "chat-1",
        scriptStore,
      });

      await saveTool.execute!(
        { code: "code", title: "New Title Attempt" },
        createToolCallOptions()
      );

      const updatedWorkflow = await scriptStore.getWorkflow("workflow-1");
      expect(updatedWorkflow?.title).toBe("Original Title");
    });

    it("should update title when current title is only whitespace", async () => {
      const workflow = createWorkflow({ title: "   " });
      await scriptStore.addWorkflow(workflow);

      const saveTool = makeSaveTool({
        taskId: "task-1",
        taskRunId: "run-1",
        chatId: "chat-1",
        scriptStore,
      });

      await saveTool.execute!(
        { code: "code", title: "Real Title" },
        createToolCallOptions()
      );

      const updatedWorkflow = await scriptStore.getWorkflow("workflow-1");
      expect(updatedWorkflow?.title).toBe("Real Title");
    });
  });

  describe("Active script management", () => {
    it("should update workflow active_script_id to new script", async () => {
      const workflow = createWorkflow({ active_script_id: "" });
      await scriptStore.addWorkflow(workflow);

      const saveTool = makeSaveTool({
        taskId: "task-1",
        taskRunId: "run-1",
        chatId: "chat-1",
        scriptStore,
      });

      const result = await saveTool.execute!(
        { code: "code", title: "Title" },
        createToolCallOptions()
      ) as SaveResult;

      const updatedWorkflow = await scriptStore.getWorkflow("workflow-1");
      expect(updatedWorkflow?.active_script_id).toBe(result.script.id);
    });

    it("should persist script with correct properties", async () => {
      const workflow = createWorkflow();
      await scriptStore.addWorkflow(workflow);

      const saveTool = makeSaveTool({
        taskId: "task-1",
        taskRunId: "run-1",
        chatId: "chat-1",
        scriptStore,
      });

      const result = await saveTool.execute!(
        {
          code: "console.log('hello');",
          title: "Test Workflow",
          comments: "Initial implementation",
          summary: "Logs hello to console",
          diagram: "flowchart TD\nA-->B",
        },
        createToolCallOptions()
      ) as SaveResult;

      const savedScript = await scriptStore.getScript(result.script.id);
      expect(savedScript).not.toBeNull();
      expect(savedScript?.code).toBe("console.log('hello');");
      expect(savedScript?.change_comment).toBe("Initial implementation");
      expect(savedScript?.summary).toBe("Logs hello to console");
      expect(savedScript?.diagram).toBe("flowchart TD\nA-->B");
      expect(savedScript?.task_id).toBe("task-1");
      expect(savedScript?.workflow_id).toBe("workflow-1");
    });
  });

  describe("Error handling", () => {
    it("should throw error if workflow not found for task", async () => {
      // No workflow created for task-1

      const saveTool = makeSaveTool({
        taskId: "task-1",
        taskRunId: "run-1",
        chatId: "chat-1",
        scriptStore,
      });

      await expect(
        saveTool.execute!(
          { code: "code", title: "Title" },
          createToolCallOptions()
        )
      ).rejects.toThrow("Workflow not found for task task-1");
    });
  });

  describe("Successive major version increments", () => {
    it("should correctly increment major version on successive saves", async () => {
      const workflow = createWorkflow();
      await scriptStore.addWorkflow(workflow);

      const saveTool = makeSaveTool({
        taskId: "task-1",
        taskRunId: "run-1",
        chatId: "chat-1",
        scriptStore,
      });

      // First save: 1.0
      const result1 = await saveTool.execute!(
        { code: "v1", title: "Workflow" },
        createToolCallOptions()
      ) as SaveResult;
      expect(result1.script.major_version).toBe(1);
      expect(result1.script.minor_version).toBe(0);

      // Second save: 2.0
      const result2 = await saveTool.execute!(
        { code: "v2", title: "Workflow" },
        createToolCallOptions()
      ) as SaveResult;
      expect(result2.script.major_version).toBe(2);
      expect(result2.script.minor_version).toBe(0);

      // Third save: 3.0
      const result3 = await saveTool.execute!(
        { code: "v3", title: "Workflow" },
        createToolCallOptions()
      ) as SaveResult;
      expect(result3.script.major_version).toBe(3);
      expect(result3.script.minor_version).toBe(0);
    });
  });

  describe("Version interaction between save and fix", () => {
    it("should correctly version after maintainer fix: 1.0 -> 1.1 (fix) -> 2.0 (save)", async () => {
      const workflow = createWorkflow();
      await scriptStore.addWorkflow(workflow);

      // First save: 1.0
      const saveTool = makeSaveTool({
        taskId: "task-1",
        taskRunId: "run-1",
        chatId: "chat-1",
        scriptStore,
      });

      const result1 = await saveTool.execute!(
        { code: "v1.0", title: "Workflow" },
        createToolCallOptions()
      ) as SaveResult;
      expect(result1.script.major_version).toBe(1);
      expect(result1.script.minor_version).toBe(0);

      // Simulate maintainer fix: 1.1 (manually add script with minor version)
      const fixedScript = createScript({
        id: "script-fix",
        major_version: 1,
        minor_version: 1,
        code: "v1.1 (fixed)",
      });
      await scriptStore.addScript(fixedScript);

      // Next save should be 2.0 (based on highest major version found)
      const result2 = await saveTool.execute!(
        { code: "v2.0", title: "Workflow" },
        createToolCallOptions()
      ) as SaveResult;
      expect(result2.script.major_version).toBe(2);
      expect(result2.script.minor_version).toBe(0);
    });
  });

  describe("Optional fields handling", () => {
    it("should handle missing optional fields gracefully", async () => {
      const workflow = createWorkflow();
      await scriptStore.addWorkflow(workflow);

      const saveTool = makeSaveTool({
        taskId: "task-1",
        taskRunId: "run-1",
        chatId: "chat-1",
        scriptStore,
      });

      const result = await saveTool.execute!(
        { code: "minimal code", title: "Minimal" },
        createToolCallOptions()
      ) as SaveResult;

      expect(result.script.change_comment).toBe("");
      expect(result.script.summary).toBe("");
      expect(result.script.diagram).toBe("");
    });
  });
});
