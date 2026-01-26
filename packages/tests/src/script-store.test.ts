import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DBInterface, KeepDb, ScriptStore, Script, ScriptRun, Workflow } from "@app/db";
import { createDBNode } from "@app/node";

/**
 * Helper to create scripts, script_runs, and workflows tables without full migration system.
 * This allows testing the store in isolation without CR-SQLite dependencies.
 */
async function createScriptTables(db: DBInterface): Promise<void> {
  // Create scripts table (matches production v11 + v16 + later migrations)
  await db.exec(`
    CREATE TABLE IF NOT EXISTS scripts (
      id TEXT PRIMARY KEY NOT NULL,
      task_id TEXT NOT NULL DEFAULT '',
      version INTEGER NOT NULL DEFAULT 0,
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

  // Create script_runs table (matches production v11 + v12 + v16 + later migrations)
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
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_script_runs_script_id ON script_runs(script_id)`);
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_script_runs_workflow_id ON script_runs(workflow_id)`);

  // Create workflows table (matches production v16 + later migrations)
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
      active_script_id TEXT NOT NULL DEFAULT ''
    )
  `);
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_workflows_task_id ON workflows(task_id)`);
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_workflows_chat_id ON workflows(chat_id)`);
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_workflows_status ON workflows(status)`);

  // Create tasks table (matches production v1 + v15 + v31 migrations, needed for abandoned drafts queries)
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
      deleted INTEGER NOT NULL DEFAULT 0
    )
  `);

  // Create chat_messages table (matches production v30 migration, needed for abandoned drafts queries)
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

