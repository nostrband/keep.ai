import { bytesToHex } from "@noble/ciphers/utils";
import { randomBytes } from "@noble/ciphers/crypto";
import { KeepDb } from "./database";
import { DBInterface } from "./interfaces";

/**
 * Handler type: producer or consumer.
 */
export type HandlerType = "producer" | "consumer";

/**
 * Handler run phase (state machine states).
 *
 * Producer: pending → executing → committed | failed
 * Consumer: pending → preparing → prepared → mutating → mutated → emitting → committed
 *           with possible transitions to suspended | failed from most states
 */
export type HandlerRunPhase =
  | "pending"
  | "executing" // Producer only
  | "preparing" // Consumer only
  | "prepared" // Consumer only
  | "mutating" // Consumer only
  | "mutated" // Consumer only
  | "emitting" // Consumer only
  | "committed"
  | "suspended"
  | "failed";

/**
 * Error type classification for handler failures.
 */
export type HandlerErrorType = "auth" | "permission" | "network" | "logic" | "unknown";

/**
 * Handler run record - granular execution tracking.
 */
export interface HandlerRun {
  id: string;
  script_run_id: string;
  workflow_id: string;
  handler_type: HandlerType;
  handler_name: string;
  phase: HandlerRunPhase;
  prepare_result: string; // JSON: { reservations, data, ui }
  input_state: string; // JSON: State received from previous run
  output_state: string; // JSON: State returned by handler
  start_timestamp: string;
  end_timestamp: string;
  error: string;
  error_type: HandlerErrorType | "";
  cost: number; // Microdollars
  logs: string; // JSON array of log entries
}

/**
 * Input for creating a new handler run.
 */
export interface CreateHandlerRunInput {
  script_run_id: string;
  workflow_id: string;
  handler_type: HandlerType;
  handler_name: string;
  input_state?: string;
}

/**
 * Input for updating a handler run.
 */
export interface UpdateHandlerRunInput {
  phase?: HandlerRunPhase;
  prepare_result?: string;
  output_state?: string;
  end_timestamp?: string;
  error?: string;
  error_type?: HandlerErrorType | "";
  cost?: number;
  logs?: string;
}

/**
 * Store for managing handler runs in the execution model.
 *
 * Handler runs are granular execution records for producers and consumers.
 * They track the state machine progression through phases.
 */
export class HandlerRunStore {
  private db: KeepDb;

  constructor(db: KeepDb) {
    this.db = db;
  }

  /**
   * Get a handler run by ID.
   */
  async get(id: string, tx?: DBInterface): Promise<HandlerRun | null> {
    const db = tx || this.db.db;
    const results = await db.execO<Record<string, unknown>>(
      `SELECT * FROM handler_runs WHERE id = ?`,
      [id]
    );

    if (!results || results.length === 0) {
      return null;
    }

    return this.mapRowToHandlerRun(results[0]);
  }

  /**
   * Create a new handler run.
   */
  async create(
    input: CreateHandlerRunInput,
    tx?: DBInterface
  ): Promise<HandlerRun> {
    const db = tx || this.db.db;
    const id = bytesToHex(randomBytes(16));
    const now = new Date().toISOString();

    await db.exec(
      `INSERT INTO handler_runs (
        id, script_run_id, workflow_id, handler_type, handler_name,
        phase, prepare_result, input_state, output_state,
        start_timestamp, end_timestamp, error, error_type, cost, logs
      ) VALUES (?, ?, ?, ?, ?, 'pending', '', ?, '', ?, '', '', '', 0, '[]')`,
      [
        id,
        input.script_run_id,
        input.workflow_id,
        input.handler_type,
        input.handler_name,
        input.input_state || "",
        now,
      ]
    );

    return {
      id,
      script_run_id: input.script_run_id,
      workflow_id: input.workflow_id,
      handler_type: input.handler_type,
      handler_name: input.handler_name,
      phase: "pending",
      prepare_result: "",
      input_state: input.input_state || "",
      output_state: "",
      start_timestamp: now,
      end_timestamp: "",
      error: "",
      error_type: "",
      cost: 0,
      logs: "[]",
    };
  }

  /**
   * Update a handler run.
   */
  async update(
    id: string,
    input: UpdateHandlerRunInput,
    tx?: DBInterface
  ): Promise<void> {
    const db = tx || this.db.db;

    const updates: string[] = [];
    const params: unknown[] = [];

    if (input.phase !== undefined) {
      updates.push("phase = ?");
      params.push(input.phase);
    }
    if (input.prepare_result !== undefined) {
      updates.push("prepare_result = ?");
      params.push(input.prepare_result);
    }
    if (input.output_state !== undefined) {
      updates.push("output_state = ?");
      params.push(input.output_state);
    }
    if (input.end_timestamp !== undefined) {
      updates.push("end_timestamp = ?");
      params.push(input.end_timestamp);
    }
    if (input.error !== undefined) {
      updates.push("error = ?");
      params.push(input.error);
    }
    if (input.error_type !== undefined) {
      updates.push("error_type = ?");
      params.push(input.error_type);
    }
    if (input.cost !== undefined) {
      updates.push("cost = ?");
      params.push(input.cost);
    }
    if (input.logs !== undefined) {
      updates.push("logs = ?");
      params.push(input.logs);
    }

    if (updates.length === 0) return;

    params.push(id);
    await db.exec(
      `UPDATE handler_runs SET ${updates.join(", ")} WHERE id = ?`,
      params
    );
  }

