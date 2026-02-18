import { bytesToHex } from "@noble/ciphers/utils";
import { randomBytes } from "@noble/ciphers/crypto";
import { KeepDb } from "./database";
import { DBInterface } from "./interfaces";

/**
 * Handler state record — persistent state per handler.
 *
 * Each handler (producer or consumer) maintains state across runs.
 * State is updated atomically during commit (commitProducer/commitConsumer)
 * as part of the handler run's finalization transaction.
 *
 * For producers: typically stores cursors/pagination tokens (e.g., last seen email ID).
 * For consumers: typically stores processing state (e.g., accumulated results, counters).
 */
export interface HandlerState {
  id: string;
  /** Workflow this handler state belongs to */
  workflow_id: string;
  /** Handler name (matches producer/consumer name in WorkflowConfig) */
  handler_name: string;
  /**
   * JSON-serializable handler state object. Written by the handler's
   * next() function return value and committed atomically with the run.
   * Read by the handler on next invocation as context.
   */
  state: unknown;
  /** Unix ms timestamp of last update */
  updated_at: number;
  /** Handler run ID that last updated this state */
  updated_by_run_id: string;
  /**
   * Wake time for time-based scheduling (exec-11).
   * Unix timestamp in milliseconds. When non-zero and due (wake_at <= now),
   * the scheduler triggers the handler even without pending events.
   * 0 means no scheduled wake.
   */
  wake_at: number;
}

/**
 * Store for managing persistent handler state.
 *
 * Each handler (producer or consumer) maintains state across runs.
 * State is updated atomically with handler commits.
 */
export class HandlerStateStore {
  private db: KeepDb;

  constructor(db: KeepDb) {
    this.db = db;
  }

  /**
   * Get handler state by workflow ID and handler name.
   */
  async get(
    workflowId: string,
    handlerName: string,
    tx?: DBInterface
  ): Promise<unknown | null> {
    const db = tx || this.db.db;
    const results = await db.execO<Record<string, unknown>>(
      `SELECT * FROM handler_state WHERE workflow_id = ? AND handler_name = ?`,
      [workflowId, handlerName]
    );

    if (!results || results.length === 0) {
      return null;
    }

    const stateStr = results[0].state as string;
    try {
      return JSON.parse(stateStr);
    } catch {
      return null;
    }
  }

  /**
   * Get full handler state record.
   */
  async getRecord(
    workflowId: string,
    handlerName: string,
    tx?: DBInterface
  ): Promise<HandlerState | null> {
    const db = tx || this.db.db;
    const results = await db.execO<Record<string, unknown>>(
      `SELECT * FROM handler_state WHERE workflow_id = ? AND handler_name = ?`,
      [workflowId, handlerName]
    );

    if (!results || results.length === 0) {
      return null;
    }

    return this.mapRowToHandlerState(results[0]);
  }

  /**
   * Set handler state (insert or update).
   *
   * @internal Execution-model primitive. Use ExecutionModelManager for state transitions.
   */
  async set(
    workflowId: string,
    handlerName: string,
    state: unknown,
    updatedByRunId: string,
    tx?: DBInterface
  ): Promise<void> {
    if (!tx) {
      return this.db.db.tx((tx) => this.set(workflowId, handlerName, state, updatedByRunId, tx));
    }
    const db = tx;
    const now = Date.now();
    const stateJson = JSON.stringify(state);

    // Check if exists
    const existing = await this.getRecord(workflowId, handlerName, db);

    if (existing) {
      // Update
      await db.exec(
        `UPDATE handler_state
         SET state = ?, updated_at = ?, updated_by_run_id = ?
         WHERE workflow_id = ? AND handler_name = ?`,
        [stateJson, now, updatedByRunId, workflowId, handlerName]
      );
    } else {
      // Insert
      const id = bytesToHex(randomBytes(16));
      await db.exec(
        `INSERT INTO handler_state (
          id, workflow_id, handler_name, state, updated_at, updated_by_run_id
        ) VALUES (?, ?, ?, ?, ?, ?)`,
        [id, workflowId, handlerName, stateJson, now, updatedByRunId]
      );
    }
  }