describe("ScriptStore", () => {
  let db: DBInterface;
  let keepDb: KeepDb;
  let scriptStore: ScriptStore;

  beforeEach(async () => {
    db = await createDBNode(":memory:");
    keepDb = new KeepDb(db);
    await createScriptTables(db);
    scriptStore = new ScriptStore(keepDb);
  });

  afterEach(async () => {
    if (db) {
      await db.close();
    }
  });

  describe("Script CRUD operations", () => {
    it("should add and retrieve a script", async () => {
      const script: Script = {
        id: "script-1",
        task_id: "task-1",
        version: 1,
        timestamp: new Date().toISOString(),
        code: "console.log('hello');",
        change_comment: "Initial version",
        workflow_id: "workflow-1",
        type: "cron",
        summary: "Logs hello",
        diagram: "flowchart TD",
      };

      await scriptStore.addScript(script);
      const retrieved = await scriptStore.getScript("script-1");

      expect(retrieved).toEqual(script);
    });

    it("should return null for non-existent script", async () => {
      const result = await scriptStore.getScript("non-existent");
      expect(result).toBeNull();
    });

    it("should list scripts with pagination", async () => {
      const now = Date.now();
      for (let i = 0; i < 5; i++) {
        await scriptStore.addScript({
          id: `script-${i}`,
          task_id: "task-1",
          version: i + 1,
          timestamp: new Date(now + i * 1000).toISOString(),
          code: `code ${i}`,
          change_comment: `version ${i + 1}`,
          workflow_id: "workflow-1",
          type: "cron",
          summary: "",
          diagram: "",
        });
      }

      const all = await scriptStore.listScripts();
      expect(all).toHaveLength(5);
      // Should be ordered by timestamp DESC (most recent first)
      expect(all[0].id).toBe("script-4");

      const limited = await scriptStore.listScripts(undefined, 2, 0);
      expect(limited).toHaveLength(2);

      const offset = await scriptStore.listScripts(undefined, 2, 2);
      expect(offset).toHaveLength(2);
      expect(offset[0].id).toBe("script-2");
    });

    it("should filter scripts by task_id", async () => {
      await scriptStore.addScript({
        id: "script-1",
        task_id: "task-1",
        version: 1,
        timestamp: new Date().toISOString(),
        code: "code 1",
        change_comment: "",
        workflow_id: "workflow-1",
        type: "",
        summary: "",
        diagram: "",
      });
      await scriptStore.addScript({
        id: "script-2",
        task_id: "task-2",
        version: 1,
        timestamp: new Date().toISOString(),
        code: "code 2",
        change_comment: "",
        workflow_id: "workflow-2",
        type: "",
        summary: "",
        diagram: "",
      });

      const task1Scripts = await scriptStore.listScripts("task-1");
      expect(task1Scripts).toHaveLength(1);
      expect(task1Scripts[0].id).toBe("script-1");
    });

    it("should get scripts by task_id ordered by version", async () => {
      await scriptStore.addScript({
        id: "script-v1",
        task_id: "task-1",
        version: 1,
        timestamp: new Date().toISOString(),
        code: "v1",
        change_comment: "",
        workflow_id: "workflow-1",
        type: "",
        summary: "",
        diagram: "",
      });
      await scriptStore.addScript({
        id: "script-v3",
        task_id: "task-1",
        version: 3,
        timestamp: new Date().toISOString(),
        code: "v3",
        change_comment: "",
        workflow_id: "workflow-1",
        type: "",
        summary: "",
        diagram: "",
      });
      await scriptStore.addScript({
        id: "script-v2",
        task_id: "task-1",
        version: 2,
        timestamp: new Date().toISOString(),
        code: "v2",
        change_comment: "",
        workflow_id: "workflow-1",
        type: "",
        summary: "",
        diagram: "",
      });

      const scripts = await scriptStore.getScriptsByTaskId("task-1");
      expect(scripts).toHaveLength(3);
      // Should be ordered by version ASC
      expect(scripts[0].version).toBe(1);
      expect(scripts[1].version).toBe(2);
      expect(scripts[2].version).toBe(3);
    });

    it("should get latest script by task_id", async () => {
      await scriptStore.addScript({
        id: "script-v1",
        task_id: "task-1",
        version: 1,
        timestamp: new Date().toISOString(),
        code: "v1",
        change_comment: "",
        workflow_id: "",
        type: "",
        summary: "",
        diagram: "",
      });
      await scriptStore.addScript({
        id: "script-v2",
        task_id: "task-1",
        version: 2,
        timestamp: new Date().toISOString(),
        code: "v2",
        change_comment: "",
        workflow_id: "",
        type: "",
        summary: "",
        diagram: "",
      });

      const latest = await scriptStore.getLatestScriptByTaskId("task-1");
      expect(latest?.version).toBe(2);
      expect(latest?.id).toBe("script-v2");
    });

    it("should get scripts by workflow_id", async () => {
      await scriptStore.addScript({
        id: "script-1",
        task_id: "task-1",
        version: 1,
        timestamp: new Date().toISOString(),
        code: "code 1",
        change_comment: "",
        workflow_id: "workflow-1",
        type: "",
        summary: "",
        diagram: "",
      });
      await scriptStore.addScript({
        id: "script-2",
        task_id: "task-2",
        version: 1,
        timestamp: new Date().toISOString(),
        code: "code 2",
        change_comment: "",
        workflow_id: "workflow-2",
        type: "",
        summary: "",
        diagram: "",
      });

      const scripts = await scriptStore.getScriptsByWorkflowId("workflow-1");
      expect(scripts).toHaveLength(1);
      expect(scripts[0].id).toBe("script-1");
    });

    it("should get latest script by workflow_id", async () => {
      await scriptStore.addScript({
        id: "script-v1",
        task_id: "task-1",
        version: 1,
        timestamp: new Date().toISOString(),
        code: "v1",
        change_comment: "",
        workflow_id: "workflow-1",
        type: "",
        summary: "",
        diagram: "",
      });
      await scriptStore.addScript({
        id: "script-v2",
        task_id: "task-1",
        version: 2,
        timestamp: new Date().toISOString(),
        code: "v2",
        change_comment: "",
        workflow_id: "workflow-1",
        type: "",
        summary: "",
        diagram: "",
      });

      const latest = await scriptStore.getLatestScriptByWorkflowId("workflow-1");
      expect(latest?.version).toBe(2);
    });

    it("should list latest scripts for each task", async () => {
      // Add multiple versions for two tasks
      await scriptStore.addScript({
        id: "t1-v1",
        task_id: "task-1",
        version: 1,
        timestamp: new Date(Date.now() - 3000).toISOString(),
        code: "t1v1",
        change_comment: "",
        workflow_id: "",
        type: "",
        summary: "",
        diagram: "",
      });
      await scriptStore.addScript({
        id: "t1-v2",
        task_id: "task-1",
        version: 2,
        timestamp: new Date(Date.now() - 2000).toISOString(),
        code: "t1v2",
        change_comment: "",
        workflow_id: "",
        type: "",
        summary: "",
        diagram: "",
      });
      await scriptStore.addScript({
        id: "t2-v1",
        task_id: "task-2",
        version: 1,
        timestamp: new Date(Date.now() - 1000).toISOString(),
        code: "t2v1",
        change_comment: "",
        workflow_id: "",
        type: "",
        summary: "",
        diagram: "",
      });

      const latest = await scriptStore.listLatestScripts();
      expect(latest).toHaveLength(2);
      // Should only include the highest version for each task
      expect(latest.find(s => s.task_id === "task-1")?.version).toBe(2);
      expect(latest.find(s => s.task_id === "task-2")?.version).toBe(1);
    });
  });

  describe("ScriptRun operations", () => {
    it("should start and finish a script run", async () => {
      const runId = "run-1";
      const startTime = new Date().toISOString();

      await scriptStore.startScriptRun(runId, "script-1", startTime, "workflow-1", "scheduled");

      let run = await scriptStore.getScriptRun(runId);
      expect(run?.id).toBe(runId);
      expect(run?.script_id).toBe("script-1");
      expect(run?.start_timestamp).toBe(startTime);
      expect(run?.end_timestamp).toBe("");
      expect(run?.workflow_id).toBe("workflow-1");

      const endTime = new Date().toISOString();
      await scriptStore.finishScriptRun(runId, endTime, "Success", "", "", "", 1000);

      run = await scriptStore.getScriptRun(runId);
      expect(run?.end_timestamp).toBe(endTime);
      expect(run?.result).toBe("Success");
      expect(run?.error).toBe("");
      expect(run?.cost).toBe(1000);
    });

    it("should record errors in script runs", async () => {
      await scriptStore.startScriptRun("run-1", "script-1", new Date().toISOString());
      await scriptStore.finishScriptRun(
        "run-1",
        new Date().toISOString(),
        "",
        "Authentication failed",
        "auth error log",
        "auth"
      );

      const run = await scriptStore.getScriptRun("run-1");
      expect(run?.error).toBe("Authentication failed");
      expect(run?.error_type).toBe("auth");
      expect(run?.logs).toBe("auth error log");
    });

    it("should track retry information", async () => {
      // Original run
      await scriptStore.startScriptRun("run-original", "script-1", new Date().toISOString());
      await scriptStore.finishScriptRun("run-original", new Date().toISOString(), "", "Error", "", "logic");

      // Retry run
      await scriptStore.startScriptRun(
        "run-retry-1",
        "script-1",
        new Date().toISOString(),
        "",
        "",
        "run-original",
        1
      );

      const retry = await scriptStore.getScriptRun("run-retry-1");
      expect(retry?.retry_of).toBe("run-original");
      expect(retry?.retry_count).toBe(1);

      // Get retries of original
      const retries = await scriptStore.getRetriesOfRun("run-original");
      expect(retries).toHaveLength(1);
      expect(retries[0].id).toBe("run-retry-1");
    });

    it("should list script runs by script_id", async () => {
      const now = Date.now();
      await scriptStore.startScriptRun("run-1", "script-1", new Date(now - 2000).toISOString());
      await scriptStore.startScriptRun("run-2", "script-1", new Date(now - 1000).toISOString());
      await scriptStore.startScriptRun("run-3", "script-2", new Date(now).toISOString());

      const runs = await scriptStore.listScriptRuns("script-1");
      expect(runs).toHaveLength(2);
      // Should be ordered by start_timestamp DESC
      expect(runs[0].id).toBe("run-2");
    });

    it("should get script runs by workflow_id", async () => {
      await scriptStore.startScriptRun("run-1", "script-1", new Date().toISOString(), "workflow-1");
      await scriptStore.startScriptRun("run-2", "script-2", new Date().toISOString(), "workflow-2");

      const runs = await scriptStore.getScriptRunsByWorkflowId("workflow-1");
      expect(runs).toHaveLength(1);
      expect(runs[0].id).toBe("run-1");
    });

    it("should get latest runs by multiple workflow IDs", async () => {
      const now = Date.now();
      // Workflow 1 has two runs
      await scriptStore.startScriptRun("w1-run-1", "script-1", new Date(now - 2000).toISOString(), "workflow-1");
      await scriptStore.startScriptRun("w1-run-2", "script-1", new Date(now - 1000).toISOString(), "workflow-1");
      // Workflow 2 has one run
      await scriptStore.startScriptRun("w2-run-1", "script-2", new Date(now).toISOString(), "workflow-2");

      const latestRuns = await scriptStore.getLatestRunsByWorkflowIds(["workflow-1", "workflow-2", "workflow-3"]);

      expect(latestRuns.size).toBe(2);
      expect(latestRuns.get("workflow-1")?.id).toBe("w1-run-2"); // Latest for workflow-1
      expect(latestRuns.get("workflow-2")?.id).toBe("w2-run-1");
      expect(latestRuns.get("workflow-3")).toBeUndefined(); // No runs for workflow-3
    });

    it("should handle empty workflow IDs array", async () => {
      const latestRuns = await scriptStore.getLatestRunsByWorkflowIds([]);
      expect(latestRuns.size).toBe(0);
    });
  });

  describe("Workflow operations", () => {
    const createWorkflow = (overrides: Partial<Workflow> = {}): Workflow => ({
      id: "workflow-1",
      title: "Test Workflow",
      task_id: "task-1",
      chat_id: "chat-1",
      timestamp: new Date().toISOString(),
      cron: "0 9 * * *",
      events: "",
      status: "draft",
      next_run_timestamp: "",
      maintenance: false,
      maintenance_fix_count: 0,
      active_script_id: "",
      ...overrides,
    });

    it("should add and retrieve a workflow", async () => {
      const workflow = createWorkflow();
      await scriptStore.addWorkflow(workflow);

      const retrieved = await scriptStore.getWorkflow("workflow-1");
      expect(retrieved).toEqual(workflow);
    });

    it("should return null for non-existent workflow", async () => {
      const result = await scriptStore.getWorkflow("non-existent");
      expect(result).toBeNull();
    });

    it("should update a workflow", async () => {
      const workflow = createWorkflow();
      await scriptStore.addWorkflow(workflow);

      workflow.title = "Updated Title";
      workflow.status = "active";
      await scriptStore.updateWorkflow(workflow);

      const updated = await scriptStore.getWorkflow("workflow-1");
      expect(updated?.title).toBe("Updated Title");
      expect(updated?.status).toBe("active");
    });

    it("should update specific workflow fields", async () => {
      const workflow = createWorkflow({ status: "draft" });
      await scriptStore.addWorkflow(workflow);

      await scriptStore.updateWorkflowFields("workflow-1", {
        status: "active",
        next_run_timestamp: "2026-01-23T09:00:00Z",
      });

      const updated = await scriptStore.getWorkflow("workflow-1");
      expect(updated?.status).toBe("active");
      expect(updated?.next_run_timestamp).toBe("2026-01-23T09:00:00Z");
      // Title should remain unchanged
      expect(updated?.title).toBe("Test Workflow");
    });

    it("should get workflow by task_id", async () => {
      await scriptStore.addWorkflow(createWorkflow({ id: "w1", task_id: "task-1" }));
      await scriptStore.addWorkflow(createWorkflow({ id: "w2", task_id: "task-2" }));

      const workflow = await scriptStore.getWorkflowByTaskId("task-1");
      expect(workflow?.id).toBe("w1");
    });

    it("should get workflow by chat_id", async () => {
      await scriptStore.addWorkflow(createWorkflow({ id: "w1", chat_id: "chat-1" }));
      await scriptStore.addWorkflow(createWorkflow({ id: "w2", chat_id: "chat-2" }));

      const workflow = await scriptStore.getWorkflowByChatId("chat-1");
      expect(workflow?.id).toBe("w1");
    });

    it("should list workflows with pagination", async () => {
      const now = Date.now();
      for (let i = 0; i < 5; i++) {
        await scriptStore.addWorkflow(createWorkflow({
          id: `workflow-${i}`,
          task_id: `task-${i}`,
          chat_id: `chat-${i}`,
          timestamp: new Date(now + i * 1000).toISOString(),
        }));
      }

      const all = await scriptStore.listWorkflows();
      expect(all).toHaveLength(5);
      // Should be ordered by timestamp DESC
      expect(all[0].id).toBe("workflow-4");

      const limited = await scriptStore.listWorkflows(2, 0);
      expect(limited).toHaveLength(2);
    });

    it("should set workflow maintenance mode", async () => {
      await scriptStore.addWorkflow(createWorkflow());

      await scriptStore.setWorkflowMaintenance("workflow-1", true);
      let workflow = await scriptStore.getWorkflow("workflow-1");
      expect(workflow?.maintenance).toBe(true);

      await scriptStore.setWorkflowMaintenance("workflow-1", false);
      workflow = await scriptStore.getWorkflow("workflow-1");
      expect(workflow?.maintenance).toBe(false);
    });

    it("should increment and reset maintenance fix count", async () => {
      await scriptStore.addWorkflow(createWorkflow());

      const count1 = await scriptStore.incrementMaintenanceFixCount("workflow-1");
      expect(count1).toBe(1);

      const count2 = await scriptStore.incrementMaintenanceFixCount("workflow-1");
      expect(count2).toBe(2);

      await scriptStore.resetMaintenanceFixCount("workflow-1");
      const workflow = await scriptStore.getWorkflow("workflow-1");
      expect(workflow?.maintenance_fix_count).toBe(0);
    });

    it("should pause all active workflows", async () => {
      await scriptStore.addWorkflow(createWorkflow({ id: "w1", status: "active" }));
      await scriptStore.addWorkflow(createWorkflow({ id: "w2", status: "active", task_id: "t2", chat_id: "c2" }));
      await scriptStore.addWorkflow(createWorkflow({ id: "w3", status: "draft", task_id: "t3", chat_id: "c3" }));

      const count = await scriptStore.pauseAllWorkflows();
      expect(count).toBe(2);

      const w1 = await scriptStore.getWorkflow("w1");
      const w2 = await scriptStore.getWorkflow("w2");
      const w3 = await scriptStore.getWorkflow("w3");

      expect(w1?.status).toBe("paused");
      expect(w2?.status).toBe("paused");
      expect(w3?.status).toBe("draft"); // Unchanged
    });

    // Boolean-to-integer conversion tests per spec: test-boolean-integer-conversion.md

    describe("Boolean-to-integer conversion (maintenance field)", () => {
      it("should correctly round-trip boolean true through database", async () => {
        // Create workflow with maintenance=true
        await scriptStore.addWorkflow(createWorkflow({ maintenance: true }));

        // Read back and verify
        const retrieved = await scriptStore.getWorkflow("workflow-1");
        expect(retrieved?.maintenance).toBe(true);
        expect(typeof retrieved?.maintenance).toBe("boolean");

        // Update with false and verify
        await scriptStore.setWorkflowMaintenance("workflow-1", false);
        const updated = await scriptStore.getWorkflow("workflow-1");
        expect(updated?.maintenance).toBe(false);
        expect(typeof updated?.maintenance).toBe("boolean");
      });

      it("should correctly round-trip boolean false through database", async () => {
        // Create workflow with maintenance=false (default)
        await scriptStore.addWorkflow(createWorkflow({ maintenance: false }));

        // Read back and verify
        const retrieved = await scriptStore.getWorkflow("workflow-1");
        expect(retrieved?.maintenance).toBe(false);
        expect(typeof retrieved?.maintenance).toBe("boolean");
      });

      it("should interpret integer 1 as true from database", async () => {
        // Insert directly with integer 1
        await db.exec(
          `INSERT INTO workflows (id, title, task_id, timestamp, maintenance) VALUES (?, ?, ?, ?, ?)`,
          ["workflow-direct-1", "Direct 1", "task-1", new Date().toISOString(), 1]
        );

        const workflow = await scriptStore.getWorkflow("workflow-direct-1");
        expect(workflow?.maintenance).toBe(true);
      });

      it("should interpret integer 0 as false from database", async () => {
        // Insert directly with integer 0
        await db.exec(
          `INSERT INTO workflows (id, title, task_id, timestamp, maintenance) VALUES (?, ?, ?, ?, ?)`,
          ["workflow-direct-0", "Direct 0", "task-1", new Date().toISOString(), 0]
        );

        const workflow = await scriptStore.getWorkflow("workflow-direct-0");
        expect(workflow?.maintenance).toBe(false);
      });

      it("should interpret non-standard integer 2 as truthy", async () => {
        // Insert directly with integer 2 (non-standard boolean value)
        // SQLite will allow this, and JavaScript Boolean(2) is true
        await db.exec(
          `INSERT INTO workflows (id, title, task_id, timestamp, maintenance) VALUES (?, ?, ?, ?, ?)`,
          ["workflow-direct-2", "Direct 2", "task-1", new Date().toISOString(), 2]
        );

        const workflow = await scriptStore.getWorkflow("workflow-direct-2");
        // Boolean(2) === true
        expect(workflow?.maintenance).toBe(true);
      });

      it("should interpret negative integer -1 as truthy", async () => {
        // Insert directly with integer -1 (non-standard boolean value)
        // SQLite will allow this, and JavaScript Boolean(-1) is true
        await db.exec(
          `INSERT INTO workflows (id, title, task_id, timestamp, maintenance) VALUES (?, ?, ?, ?, ?)`,
          ["workflow-direct-neg1", "Direct -1", "task-1", new Date().toISOString(), -1]
        );

        const workflow = await scriptStore.getWorkflow("workflow-direct-neg1");
        // Boolean(-1) === true
        expect(workflow?.maintenance).toBe(true);
      });

      it("should handle default value when maintenance not specified in insert", async () => {
        // Insert without specifying maintenance (should use DEFAULT 0)
        await db.exec(
          `INSERT INTO workflows (id, title, task_id, timestamp) VALUES (?, ?, ?, ?)`,
          ["workflow-default", "Default", "task-1", new Date().toISOString()]
        );

        const workflow = await scriptStore.getWorkflow("workflow-default");
        expect(workflow?.maintenance).toBe(false);
      });

      it("should persist maintenance=true through updateWorkflow", async () => {
        // Create workflow
        const workflow = createWorkflow({ maintenance: false });
        await scriptStore.addWorkflow(workflow);

        // Update with true via updateWorkflow
        workflow.maintenance = true;
        await scriptStore.updateWorkflow(workflow);

        // Verify persisted correctly
        const retrieved = await scriptStore.getWorkflow("workflow-1");
        expect(retrieved?.maintenance).toBe(true);
      });

      it("should persist maintenance=false through updateWorkflowFields", async () => {
        // Create workflow with maintenance=true
        await scriptStore.addWorkflow(createWorkflow({ maintenance: true }));

        // Update to false via updateWorkflowFields
        await scriptStore.updateWorkflowFields("workflow-1", { maintenance: false });

        // Verify persisted correctly
        const retrieved = await scriptStore.getWorkflow("workflow-1");
        expect(retrieved?.maintenance).toBe(false);
      });
    });
  });

  describe("Draft activity queries", () => {
    it("should get abandoned drafts", async () => {
      // Create a task and workflow
      await db.exec(
        `INSERT INTO tasks (id, timestamp, state, chat_id) VALUES (?, ?, ?, ?)`,
        ["task-1", Date.now(), "wait", "chat-1"]
      );

      // Create a draft workflow with old timestamp (8 days ago)
      const oldDate = new Date();
      oldDate.setDate(oldDate.getDate() - 8);
      await scriptStore.addWorkflow({
        id: "workflow-1",
        title: "Old Draft",
        task_id: "task-1",
        chat_id: "chat-1",
        timestamp: oldDate.toISOString(),
        cron: "",
        events: "",
        status: "draft",
        next_run_timestamp: "",
        maintenance: false,
        maintenance_fix_count: 0,
        active_script_id: "",
      });

      // Create a recent draft workflow
      await db.exec(
        `INSERT INTO tasks (id, timestamp, state, chat_id) VALUES (?, ?, ?, ?)`,
        ["task-2", Date.now(), "done", "chat-2"]
      );
      await scriptStore.addWorkflow({
        id: "workflow-2",
        title: "Recent Draft",
        task_id: "task-2",
        chat_id: "chat-2",
        timestamp: new Date().toISOString(),
        cron: "",
        events: "",
        status: "draft",
        next_run_timestamp: "",
        maintenance: false,
        maintenance_fix_count: 0,
        active_script_id: "",
      });

      const abandoned = await scriptStore.getAbandonedDrafts(7);
      expect(abandoned).toHaveLength(1);
      expect(abandoned[0].workflow.id).toBe("workflow-1");
      expect(abandoned[0].daysSinceActivity).toBeGreaterThanOrEqual(7);
      expect(abandoned[0].isWaitingForInput).toBe(true);
    });

    it("should get draft activity summary", async () => {
      const now = new Date();

      // Create tasks
      await db.exec(
        `INSERT INTO tasks (id, timestamp, state, chat_id) VALUES (?, ?, ?, ?)`,
        ["task-1", Date.now(), "wait", "chat-1"]
      );
      await db.exec(
        `INSERT INTO tasks (id, timestamp, state, chat_id) VALUES (?, ?, ?, ?)`,
        ["task-2", Date.now(), "done", "chat-2"]
      );
      await db.exec(
        `INSERT INTO tasks (id, timestamp, state, chat_id) VALUES (?, ?, ?, ?)`,
        ["task-3", Date.now(), "done", "chat-3"]
      );

      // Stale draft (5 days old)
      const staleDateStr = new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000).toISOString();
      await scriptStore.addWorkflow({
        id: "stale-workflow",
        title: "Stale",
        task_id: "task-1",
        chat_id: "chat-1",
        timestamp: staleDateStr,
        cron: "",
        events: "",
        status: "draft",
        next_run_timestamp: "",
        maintenance: false,
        maintenance_fix_count: 0,
        active_script_id: "",
      });

      // Abandoned draft (10 days old)
      const abandonedDateStr = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000).toISOString();
      await scriptStore.addWorkflow({
        id: "abandoned-workflow",
        title: "Abandoned",
        task_id: "task-2",
        chat_id: "chat-2",
        timestamp: abandonedDateStr,
        cron: "",
        events: "",
        status: "draft",
        next_run_timestamp: "",
        maintenance: false,
        maintenance_fix_count: 0,
        active_script_id: "",
      });

      // Recent draft (1 day old)
      const recentDateStr = new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000).toISOString();
      await scriptStore.addWorkflow({
        id: "recent-workflow",
        title: "Recent",
        task_id: "task-3",
        chat_id: "chat-3",
        timestamp: recentDateStr,
        cron: "",
        events: "",
        status: "draft",
        next_run_timestamp: "",
        maintenance: false,
        maintenance_fix_count: 0,
        active_script_id: "",
      });

      const summary = await scriptStore.getDraftActivitySummary();
      expect(summary.totalDrafts).toBe(3);
      expect(summary.staleDrafts).toBe(1);      // 5 days is stale (3-7)
      expect(summary.abandonedDrafts).toBe(1);   // 10 days is abandoned (7+)
      expect(summary.waitingForInput).toBe(1);   // task-1 is in 'wait' state
    });

    // Boundary condition tests per spec: test-abandoned-drafts-boundaries.md

    it("should handle exact 7-day threshold boundary (just over - included)", async () => {
      const now = new Date();

      // Create task
      await db.exec(
        `INSERT INTO tasks (id, timestamp, state, chat_id) VALUES (?, ?, ?, ?)`,
        ["task-boundary", Date.now(), "done", "chat-boundary"]
      );

      // Workflow exactly 7 days + 1 second ago (should be included as abandoned)
      const justOverThreshold = new Date(now.getTime() - (7 * 24 * 60 * 60 * 1000 + 1000));
      await scriptStore.addWorkflow({
        id: "workflow-boundary-over",
        title: "Just Over Threshold",
        task_id: "task-boundary",
        chat_id: "chat-boundary",
        timestamp: justOverThreshold.toISOString(),
        cron: "",
        events: "",
        status: "draft",
        next_run_timestamp: "",
        maintenance: false,
        maintenance_fix_count: 0,
        active_script_id: "",
      });

      const abandoned = await scriptStore.getAbandonedDrafts(7);
      expect(abandoned).toHaveLength(1);
      expect(abandoned[0].workflow.id).toBe("workflow-boundary-over");
    });

    it("should handle exact 7-day threshold boundary (just under - excluded)", async () => {
      const now = new Date();

      // Create task
      await db.exec(
        `INSERT INTO tasks (id, timestamp, state, chat_id) VALUES (?, ?, ?, ?)`,
        ["task-boundary", Date.now(), "done", "chat-boundary"]
      );

      // Workflow exactly 7 days - 1 hour ago (should NOT be included as abandoned)
      const justUnderThreshold = new Date(now.getTime() - (7 * 24 * 60 * 60 * 1000 - 60 * 60 * 1000));
      await scriptStore.addWorkflow({
        id: "workflow-boundary-under",
        title: "Just Under Threshold",
        task_id: "task-boundary",
        chat_id: "chat-boundary",
        timestamp: justUnderThreshold.toISOString(),
        cron: "",
        events: "",
        status: "draft",
        next_run_timestamp: "",
        maintenance: false,
        maintenance_fix_count: 0,
        active_script_id: "",
      });

      const abandoned = await scriptStore.getAbandonedDrafts(7);
      expect(abandoned).toHaveLength(0);
    });

    it("should fallback to script timestamps when no chat_messages exist", async () => {
      const now = new Date();

      // Create task
      await db.exec(
        `INSERT INTO tasks (id, timestamp, state, chat_id) VALUES (?, ?, ?, ?)`,
        ["task-no-chat", Date.now(), "done", "chat-no-chat"]
      );

      // Old workflow timestamp (10 days ago)
      const oldWorkflowDate = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000);
      await scriptStore.addWorkflow({
        id: "workflow-no-chat",
        title: "No Chat Messages",
        task_id: "task-no-chat",
        chat_id: "chat-no-chat",
        timestamp: oldWorkflowDate.toISOString(),
        cron: "",
        events: "",
        status: "draft",
        next_run_timestamp: "",
        maintenance: false,
        maintenance_fix_count: 0,
        active_script_id: "",
      });

      // Add a recent script (2 days ago) - should update last_activity via COALESCE
      const recentScriptDate = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);
      await scriptStore.addScript({
        id: "script-recent",
        task_id: "task-no-chat",
        version: 1,
        timestamp: recentScriptDate.toISOString(),
        code: "console.log('test');",
        change_comment: "Initial",
        workflow_id: "workflow-no-chat",
        type: "cron",
        summary: "",
        diagram: "",
      });

      // Should NOT be abandoned because script is recent (2 days < 7 days threshold)
      const abandoned = await scriptStore.getAbandonedDrafts(7);
      expect(abandoned).toHaveLength(0);

      // Verify hasScript flag works
      const summary = await scriptStore.getDraftActivitySummary();
      expect(summary.totalDrafts).toBe(1);
      expect(summary.abandonedDrafts).toBe(0);
    });

    it("should detect task in 'asks' state as waiting for input", async () => {
      const now = new Date();

      // Create task with 'asks' state (not 'wait')
      await db.exec(
        `INSERT INTO tasks (id, timestamp, state, chat_id) VALUES (?, ?, ?, ?)`,
        ["task-asks", Date.now(), "asks", "chat-asks"]
      );

      // Old draft (8 days)
      const oldDate = new Date(now.getTime() - 8 * 24 * 60 * 60 * 1000);
      await scriptStore.addWorkflow({
        id: "workflow-asks",
        title: "Asks State Draft",
        task_id: "task-asks",
        chat_id: "chat-asks",
        timestamp: oldDate.toISOString(),
        cron: "",
        events: "",
        status: "draft",
        next_run_timestamp: "",
        maintenance: false,
        maintenance_fix_count: 0,
        active_script_id: "",
      });

      const abandoned = await scriptStore.getAbandonedDrafts(7);
      expect(abandoned).toHaveLength(1);
      expect(abandoned[0].isWaitingForInput).toBe(true);

      const summary = await scriptStore.getDraftActivitySummary();
      expect(summary.waitingForInput).toBe(1);
    });

    it("should use most recent timestamp via COALESCE when multiple exist", async () => {
      const now = new Date();

      // Create task
      await db.exec(
        `INSERT INTO tasks (id, timestamp, state, chat_id) VALUES (?, ?, ?, ?)`,
        ["task-coalesce", Date.now(), "done", "chat-coalesce"]
      );

      // Old workflow timestamp (20 days ago)
      const oldWorkflowDate = new Date(now.getTime() - 20 * 24 * 60 * 60 * 1000);
      await scriptStore.addWorkflow({
        id: "workflow-coalesce",
        title: "COALESCE Test",
        task_id: "task-coalesce",
        chat_id: "chat-coalesce",
        timestamp: oldWorkflowDate.toISOString(),
        cron: "",
        events: "",
        status: "draft",
        next_run_timestamp: "",
        maintenance: false,
        maintenance_fix_count: 0,
        active_script_id: "",
      });

      // Medium-old script (10 days ago)
      const mediumOldDate = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000);
      await scriptStore.addScript({
        id: "script-medium",
        task_id: "task-coalesce",
        version: 1,
        timestamp: mediumOldDate.toISOString(),
        code: "console.log('medium');",
        change_comment: "",
        workflow_id: "workflow-coalesce",
        type: "",
        summary: "",
        diagram: "",
      });

      // Recent chat message (1 day ago) - this should be the most recent
      const recentChatDate = new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000);
      await db.exec(
        `INSERT INTO chat_messages (id, chat_id, role, content, timestamp) VALUES (?, ?, ?, ?, ?)`,
        ["msg-recent", "chat-coalesce", "user", "Hello", recentChatDate.toISOString()]
      );

      // Should NOT be abandoned because chat message is recent (1 day < 7 days)
      const abandoned = await scriptStore.getAbandonedDrafts(7);
      expect(abandoned).toHaveLength(0);

      // Verify in summary too
      const summary = await scriptStore.getDraftActivitySummary();
      expect(summary.totalDrafts).toBe(1);
      expect(summary.abandonedDrafts).toBe(0);
      expect(summary.staleDrafts).toBe(0);
    });

    it("should use MAX across all activity sources (fix for COALESCE bug)", async () => {
      // This test verifies the fix for the COALESCE bug where chat_messages
      // timestamp was checked BEFORE scripts timestamp. The fix uses:
      //   MAX(COALESCE(MAX(cm.timestamp), w.timestamp), COALESCE(MAX(s.timestamp), w.timestamp), w.timestamp)
      // Now the most recent activity across ALL sources is used.
      const now = new Date();

      // Create task
      await db.exec(
        `INSERT INTO tasks (id, timestamp, state, chat_id) VALUES (?, ?, ?, ?)`,
        ["task-coalesce-order", Date.now(), "done", "chat-coalesce-order"]
      );

      // Old workflow timestamp (20 days ago)
      const oldWorkflowDate = new Date(now.getTime() - 20 * 24 * 60 * 60 * 1000);
      await scriptStore.addWorkflow({
        id: "workflow-coalesce-order",
        title: "COALESCE Order Test",
        task_id: "task-coalesce-order",
        chat_id: "chat-coalesce-order",
        timestamp: oldWorkflowDate.toISOString(),
        cron: "",
        events: "",
        status: "draft",
        next_run_timestamp: "",
        maintenance: false,
        maintenance_fix_count: 0,
        active_script_id: "",
      });

      // Old chat message (15 days ago)
      const oldChatDate = new Date(now.getTime() - 15 * 24 * 60 * 60 * 1000);
      await db.exec(
        `INSERT INTO chat_messages (id, chat_id, role, content, timestamp) VALUES (?, ?, ?, ?, ?)`,
        ["msg-old-order", "chat-coalesce-order", "user", "Old message", oldChatDate.toISOString()]
      );

      // More recent script (2 days ago)
      const recentScriptDate = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);
      await scriptStore.addScript({
        id: "script-newer-order",
        task_id: "task-coalesce-order",
        version: 1,
        timestamp: recentScriptDate.toISOString(),
        code: "console.log('newer');",
        change_comment: "",
        workflow_id: "workflow-coalesce-order",
        type: "",
        summary: "",
        diagram: "",
      });

      // With the fix, the most recent activity (script at 2 days ago) is used
      // Since 2 days < 7 day threshold, the workflow should NOT be abandoned
      const abandoned = await scriptStore.getAbandonedDrafts(7);
      expect(abandoned).toHaveLength(0); // Not abandoned - has recent script activity
    });

    it("should fallback to workflow timestamp when no scripts or messages exist", async () => {
      const now = new Date();

      // Create task
      await db.exec(
        `INSERT INTO tasks (id, timestamp, state, chat_id) VALUES (?, ?, ?, ?)`,
        ["task-fallback", Date.now(), "done", "chat-fallback"]
      );

      // Old workflow timestamp (8 days ago) - no scripts, no chat messages
      const oldWorkflowDate = new Date(now.getTime() - 8 * 24 * 60 * 60 * 1000);
      await scriptStore.addWorkflow({
        id: "workflow-fallback",
        title: "Fallback Test",
        task_id: "task-fallback",
        chat_id: "chat-fallback",
        timestamp: oldWorkflowDate.toISOString(),
        cron: "",
        events: "",
        status: "draft",
        next_run_timestamp: "",
        maintenance: false,
        maintenance_fix_count: 0,
        active_script_id: "",
      });

      // Should be abandoned based on workflow timestamp
      const abandoned = await scriptStore.getAbandonedDrafts(7);
      expect(abandoned).toHaveLength(1);
      expect(abandoned[0].workflow.id).toBe("workflow-fallback");
      expect(abandoned[0].hasScript).toBe(false);
    });
  });
});
