import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { DBInterface, KeepDb, ScriptStore, Script } from "@app/db";
import { createDBNode } from "@app/node";
import {
  makeGetScriptTool,
  makeListScriptsTool,
  makeScriptHistoryTool,
  makeListScriptRunsTool,
  makeGetScriptRunTool,
  type EvalContext,
} from "@app/agent";

/**
 * Helper to create scripts + script_runs tables without full migration system.
 */
async function createScriptToolTables(db: DBInterface): Promise<void> {
  // scripts table (matches production v11 + v16 + v34 migrations)
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
  await db.exec(
    `CREATE INDEX IF NOT EXISTS idx_scripts_major_minor_version ON scripts(major_version DESC, minor_version DESC)`
  );

  // script_runs table (v11 + v12 + v14 + v16 + v20 + v22 + v24 + v36)
  await db.exec(`
    CREATE TABLE IF NOT EXISTS script_runs (
      id TEXT PRIMARY KEY NOT NULL,
      script_id TEXT NOT NULL DEFAULT '',
      start_timestamp TEXT NOT NULL DEFAULT '',
      end_timestamp TEXT NOT NULL DEFAULT '',
      error TEXT NOT NULL DEFAULT '',
      result TEXT NOT NULL DEFAULT '',
      logs TEXT NOT NULL DEFAULT '',
      workflow_id TEXT NOT NULL DEFAULT '',
      type TEXT NOT NULL DEFAULT '',
      retry_of TEXT NOT NULL DEFAULT '',
      retry_count INTEGER NOT NULL DEFAULT 0,
      error_type TEXT NOT NULL DEFAULT '',
      cost INTEGER NOT NULL DEFAULT 0,
      trigger TEXT NOT NULL DEFAULT '',
      handler_run_count INTEGER NOT NULL DEFAULT 0
    )
  `);
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_script_runs_script_id ON script_runs(script_id)`);
  await db.exec(
    `CREATE INDEX IF NOT EXISTS idx_script_runs_start_timestamp ON script_runs(start_timestamp)`
  );

  // workflows table
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
}

function createMockContext(overrides: Partial<EvalContext> = {}): EvalContext {
  return {
    taskThreadId: "test-thread",
    step: 0,
    type: "planner",
    taskId: "task-1",
    cost: 0,
    createEvent: vi.fn().mockResolvedValue(undefined),
    onLog: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

const createScript = (overrides: Partial<Script> = {}): Script => ({
  id: "script-1",
  task_id: "task-1",
  major_version: 1,
  minor_version: 0,
  timestamp: "2025-01-01T00:00:00.000Z",
  code: "console.log('hello');",
  change_comment: "Initial version",
  workflow_id: "workflow-1",
  type: "",
  summary: "",
  diagram: "",
  ...overrides,
});

describe("Script Tools", () => {
  let db: DBInterface;
  let keepDb: KeepDb;
  let scriptStore: ScriptStore;

  beforeEach(async () => {
    db = await createDBNode(":memory:");
    keepDb = new KeepDb(db);
    await createScriptToolTables(db);
    scriptStore = new ScriptStore(keepDb);
  });

  afterEach(async () => {
    if (db) await db.close();
    vi.clearAllMocks();
  });

  describe("makeGetScriptTool", () => {
    it("should get script by ID", async () => {
      const script = createScript();
      await scriptStore.addScript(script);

      const tool = makeGetScriptTool(scriptStore, () => createMockContext());
      const result = await tool.execute!({ id: "script-1" });

      expect(result).not.toBeNull();
      expect(result!.id).toBe("script-1");
      expect(result!.task_id).toBe("task-1");
      expect(result!.version).toBe("1.0");
      expect(result!.code).toBe("console.log('hello');");
      expect(result!.change_comment).toBe("Initial version");
    });

    it("should return null for non-existent script ID", async () => {
      const tool = makeGetScriptTool(scriptStore, () => createMockContext());
      const result = await tool.execute!({ id: "non-existent" });

      expect(result).toBeNull();
    });

    it("should get latest script for current task when no ID provided", async () => {
      await scriptStore.addScript(
        createScript({ id: "script-v1", major_version: 1, minor_version: 0, code: "v1" })
      );
      await scriptStore.addScript(
        createScript({ id: "script-v2", major_version: 2, minor_version: 0, code: "v2" })
      );

      const tool = makeGetScriptTool(scriptStore, () => createMockContext({ taskId: "task-1" }));
      const result = await tool.execute!(null);

      expect(result).not.toBeNull();
      expect(result!.id).toBe("script-v2");
      expect(result!.version).toBe("2.0");
      expect(result!.code).toBe("v2");
    });

    it("should get latest script when input is empty object", async () => {
      await scriptStore.addScript(createScript());

      const tool = makeGetScriptTool(scriptStore, () => createMockContext({ taskId: "task-1" }));
      const result = await tool.execute!({});

      expect(result).not.toBeNull();
      expect(result!.id).toBe("script-1");
    });

    it("should return null when no scripts exist for task", async () => {
      const tool = makeGetScriptTool(
        scriptStore,
        () => createMockContext({ taskId: "task-no-scripts" })
      );
      const result = await tool.execute!(null);

      expect(result).toBeNull();
    });

    it("should format version as major.minor", async () => {
      await scriptStore.addScript(
        createScript({ id: "script-2-3", major_version: 2, minor_version: 3 })
      );

      const tool = makeGetScriptTool(scriptStore, () => createMockContext());
      const result = await tool.execute!({ id: "script-2-3" });

      expect(result!.version).toBe("2.3");
    });

    it("should throw error for non-planner/worker context", async () => {
      const tool = makeGetScriptTool(
        scriptStore,
        () => createMockContext({ type: "workflow" })
      );

      await expect(tool.execute!(null)).rejects.toThrow("Only planner/worker tasks have scripts");
    });
  });

  describe("makeListScriptsTool", () => {
    it("should list latest scripts for each task", async () => {
      // Task 1: two versions, should show latest
      await scriptStore.addScript(
        createScript({
          id: "s1-v1",
          task_id: "task-1",
          major_version: 1,
          minor_version: 0,
          change_comment: "v1",
        })
      );
      await scriptStore.addScript(
        createScript({
          id: "s1-v2",
          task_id: "task-1",
          major_version: 2,
          minor_version: 0,
          change_comment: "v2",
        })
      );
      // Task 2: single version
      await scriptStore.addScript(
        createScript({
          id: "s2-v1",
          task_id: "task-2",
          major_version: 1,
          minor_version: 0,
          change_comment: "task2 v1",
        })
      );

      const tool = makeListScriptsTool(scriptStore);
      const result = await tool.execute!(null);

      expect(result).toHaveLength(2);

      // Should include only latest for task-1
      const task1Script = result.find((s: any) => s.task_id === "task-1");
      expect(task1Script).toBeDefined();
      expect(task1Script!.version).toBe("2.0");
      expect(task1Script!.change_comment).toBe("v2");

      // Should include task-2's only version
      const task2Script = result.find((s: any) => s.task_id === "task-2");
      expect(task2Script).toBeDefined();
      expect(task2Script!.version).toBe("1.0");
    });

    it("should return empty array when no scripts exist", async () => {
      const tool = makeListScriptsTool(scriptStore);
      const result = await tool.execute!(null);

      expect(result).toHaveLength(0);
    });

    it("should not include code field in results", async () => {
      await scriptStore.addScript(createScript());

      const tool = makeListScriptsTool(scriptStore);
      const result = await tool.execute!(null);

      expect(result).toHaveLength(1);
      expect(result[0]).toHaveProperty("id");
      expect(result[0]).toHaveProperty("task_id");
      expect(result[0]).toHaveProperty("version");
      expect(result[0]).toHaveProperty("timestamp");
      expect(result[0]).toHaveProperty("change_comment");
      expect(result[0]).not.toHaveProperty("code");
    });

    it("should handle empty object input", async () => {
      await scriptStore.addScript(createScript());

      const tool = makeListScriptsTool(scriptStore);
      const result = await tool.execute!({});

      expect(result).toHaveLength(1);
    });
  });

  describe("makeScriptHistoryTool", () => {
    it("should return all versions for a task ordered by version", async () => {
      await scriptStore.addScript(
        createScript({
          id: "s-v1",
          major_version: 1,
          minor_version: 0,
          change_comment: "v1.0",
        })
      );
      await scriptStore.addScript(
        createScript({
          id: "s-v1.1",
          major_version: 1,
          minor_version: 1,
          change_comment: "v1.1 fix",
        })
      );
      await scriptStore.addScript(
        createScript({
          id: "s-v2",
          major_version: 2,
          minor_version: 0,
          change_comment: "v2.0",
        })
      );

      const tool = makeScriptHistoryTool(scriptStore);
      const result = await tool.execute!({ task_id: "task-1" });

      expect(result).toHaveLength(3);
      expect(result[0].version).toBe("1.0");
      expect(result[1].version).toBe("1.1");
      expect(result[2].version).toBe("2.0");
    });

    it("should return empty array for non-existent task", async () => {
      const tool = makeScriptHistoryTool(scriptStore);
      const result = await tool.execute!({ task_id: "non-existent" });

      expect(result).toHaveLength(0);
    });

    it("should not include code field", async () => {
      await scriptStore.addScript(createScript());

      const tool = makeScriptHistoryTool(scriptStore);
      const result = await tool.execute!({ task_id: "task-1" });

      expect(result).toHaveLength(1);
      expect(result[0]).not.toHaveProperty("code");
    });

    it("should only return scripts for the specified task", async () => {
      await scriptStore.addScript(createScript({ id: "s1", task_id: "task-1" }));
      await scriptStore.addScript(createScript({ id: "s2", task_id: "task-2" }));

      const tool = makeScriptHistoryTool(scriptStore);
      const result = await tool.execute!({ task_id: "task-1" });

      expect(result).toHaveLength(1);
      expect(result[0].task_id).toBe("task-1");
    });
  });

  describe("makeListScriptRunsTool", () => {
    beforeEach(async () => {
      // Add a script first (runs reference scripts via script_id)
      await scriptStore.addScript(createScript());
    });

    it("should list script runs for a given task", async () => {
      const now = new Date().toISOString();
      await scriptStore.startScriptRun("run-1", "script-1", now, "workflow-1", "production");
      await scriptStore.finishScriptRun("run-1", now, "Completed", "", "test logs");

      const tool = makeListScriptRunsTool(scriptStore, () => createMockContext());
      const result = await tool.execute!({ task_id: "task-1" });

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("run-1");
      expect(result[0].script_id).toBe("script-1");
    });

    it("should use current task from context when no task_id provided", async () => {
      const now = new Date().toISOString();
      await scriptStore.startScriptRun("run-1", "script-1", now, "workflow-1", "production");
      await scriptStore.finishScriptRun("run-1", now, "Done", "", "logs");

      const tool = makeListScriptRunsTool(
        scriptStore,
        () => createMockContext({ taskId: "task-1" })
      );
      const result = await tool.execute!(null);

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("run-1");
    });

    it("should not include result and logs fields", async () => {
      const now = new Date().toISOString();
      await scriptStore.startScriptRun("run-1", "script-1", now, "workflow-1", "production");
      await scriptStore.finishScriptRun("run-1", now, "Some result", "", "Some logs");

      const tool = makeListScriptRunsTool(scriptStore, () => createMockContext());
      const result = await tool.execute!({ task_id: "task-1" });

      expect(result).toHaveLength(1);
      expect(result[0]).toHaveProperty("id");
      expect(result[0]).toHaveProperty("script_id");
      expect(result[0]).toHaveProperty("start_timestamp");
      expect(result[0]).toHaveProperty("end_timestamp");
      expect(result[0]).toHaveProperty("error");
      expect(result[0]).not.toHaveProperty("result");
      expect(result[0]).not.toHaveProperty("logs");
    });

    it("should return empty array when no runs exist", async () => {
      const tool = makeListScriptRunsTool(scriptStore, () => createMockContext());
      const result = await tool.execute!({ task_id: "task-1" });

      expect(result).toHaveLength(0);
    });

    it("should include error info for failed runs", async () => {
      const now = new Date().toISOString();
      await scriptStore.startScriptRun("run-fail", "script-1", now, "workflow-1", "production");
      await scriptStore.finishScriptRun("run-fail", now, "", "Something broke", "error logs");

      const tool = makeListScriptRunsTool(scriptStore, () => createMockContext());
      const result = await tool.execute!({ task_id: "task-1" });

      expect(result).toHaveLength(1);
      expect(result[0].error).toBe("Something broke");
    });

    it("should throw error for non-planner/worker context when no task_id", async () => {
      const tool = makeListScriptRunsTool(
        scriptStore,
        () => createMockContext({ type: "workflow" })
      );

      await expect(tool.execute!(null)).rejects.toThrow(
        "Only planner/worker tasks have scripts"
      );
    });
  });

  describe("makeGetScriptRunTool", () => {
    beforeEach(async () => {
      await scriptStore.addScript(createScript());
    });

    it("should get full script run with result and logs", async () => {
      const now = new Date().toISOString();
      await scriptStore.startScriptRun("run-1", "script-1", now, "workflow-1", "production");
      await scriptStore.finishScriptRun("run-1", now, "The result data", "", "Detailed logs here");

      const tool = makeGetScriptRunTool(scriptStore);
      const result = await tool.execute!({ id: "run-1" });

      expect(result).not.toBeNull();
      expect(result!.id).toBe("run-1");
      expect(result!.script_id).toBe("script-1");
      expect(result!.result).toBe("The result data");
      expect(result!.logs).toBe("Detailed logs here");
    });

    it("should return null for non-existent script run", async () => {
      const tool = makeGetScriptRunTool(scriptStore);
      const result = await tool.execute!({ id: "non-existent" });

      expect(result).toBeNull();
    });

    it("should include error info for failed runs", async () => {
      const now = new Date().toISOString();
      await scriptStore.startScriptRun("run-fail", "script-1", now, "workflow-1", "production");
      await scriptStore.finishScriptRun(
        "run-fail",
        now,
        "",
        "TypeError: x is not a function",
        "Error stack trace...",
        "logic"
      );

      const tool = makeGetScriptRunTool(scriptStore);
      const result = await tool.execute!({ id: "run-fail" });

      expect(result).not.toBeNull();
      expect(result!.error).toBe("TypeError: x is not a function");
      expect(result!.logs).toBe("Error stack trace...");
    });

    it("should include timestamps", async () => {
      const startTime = new Date().toISOString();
      await scriptStore.startScriptRun("run-ts", "script-1", startTime, "workflow-1", "production");
      const endTime = new Date().toISOString();
      await scriptStore.finishScriptRun("run-ts", endTime, "done", "");

      const tool = makeGetScriptRunTool(scriptStore);
      const result = await tool.execute!({ id: "run-ts" });

      expect(result).not.toBeNull();
      expect(result!.start_timestamp).toBe(startTime);
      expect(result!.end_timestamp).toBe(endTime);
    });
  });
});
