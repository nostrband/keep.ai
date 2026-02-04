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
 * Phase tracks execution progress only - it only moves forward.
 * Status (see RunStatus) tracks why execution is paused/stopped.
 *
 * Producer: pending → executing → committed
 * Consumer: pending → preparing → prepared → mutating → mutated → emitting → committed
 *
 * Note: 'suspended' and 'failed' are deprecated phase values.
 * They exist for backwards compatibility with pre-v39 data.
 * New code should use status field for terminal/paused detection.
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
  // Deprecated phase values - kept for backwards compatibility
  | "suspended" // @deprecated Use status='paused:*' instead
  | "failed"; // @deprecated Use status='failed:*' instead

/**
 * Handler run status - why execution is paused/stopped.
 *
 * Status is orthogonal to phase:
 * - Phase tracks progress (preparing → committed)
 * - Status tracks why stopped (active, paused, failed, etc.)
 *
 * Active: Currently executing
 * Paused: Temporarily stopped, can resume
 *   - paused:transient: Network/rate limit, will auto-retry
 *   - paused:approval: Needs user action (auth, permission)
 *   - paused:reconciliation: Uncertain mutation, needs user verification
 * Failed: Permanently stopped
 *   - failed:logic: Script error, auto-fix eligible
 *   - failed:internal: Host/connector bug
 * Committed: Successfully completed
 * Crashed: Found incomplete on restart
 */
export type RunStatus =
  | "active" // Currently executing
  | "paused:transient" // Transient failure, will retry
  | "paused:approval" // Waiting for user approval (auth, permission)
  | "paused:reconciliation" // Uncertain mutation outcome
  | "failed:logic" // Script error, auto-fix eligible
  | "failed:internal" // Host/connector bug
  | "committed" // Successfully completed
  | "crashed"; // Found incomplete on restart

/**
 * Check if a run status is terminal (no more execution possible).
 * Terminal statuses: committed, failed:*, crashed
 */
export function isTerminalStatus(status: RunStatus): boolean {
  return (
    status === "committed" ||
    status === "failed:logic" ||
    status === "failed:internal" ||
    status === "crashed"
  );
}

/**
 * Check if a run status is paused (temporarily stopped, can resume).
 * Paused statuses: paused:transient, paused:approval, paused:reconciliation
 */
export function isPausedStatus(status: RunStatus): boolean {
  return status.startsWith("paused:");
}

/**
 * Check if a run status is failed (permanently stopped due to error).
 * Failed statuses: failed:logic, failed:internal
 */
export function isFailedStatus(status: RunStatus): boolean {
  return status.startsWith("failed:");
}

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
  status: RunStatus; // Why execution is paused/stopped
  retry_of: string; // ID of previous attempt (empty for first attempt)
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
  /** ID of previous attempt (empty for first attempt) */
  retry_of?: string;
  /** Starting phase for retry runs (default: 'pending') */
  phase?: HandlerRunPhase;
  /** Prepare result to copy from previous run (for retries after mutation) */
  prepare_result?: string;
}

/**
 * Input for updating a handler run.
 */
export interface UpdateHandlerRunInput {
  phase?: HandlerRunPhase;
  status?: RunStatus;
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
    const phase = input.phase || "pending";
    const retry_of = input.retry_of || "";
    const prepare_result = input.prepare_result || "";

