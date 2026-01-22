import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DBInterface, KeepDb, ExecutionLogStore, ExecutionLog } from "@app/db";
import { createDBNode } from "@app/node";

/**
 * Helper to create execution_logs table without full migration system.
 * This allows testing the store in isolation without CR-SQLite dependencies.
 */
async function createExecutionLogsTable(db: DBInterface): Promise<void> {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS execution_logs (
      id TEXT PRIMARY KEY NOT NULL,
      run_id TEXT NOT NULL,
      run_type TEXT NOT NULL,
      event_type TEXT NOT NULL,
      tool_name TEXT NOT NULL DEFAULT '',
      input TEXT NOT NULL DEFAULT '',
      output TEXT NOT NULL DEFAULT '',
      error TEXT NOT NULL DEFAULT '',
      timestamp TEXT NOT NULL,
      cost INTEGER NOT NULL DEFAULT 0
    )
  `);
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_execution_logs_run_id ON execution_logs(run_id)`);
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_execution_logs_timestamp ON execution_logs(timestamp)`);
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_execution_logs_run_type ON execution_logs(run_type)`);
}

describe("ExecutionLogStore", () => {
  let db: DBInterface;
  let keepDb: KeepDb;
  let executionLogStore: ExecutionLogStore;

  beforeEach(async () => {
    db = await createDBNode(":memory:");
    keepDb = new KeepDb(db);
    // Create table manually instead of running full migrations
    await createExecutionLogsTable(db);
    executionLogStore = new ExecutionLogStore(keepDb);
  });

  afterEach(async () => {
    if (db) {
      await db.close();
    }
  });

  describe("saveExecutionLog and getExecutionLogs", () => {
    it("should save and retrieve an execution log", async () => {
      const log = {
        id: "log-1",
        run_id: "run-1",
        run_type: "script" as const,
        event_type: "tool_call" as const,
        tool_name: "web.fetch",
        input: JSON.stringify({ url: "https://example.com" }),
        output: JSON.stringify({ status: 200 }),
        error: "",
        timestamp: new Date().toISOString(),
        cost: 100,
      };

      await executionLogStore.saveExecutionLog(log);
      const logs = await executionLogStore.getExecutionLogs("run-1", "script");

      expect(logs).toHaveLength(1);
      expect(logs[0]).toEqual(log);
    });

    it("should retrieve logs ordered by timestamp ASC", async () => {
      const now = Date.now();
      const logs = [
        {
          id: "log-1",
          run_id: "run-1",
          run_type: "script" as const,
          event_type: "run_start" as const,
          tool_name: "",
          input: "{}",
          output: "{}",
          error: "",
          timestamp: new Date(now).toISOString(),
          cost: 0,
        },
        {
          id: "log-2",
          run_id: "run-1",
          run_type: "script" as const,
          event_type: "tool_call" as const,
          tool_name: "web.fetch",
          input: "{}",
          output: "{}",
          error: "",
          timestamp: new Date(now + 1000).toISOString(),
          cost: 50,
        },
        {
          id: "log-3",
          run_id: "run-1",
          run_type: "script" as const,
          event_type: "run_end" as const,
          tool_name: "",
          input: "{}",
          output: "{}",
          error: "",
          timestamp: new Date(now + 2000).toISOString(),
          cost: 0,
        },
      ];

      // Insert in reverse order
      for (const log of [...logs].reverse()) {
        await executionLogStore.saveExecutionLog(log);
      }

      const results = await executionLogStore.getExecutionLogs("run-1", "script");
      expect(results).toHaveLength(3);
      expect(results[0].id).toBe("log-1"); // Oldest first
      expect(results[1].id).toBe("log-2");
      expect(results[2].id).toBe("log-3");
    });

    it("should filter logs by run_id and run_type", async () => {
      const logs = [
        {
          id: "log-1",
          run_id: "run-1",
          run_type: "script" as const,
          event_type: "tool_call" as const,
          tool_name: "web.fetch",
          input: "{}",
          output: "{}",
          error: "",
          timestamp: new Date().toISOString(),
          cost: 50,
        },
        {
          id: "log-2",
          run_id: "run-2",
          run_type: "script" as const,
          event_type: "tool_call" as const,
          tool_name: "web.fetch",
          input: "{}",
          output: "{}",
          error: "",
          timestamp: new Date().toISOString(),
          cost: 50,
        },
        {
          id: "log-3",
          run_id: "run-1",
          run_type: "task" as const,
          event_type: "tool_call" as const,
          tool_name: "file.read",
          input: "{}",
          output: "{}",
          error: "",
          timestamp: new Date().toISOString(),
          cost: 30,
        },
      ];

      for (const log of logs) {
        await executionLogStore.saveExecutionLog(log);
      }

      const scriptLogs = await executionLogStore.getExecutionLogs("run-1", "script");
      expect(scriptLogs).toHaveLength(1);
      expect(scriptLogs[0].id).toBe("log-1");

      const taskLogs = await executionLogStore.getExecutionLogs("run-1", "task");
      expect(taskLogs).toHaveLength(1);
      expect(taskLogs[0].id).toBe("log-3");
    });
  });

  describe("getExecutionLog", () => {
    it("should return a single log by id", async () => {
      const log = {
        id: "log-1",
        run_id: "run-1",
        run_type: "script" as const,
        event_type: "tool_call" as const,
        tool_name: "web.fetch",
        input: JSON.stringify({ url: "https://example.com" }),
        output: JSON.stringify({ status: 200 }),
        error: "",
        timestamp: new Date().toISOString(),
        cost: 100,
      };

      await executionLogStore.saveExecutionLog(log);
      const result = await executionLogStore.getExecutionLog("log-1");

      expect(result).toEqual(log);
    });

    it("should return null for non-existent log", async () => {
      const result = await executionLogStore.getExecutionLog("non-existent");
      expect(result).toBeNull();
    });
  });

  describe("listExecutionLogs", () => {
    beforeEach(async () => {
      const logs = [
        {
          id: "log-1",
          run_id: "run-1",
          run_type: "script" as const,
          event_type: "run_start" as const,
          tool_name: "",
          input: "{}",
          output: "{}",
          error: "",
          timestamp: new Date(Date.now()).toISOString(),
          cost: 0,
        },
        {
          id: "log-2",
          run_id: "run-1",
          run_type: "script" as const,
          event_type: "tool_call" as const,
          tool_name: "web.fetch",
          input: "{}",
          output: "{}",
          error: "",
          timestamp: new Date(Date.now() + 1000).toISOString(),
          cost: 100,
        },
        {
          id: "log-3",
          run_id: "run-2",
          run_type: "task" as const,
          event_type: "tool_call" as const,
          tool_name: "file.read",
          input: "{}",
          output: "{}",
          error: "",
          timestamp: new Date(Date.now() + 2000).toISOString(),
          cost: 50,
        },
        {
          id: "log-4",
          run_id: "run-1",
          run_type: "script" as const,
          event_type: "error" as const,
          tool_name: "web.fetch",
          input: "{}",
          output: "{}",
          error: "Network error",
          timestamp: new Date(Date.now() + 3000).toISOString(),
          cost: 0,
        },
      ];

      for (const log of logs) {
        await executionLogStore.saveExecutionLog(log);
      }
    });

    it("should filter by runType", async () => {
      const scriptLogs = await executionLogStore.listExecutionLogs({ runType: "script" });
      expect(scriptLogs).toHaveLength(3);
      expect(scriptLogs.every(l => l.run_type === "script")).toBe(true);
    });

    it("should filter by eventType", async () => {
      const toolCallLogs = await executionLogStore.listExecutionLogs({ eventType: "tool_call" });
      expect(toolCallLogs).toHaveLength(2);
      expect(toolCallLogs.every(l => l.event_type === "tool_call")).toBe(true);
    });

    it("should filter by toolName", async () => {
      const fetchLogs = await executionLogStore.listExecutionLogs({ toolName: "web.fetch" });
      expect(fetchLogs).toHaveLength(2);
      expect(fetchLogs.every(l => l.tool_name === "web.fetch")).toBe(true);
    });

    it("should limit results", async () => {
      const logs = await executionLogStore.listExecutionLogs({ limit: 2 });
      expect(logs).toHaveLength(2);
    });

    it("should combine multiple filters", async () => {
      const logs = await executionLogStore.listExecutionLogs({
        runType: "script",
        eventType: "tool_call",
        toolName: "web.fetch",
      });
      expect(logs).toHaveLength(1);
      expect(logs[0].id).toBe("log-2");
    });
  });

  describe("getRunCost", () => {
    it("should return total cost for a run", async () => {
      const logs = [
        {
          id: "log-1",
          run_id: "run-1",
          run_type: "script" as const,
          event_type: "tool_call" as const,
          tool_name: "web.fetch",
          input: "{}",
          output: "{}",
          error: "",
          timestamp: new Date().toISOString(),
          cost: 100,
        },
        {
          id: "log-2",
          run_id: "run-1",
          run_type: "script" as const,
          event_type: "tool_call" as const,
          tool_name: "ai.generate",
          input: "{}",
          output: "{}",
          error: "",
          timestamp: new Date().toISOString(),
          cost: 500,
        },
        {
          id: "log-3",
          run_id: "run-2",
          run_type: "script" as const,
          event_type: "tool_call" as const,
          tool_name: "web.fetch",
          input: "{}",
          output: "{}",
          error: "",
          timestamp: new Date().toISOString(),
          cost: 200,
        },
      ];

      for (const log of logs) {
        await executionLogStore.saveExecutionLog(log);
      }

      const cost = await executionLogStore.getRunCost("run-1", "script");
      expect(cost).toBe(600); // 100 + 500
    });

    it("should return 0 for non-existent run", async () => {
      const cost = await executionLogStore.getRunCost("non-existent", "script");
      expect(cost).toBe(0);
    });
  });

  describe("countToolCalls", () => {
    it("should count tool calls for a run", async () => {
      const logs = [
        {
          id: "log-1",
          run_id: "run-1",
          run_type: "script" as const,
          event_type: "run_start" as const,
          tool_name: "",
          input: "{}",
          output: "{}",
          error: "",
          timestamp: new Date().toISOString(),
          cost: 0,
        },
        {
          id: "log-2",
          run_id: "run-1",
          run_type: "script" as const,
          event_type: "tool_call" as const,
          tool_name: "web.fetch",
          input: "{}",
          output: "{}",
          error: "",
          timestamp: new Date().toISOString(),
          cost: 100,
        },
        {
          id: "log-3",
          run_id: "run-1",
          run_type: "script" as const,
          event_type: "tool_call" as const,
          tool_name: "file.read",
          input: "{}",
          output: "{}",
          error: "",
          timestamp: new Date().toISOString(),
          cost: 50,
        },
        {
          id: "log-4",
          run_id: "run-1",
          run_type: "script" as const,
          event_type: "run_end" as const,
          tool_name: "",
          input: "{}",
          output: "{}",
          error: "",
          timestamp: new Date().toISOString(),
          cost: 0,
        },
      ];

      for (const log of logs) {
        await executionLogStore.saveExecutionLog(log);
      }

      const count = await executionLogStore.countToolCalls("run-1", "script");
      expect(count).toBe(2);
    });

    it("should return 0 for run with no tool calls", async () => {
      const logs = [
        {
          id: "log-1",
          run_id: "run-1",
          run_type: "script" as const,
          event_type: "run_start" as const,
          tool_name: "",
          input: "{}",
          output: "{}",
          error: "",
          timestamp: new Date().toISOString(),
          cost: 0,
        },
        {
          id: "log-2",
          run_id: "run-1",
          run_type: "script" as const,
          event_type: "run_end" as const,
          tool_name: "",
          input: "{}",
          output: "{}",
          error: "",
          timestamp: new Date().toISOString(),
          cost: 0,
        },
      ];

      for (const log of logs) {
        await executionLogStore.saveExecutionLog(log);
      }

      const count = await executionLogStore.countToolCalls("run-1", "script");
      expect(count).toBe(0);
    });
  });

  describe("error handling", () => {
    it("should store and retrieve error information", async () => {
      const log = {
        id: "log-1",
        run_id: "run-1",
        run_type: "script" as const,
        event_type: "error" as const,
        tool_name: "web.fetch",
        input: JSON.stringify({ url: "https://example.com" }),
        output: "",
        error: "Network timeout after 30s",
        timestamp: new Date().toISOString(),
        cost: 0,
      };

      await executionLogStore.saveExecutionLog(log);
      const result = await executionLogStore.getExecutionLog("log-1");

      expect(result?.error).toBe("Network timeout after 30s");
      expect(result?.event_type).toBe("error");
    });
  });
});