  /**
   * Delete handler state by workflow ID and handler name.
   */
  async delete(
    workflowId: string,
    handlerName: string,
    tx?: DBInterface
  ): Promise<void> {
    const db = tx || this.db.db;
    await db.exec(
      `DELETE FROM handler_state WHERE workflow_id = ? AND handler_name = ?`,
      [workflowId, handlerName]
    );
  }

  /**
   * Delete all handler state for a workflow.
   */
  async deleteByWorkflow(workflowId: string, tx?: DBInterface): Promise<void> {
    const db = tx || this.db.db;
    await db.exec(`DELETE FROM handler_state WHERE workflow_id = ?`, [
      workflowId,
    ]);
  }

  /**
   * List all handler states for a workflow.
   */
  async listByWorkflow(
    workflowId: string,
    tx?: DBInterface
  ): Promise<HandlerState[]> {
    const db = tx || this.db.db;
    const results = await db.execO<Record<string, unknown>>(
      `SELECT * FROM handler_state WHERE workflow_id = ? ORDER BY handler_name`,
      [workflowId]
    );

    if (!results) return [];
    return results.map((row) => this.mapRowToHandlerState(row));
  }

  /**
   * Update just the wake_at field for a handler (exec-11).
   *
   * Uses upsert to create the handler state record if it doesn't exist.
   *
   * @param workflowId - Workflow ID
   * @param handlerName - Handler name
   * @param wakeAt - Wake time in milliseconds (0 to clear)
   *
   * @internal Execution-model primitive. Use ExecutionModelManager for state transitions.
   */
  async updateWakeAt(
    workflowId: string,
    handlerName: string,
    wakeAt: number,
    tx?: DBInterface
  ): Promise<void> {
    if (!tx) {
      return this.db.db.tx((tx) => this.updateWakeAt(workflowId, handlerName, wakeAt, tx));
    }
    const db = tx;
    const now = Date.now();

    // Check if exists
    const existing = await this.getRecord(workflowId, handlerName, db);

    if (existing) {
      // Update only wake_at
      await db.exec(
        `UPDATE handler_state SET wake_at = ?, updated_at = ?
         WHERE workflow_id = ? AND handler_name = ?`,
        [wakeAt, now, workflowId, handlerName]
      );
    } else {
      // Insert with empty state
      const id = bytesToHex(randomBytes(16));
      await db.exec(
        `INSERT INTO handler_state (
          id, workflow_id, handler_name, state, updated_at, updated_by_run_id, wake_at
        ) VALUES (?, ?, ?, '{}', ?, '', ?)`,
        [id, workflowId, handlerName, now, wakeAt]
      );
    }
  }

  /**
   * Get all consumers with active wakeAt that is due (exec-11).
   *
   * @param workflowId - Workflow ID
   * @returns Array of handler names with due wakeAt
   */
  async getConsumersWithDueWakeAt(
    workflowId: string,
    tx?: DBInterface
  ): Promise<string[]> {
    const db = tx || this.db.db;
    const now = Date.now();

    const results = await db.execO<{ handler_name: string }>(
      `SELECT handler_name FROM handler_state
       WHERE workflow_id = ? AND wake_at > 0 AND wake_at <= ?`,
      [workflowId, now]
    );

    if (!results) return [];
    return results.map((r) => r.handler_name);
  }

  /**
   * Map a database row to a HandlerState object.
   */
  private mapRowToHandlerState(row: Record<string, unknown>): HandlerState {
    let state: unknown = {};
    try {
      const stateStr = row.state as string;
      if (stateStr) {
        state = JSON.parse(stateStr);
      }
    } catch {
      // Keep empty object if parsing fails
    }

    return {
      id: row.id as string,
      workflow_id: row.workflow_id as string,
      handler_name: row.handler_name as string,
      state,
      updated_at: row.updated_at as number,
      updated_by_run_id: row.updated_by_run_id as string,
      wake_at: (row.wake_at as number) || 0,
    };
  }
}
