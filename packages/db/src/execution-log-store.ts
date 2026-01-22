import { CRSqliteDB } from "./database";
import { DBInterface } from "./interfaces";

/**
 * Event types for execution logs.
 * - run_start: Task/script execution began
 * - run_end: Task/script execution completed
 * - tool_call: Individual tool invocation
 * - error: Error during execution
 */
export type ExecutionLogEventType = "run_start" | "run_end" | "tool_call" | "error";

/**
 * Run types for execution logs.
 * - script: Script run (workflow execution)
 * - task: Task run (agent interaction)
 */
export type ExecutionLogRunType = "script" | "task";

export interface ExecutionLog {
  id: string;
  run_id: string;
  run_type: ExecutionLogRunType;
  event_type: ExecutionLogEventType;
  tool_name: string;
  input: string;   // JSON
  output: string;  // JSON
  error: string;
  timestamp: string;
  cost: number;    // Microdollars
}

interface ExecutionLogRow {
  id: string;
  run_id: string;
  run_type: string;
  event_type: string;
  tool_name: string;
  input: string;
  output: string;
  error: string;
  timestamp: string;
  cost: number;
}

function rowToExecutionLog(row: ExecutionLogRow): ExecutionLog {
  return {
    id: row.id,
    run_id: row.run_id,
    run_type: row.run_type as ExecutionLogRunType,
    event_type: row.event_type as ExecutionLogEventType,
    tool_name: row.tool_name,
    input: row.input,
    output: row.output,
    error: row.error,
    timestamp: row.timestamp,
    cost: row.cost,
  };
}

export class ExecutionLogStore {
  private db: CRSqliteDB;

  constructor(db: CRSqliteDB) {
    this.db = db;
  }

  /**
   * Save an execution log entry.
   */
  async saveExecutionLog(log: ExecutionLog, tx?: DBInterface): Promise<void> {
    const db = tx || this.db.db;
    await db.exec(
      `INSERT OR REPLACE INTO execution_logs (id, run_id, run_type, event_type, tool_name, input, output, error, timestamp, cost)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        log.id,
        log.run_id,
        log.run_type,
        log.event_type,
        log.tool_name,
        log.input,
        log.output,
        log.error,
        log.timestamp,
        log.cost,
      ]
    );
  }

  /**
   * Get execution logs for a specific run.
   */
  async getExecutionLogs(
    runId: string,
    runType: ExecutionLogRunType
  ): Promise<ExecutionLog[]> {
    const results = await this.db.db.execO<ExecutionLogRow>(
      `SELECT * FROM execution_logs
       WHERE run_id = ? AND run_type = ?
       ORDER BY timestamp ASC`,
      [runId, runType]
    );

    if (!results) return [];

    return results.map(rowToExecutionLog);
  }

  /**
   * Get a single execution log by ID.
   */
  async getExecutionLog(id: string): Promise<ExecutionLog | null> {
    const results = await this.db.db.execO<ExecutionLogRow>(
      "SELECT * FROM execution_logs WHERE id = ?",
      [id]
    );

    if (!results || results.length === 0) {
      return null;
    }

    return rowToExecutionLog(results[0]);
  }

  /**
   * Get execution logs with filtering options.
   */
  async listExecutionLogs(opts?: {
    runType?: ExecutionLogRunType;
    eventType?: ExecutionLogEventType;
    toolName?: string;
    limit?: number;
    before?: string;
  }): Promise<ExecutionLog[]> {
    let sql = `SELECT * FROM execution_logs`;
    const args: (string | number)[] = [];
    const conditions: string[] = [];

    if (opts?.runType) {
      conditions.push("run_type = ?");
      args.push(opts.runType);
    }

    if (opts?.eventType) {
      conditions.push("event_type = ?");
      args.push(opts.eventType);
    }

    if (opts?.toolName) {
      conditions.push("tool_name = ?");
      args.push(opts.toolName);
    }

    if (opts?.before) {
      conditions.push("timestamp < ?");
      args.push(opts.before);
    }

    if (conditions.length > 0) {
      sql += " WHERE " + conditions.join(" AND ");
    }

    sql += " ORDER BY timestamp DESC";

    if (opts?.limit) {
      sql += " LIMIT ?";
      args.push(opts.limit);
    }

    const results = await this.db.db.execO<ExecutionLogRow>(sql, args);

    if (!results) return [];

    return results.map(rowToExecutionLog);
  }

  /**
   * Get total cost for a specific run.
   */
  async getRunCost(runId: string, runType: ExecutionLogRunType): Promise<number> {
    const results = await this.db.db.execO<{ total_cost: number }>(
      `SELECT SUM(cost) as total_cost FROM execution_logs
       WHERE run_id = ? AND run_type = ?`,
      [runId, runType]
    );

    return results?.[0]?.total_cost || 0;
  }

  /**
   * Count tool calls for a specific run.
   */
  async countToolCalls(runId: string, runType: ExecutionLogRunType): Promise<number> {
    const results = await this.db.db.execO<{ count: number }>(
      `SELECT COUNT(*) as count FROM execution_logs
       WHERE run_id = ? AND run_type = ? AND event_type = 'tool_call'`,
      [runId, runType]
    );

    return results?.[0]?.count || 0;
  }
}