    await db.exec(
      `INSERT INTO handler_runs (
        id, script_run_id, workflow_id, handler_type, handler_name,
        phase, status, retry_of, prepare_result, input_state, output_state,
        start_timestamp, end_timestamp, error, error_type, cost, logs
      ) VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, '', ?, '', '', '', 0, '[]')`,
      [
        id,
        input.script_run_id,
        input.workflow_id,
        input.handler_type,
        input.handler_name,
        phase,
        retry_of,
        prepare_result,
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
      phase,
      status: "active",
      retry_of,
      prepare_result,
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
    if (input.status !== undefined) {
      updates.push("status = ?");
      params.push(input.status);
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
   * Returns runs with status='active' (currently executing).
   */
  async getIncomplete(
    workflowId: string,
    tx?: DBInterface
  ): Promise<HandlerRun[]> {
    const db = tx || this.db.db;
    const results = await db.execO<Record<string, unknown>>(
      `SELECT * FROM handler_runs
       WHERE workflow_id = ? AND status = 'active'
       ORDER BY start_timestamp`,
      [workflowId]
    );

    if (!results) return [];
    return results.map((row) => this.mapRowToHandlerRun(row));
  }

  /**
   * Get workflow IDs that have incomplete handler runs.
   * Returns workflow IDs with runs in status='active'.
   */
  async getWorkflowsWithIncompleteRuns(tx?: DBInterface): Promise<string[]> {
    const db = tx || this.db.db;
    const results = await db.execO<{ workflow_id: string }>(
      `SELECT DISTINCT workflow_id FROM handler_runs
       WHERE status = 'active'`
    );

    if (!results) return [];
    return results.map((row) => row.workflow_id);
  }

  /**
   * Check if a workflow has any active (non-terminal) handler runs.
   * Returns true if any run has status='active'.
   */
  async hasActiveRun(workflowId: string, tx?: DBInterface): Promise<boolean> {
    const db = tx || this.db.db;
    const results = await db.execO<{ count: number }>(
      `SELECT COUNT(*) as count FROM handler_runs
       WHERE workflow_id = ? AND status = 'active'`,
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
   * Get the retry chain for a run (for UI/debugging).
   * Returns all runs in the chain, oldest first.
   *
   * Walks backwards from the given run to the original attempt,
   * then returns the chain in chronological order.
   */
  async getRetryChain(runId: string, tx?: DBInterface): Promise<HandlerRun[]> {
    const chain: HandlerRun[] = [];
    let currentId: string | null = runId;

    // Walk backwards through retry_of links to find original
    while (currentId) {
      const run = await this.get(currentId, tx);
      if (!run) break;
      chain.unshift(run); // Add to beginning (oldest first)
      currentId = run.retry_of || null;
    }

    return chain;
  }

  /**
   * Find the latest attempt in a retry chain.
   *
   * Given any run ID in a chain (original or retry), finds the most recent attempt.
   * Uses a recursive approach: first walks back to original, then forward to latest.
   */
  async findLatestInChain(
    runId: string,
    tx?: DBInterface
  ): Promise<HandlerRun | null> {
    const db = tx || this.db.db;

    // First, find the original run (the one with no retry_of)
    let originalId = runId;
    let current = await this.get(runId, tx);
    while (current && current.retry_of) {
      originalId = current.retry_of;
      current = await this.get(current.retry_of, tx);
    }

    // Now find the latest run in the chain (the one nothing points to)
    // Start from original and follow forward
    let latestRun = current;
    let searchId = originalId;

    while (true) {
      // Find any run that has retry_of pointing to current
      const results = await db.execO<Record<string, unknown>>(
        `SELECT * FROM handler_runs WHERE retry_of = ? LIMIT 1`,
        [searchId]
      );

      if (!results || results.length === 0) {
        // No more retries, we found the latest
        break;
      }

      latestRun = this.mapRowToHandlerRun(results[0]);
      searchId = latestRun.id;
    }

    return latestRun;
  }

  /**
   * Get runs that are retries of a given run.
   * Returns direct children only (not the full descendant chain).
   */
  async getRetriesOf(runId: string, tx?: DBInterface): Promise<HandlerRun[]> {
    const db = tx || this.db.db;
    const results = await db.execO<Record<string, unknown>>(
      `SELECT * FROM handler_runs WHERE retry_of = ? ORDER BY start_timestamp`,
      [runId]
    );

    if (!results) return [];
    return results.map((row) => this.mapRowToHandlerRun(row));
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
      status: (row.status as RunStatus) || "active", // Default for pre-v39 rows
      retry_of: (row.retry_of as string) || "", // Default for pre-v41 rows
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
