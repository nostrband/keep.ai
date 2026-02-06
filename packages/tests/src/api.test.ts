import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DBInterface, KeepDb, KeepDbApi, TaskStore, ScriptStore, InboxStore } from "@app/db";
import { createDBNode } from "@app/node";

/**
 * Helper to create all tables needed for KeepDbApi tests without full migration system.
 * This allows testing the API in isolation without CR-SQLite dependencies.
 */
async function createApiTables(db: DBInterface): Promise<void> {
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
      intent_spec TEXT NOT NULL DEFAULT ''
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
}

describe("KeepDbApi", () => {
  let db: DBInterface;
  let keepDb: KeepDb;
  let api: KeepDbApi;

  beforeEach(async () => {
    db = await createDBNode(":memory:");
    keepDb = new KeepDb(db);
    await createApiTables(db);
    api = new KeepDbApi(keepDb);
  });

  afterEach(async () => {
    if (db) {
      await db.close();
    }
  });

  describe("enterMaintenanceMode", () => {
    const workflowId = "workflow-1";
    const workflowTitle = "Test Workflow";
    const scriptRunId = "script-run-1";

    beforeEach(async () => {
      // Create a workflow with maintenance_fix_count = 0
      await db.exec(
        `INSERT INTO workflows (id, title, task_id, chat_id, timestamp, status, maintenance, maintenance_fix_count)
         VALUES (?, ?, ?, ?, ?, ?, 0, 0)`,
        [workflowId, workflowTitle, "task-0", "chat-0", new Date().toISOString(), "active"]
      );
    });

    it("should create maintainer task with correct properties", async () => {
      const result = await api.enterMaintenanceMode({
        workflowId,
        workflowTitle,
        scriptRunId,
      });

      expect(result.maintainerTask).toBeDefined();
      expect(result.maintainerTask.type).toBe("maintainer");
      expect(result.maintainerTask.workflow_id).toBe(workflowId);
      expect(result.maintainerTask.chat_id).toBe(""); // Maintainer does NOT write to user-facing chat
      expect(result.maintainerTask.title).toBe(`Auto-fix: ${workflowTitle}`);
      expect(result.maintainerTask.thread_id).toBeTruthy(); // Should have own thread
    });

    it("should increment maintenance_fix_count and return new count", async () => {
      // First call
      const result1 = await api.enterMaintenanceMode({
        workflowId,
        workflowTitle,
        scriptRunId: "run-1",
      });
      expect(result1.newFixCount).toBe(1);

      // Second call - should increment again
      const result2 = await api.enterMaintenanceMode({
        workflowId,
        workflowTitle,
        scriptRunId: "run-2",
      });
      expect(result2.newFixCount).toBe(2);
    });

    it("should set maintenance flag to true", async () => {
      await api.enterMaintenanceMode({
        workflowId,
        workflowTitle,
        scriptRunId,
      });

      const result = await db.execO<{ maintenance: number }>(
        `SELECT maintenance FROM workflows WHERE id = ?`,
        [workflowId]
      );
      expect(result).toBeTruthy();
      expect(result![0].maintenance).toBe(1);
    });

    it("should create inbox item targeting maintainer task", async () => {
      const result = await api.enterMaintenanceMode({
        workflowId,
        workflowTitle,
        scriptRunId,
      });

      expect(result.inboxItemId).toBeTruthy();
      expect(result.inboxItemId).toContain("maintenance.");
      expect(result.inboxItemId).toContain(workflowId);
      expect(result.inboxItemId).toContain(scriptRunId);

      // Verify inbox item exists and targets the maintainer task
      const inboxResult = await db.execO<{ target: string; target_id: string; source: string; source_id: string }>(
        `SELECT target, target_id, source, source_id FROM inbox WHERE id = ?`,
        [result.inboxItemId]
      );
      expect(inboxResult).toBeTruthy();
      expect(inboxResult!.length).toBe(1);
      expect(inboxResult![0].target).toBe("maintainer");
      expect(inboxResult![0].target_id).toBe(result.maintainerTask.id);
      expect(inboxResult![0].source).toBe("script");
      expect(inboxResult![0].source_id).toBe(scriptRunId);
    });

    it("should include scriptRunId in inbox item metadata", async () => {
      const result = await api.enterMaintenanceMode({
        workflowId,
        workflowTitle,
        scriptRunId,
      });

      const inboxResult = await db.execO<{ content: string }>(
        `SELECT content FROM inbox WHERE id = ?`,
        [result.inboxItemId]
      );
      expect(inboxResult).toBeTruthy();

      const content = JSON.parse(inboxResult![0].content);
      expect(content.metadata.scriptRunId).toBe(scriptRunId);
    });

    it("should make maintainer task queryable via getMaintainerTasksForWorkflow", async () => {
      const result = await api.enterMaintenanceMode({
        workflowId,
        workflowTitle,
        scriptRunId,
      });

      const maintainerTasks = await api.taskStore.getMaintainerTasksForWorkflow(workflowId);
      expect(maintainerTasks.length).toBe(1);
      expect(maintainerTasks[0].id).toBe(result.maintainerTask.id);
      expect(maintainerTasks[0].type).toBe("maintainer");
    });

    it("should create unique maintainer tasks for each call", async () => {
      const result1 = await api.enterMaintenanceMode({
        workflowId,
        workflowTitle,
        scriptRunId: "run-1",
      });

      const result2 = await api.enterMaintenanceMode({
        workflowId,
        workflowTitle,
        scriptRunId: "run-2",
      });

      // Tasks should have different IDs
      expect(result1.maintainerTask.id).not.toBe(result2.maintainerTask.id);

      // Both tasks should exist
      const maintainerTasks = await api.taskStore.getMaintainerTasksForWorkflow(workflowId);
      expect(maintainerTasks.length).toBe(2);
    });

    it("should be atomic - all operations succeed together", async () => {
      const result = await api.enterMaintenanceMode({
        workflowId,
        workflowTitle,
        scriptRunId,
      });

      // All of these should exist after a successful call
      const workflow = await db.execO<{ maintenance: number; maintenance_fix_count: number }>(
        `SELECT maintenance, maintenance_fix_count FROM workflows WHERE id = ?`,
        [workflowId]
      );
      expect(workflow![0].maintenance).toBe(1);
      expect(workflow![0].maintenance_fix_count).toBe(1);

      const task = await db.execO<{ id: string }>(
        `SELECT id FROM tasks WHERE id = ?`,
        [result.maintainerTask.id]
      );
      expect(task!.length).toBe(1);

      const inbox = await db.execO<{ id: string }>(
        `SELECT id FROM inbox WHERE id = ?`,
        [result.inboxItemId]
      );
      expect(inbox!.length).toBe(1);
    });
  });
});