  /**
   * Update handler run phase.
   */
  async updatePhase(
    id: string,
    phase: HandlerRunPhase,
    tx?: DBInterface
  ): Promise<void> {
    await this.update(id, { phase }, tx);
  }

  /**
   * Get handler runs by session (script_run).
   */
  async getBySession(
    scriptRunId: string,
    tx?: DBInterface
  ): Promise<HandlerRun[]> {
    const db = tx || this.db.db;
    const results = await db.execO<Record<string, unknown>>(
      `SELECT * FROM handler_runs WHERE script_run_id = ? ORDER BY start_timestamp`,
      [scriptRunId]
    );

    if (!results) return [];
    return results.map((row) => this.mapRowToHandlerRun(row));
  }

  /**
   * Get incomplete (non-terminal) handler runs for a workflow.
   */
  async getIncomplete(
    workflowId: string,
    tx?: DBInterface
  ): Promise<HandlerRun[]> {
    const db = tx || this.db.db;
    const results = await db.execO<Record<string, unknown>>(
      `SELECT * FROM handler_runs
       WHERE workflow_id = ? AND phase NOT IN ('committed', 'suspended', 'failed')
       ORDER BY start_timestamp`,
      [workflowId]
    );

    if (!results) return [];
    return results.map((row) => this.mapRowToHandlerRun(row));
  }

  /**
   * Get workflow IDs that have incomplete handler runs.
   */
  async getWorkflowsWithIncompleteRuns(tx?: DBInterface): Promise<string[]> {
    const db = tx || this.db.db;
    const results = await db.execO<{ workflow_id: string }>(
      `SELECT DISTINCT workflow_id FROM handler_runs
       WHERE phase NOT IN ('committed', 'suspended', 'failed')`
    );

    if (!results) return [];
    return results.map((row) => row.workflow_id);
  }

  /**
   * Check if a workflow has any active (non-terminal) handler runs.
   */
  async hasActiveRun(workflowId: string, tx?: DBInterface): Promise<boolean> {
    const db = tx || this.db.db;
    const results = await db.execO<{ count: number }>(
      `SELECT COUNT(*) as count FROM handler_runs
       WHERE workflow_id = ? AND phase NOT IN ('committed', 'suspended', 'failed')`,
      [workflowId]
    );

    if (!results || results.length === 0) return false;
    return results[0].count > 0;
  }

  /**
   * Get handler runs by workflow.
   */
  async getByWorkflow(
    workflowId: string,
    options: { limit?: number } = {},
    tx?: DBInterface
  ): Promise<HandlerRun[]> {
    const db = tx || this.db.db;
    let query = `SELECT * FROM handler_runs WHERE workflow_id = ? ORDER BY start_timestamp DESC`;
    const params: unknown[] = [workflowId];

    if (options.limit) {
      query += ` LIMIT ?`;
      params.push(options.limit);
    }

    const results = await db.execO<Record<string, unknown>>(query, params);
    if (!results) return [];
    return results.map((row) => this.mapRowToHandlerRun(row));
  }

  /**
   * Delete handler runs by session.
   */
  async deleteBySession(scriptRunId: string, tx?: DBInterface): Promise<void> {
    const db = tx || this.db.db;
    await db.exec(`DELETE FROM handler_runs WHERE script_run_id = ?`, [
      scriptRunId,
    ]);
  }

  /**
   * Delete handler runs by workflow.
   */
  async deleteByWorkflow(workflowId: string, tx?: DBInterface): Promise<void> {
    const db = tx || this.db.db;
    await db.exec(`DELETE FROM handler_runs WHERE workflow_id = ?`, [
      workflowId,
    ]);
  }

  /**
   * Map a database row to a HandlerRun object.
   */
  private mapRowToHandlerRun(row: Record<string, unknown>): HandlerRun {
    return {
      id: row.id as string,
      script_run_id: row.script_run_id as string,
      workflow_id: row.workflow_id as string,
      handler_type: row.handler_type as HandlerType,
      handler_name: row.handler_name as string,
      phase: row.phase as HandlerRunPhase,
      prepare_result: row.prepare_result as string,
      input_state: row.input_state as string,
      output_state: row.output_state as string,
      start_timestamp: row.start_timestamp as string,
      end_timestamp: row.end_timestamp as string,
      error: row.error as string,
      error_type: row.error_type as HandlerErrorType | "",
      cost: row.cost as number,
      logs: row.logs as string,
    };
  }
}
