import { bytesToHex } from "@noble/ciphers/utils";
import { randomBytes } from "@noble/ciphers/crypto";
import { KeepDb } from "./database";
import { DBInterface } from "./interfaces";

/**
 * Computed input status for UX (exec-16).
 * - pending: Has unprocessed downstream work
 * - done: All downstream work complete
 * - skipped: Manually skipped by user
 */
export type InputStatus = "pending" | "done" | "skipped";

/**
 * Input record in the Input Ledger.
 *
 * Inputs track external data that triggered workflow processing.
 * Each input has user-facing metadata (title) and links to the
 * producer run that registered it.
 */
export interface Input {
  id: string;
  workflow_id: string;
  source: string;         // Connector name: 'gmail', 'slack', 'sheets', etc.
  type: string;           // Type within source: 'email', 'message', 'row', etc.
  external_id: string;    // External identifier from source system
  title: string;          // Human-readable description
  created_by_run_id: string;  // Producer run that registered this input
  created_at: number;
}

/**
 * Input with computed status for UX display (exec-16).
 */
export interface InputWithStatus extends Input {
  status: InputStatus;
}

/**
 * Aggregated input statistics by source/type (exec-16).
 */
export interface InputStats {
  source: string;
  type: string;
  pending_count: number;
  done_count: number;
  skipped_count: number;
  total_count: number;
}

/**
 * Parameters for registering an external input.
 */
export interface RegisterInputParams {
  source: string;   // Connector name
  type: string;     // Type within source
  id: string;       // External identifier (maps to external_id column)
  title: string;    // Human-readable description
}

/**
 * Store for managing inputs in the Input Ledger.
 *
 * The Input Ledger tracks external inputs with user-facing metadata.
 * Registration is idempotent by (workflow_id, source, type, external_id):
 * re-registering the same input returns the existing inputId.
 *
 * Inputs are created by producers in the producer phase via Topics.registerInput().
 * The returned inputId is then used when publishing events to establish causal links.
 */
export class InputStore {
  private db: KeepDb;

  constructor(db: KeepDb) {
    this.db = db;
  }

  /**
   * Register an external input. Idempotent by (workflow_id, source, type, external_id).
   * Returns existing inputId if already registered, or creates new.
   *
   * @param workflowId - Workflow ID
   * @param params - Input registration parameters
   * @param createdByRunId - Producer run that is registering this input
   * @returns The inputId (existing or newly created)
   */
  async register(
    workflowId: string,
    params: RegisterInputParams,
    createdByRunId: string,
    tx?: DBInterface
  ): Promise<string> {
    if (!tx) {
      return this.db.db.tx((tx) => this.register(workflowId, params, createdByRunId, tx));
    }
    const db = tx;

    // Check if already exists
    const existing = await db.execO<{ id: string }>(
      `SELECT id FROM inputs
       WHERE workflow_id = ? AND source = ? AND type = ? AND external_id = ?`,
      [workflowId, params.source, params.type, params.id]
    );

    if (existing && existing.length > 0) {
      return existing[0].id;
    }

    // Create new input
    const inputId = bytesToHex(randomBytes(16));
    const now = Date.now();

    await db.exec(
      `INSERT INTO inputs (id, workflow_id, source, type, external_id, title, created_by_run_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [inputId, workflowId, params.source, params.type, params.id, params.title, createdByRunId, now]
    );

    return inputId;
  }

  /**
   * Get an input by ID.
   */
  async get(inputId: string, tx?: DBInterface): Promise<Input | null> {
    const db = tx || this.db.db;
    const results = await db.execO<Record<string, unknown>>(
      `SELECT * FROM inputs WHERE id = ?`,
      [inputId]
    );

    if (!results || results.length === 0) {
      return null;
    }

    return this.mapRowToInput(results[0]);
  }

  /**
   * Get all inputs for a workflow.
   */
  async getByWorkflow(workflowId: string, tx?: DBInterface): Promise<Input[]> {
    const db = tx || this.db.db;
    const results = await db.execO<Record<string, unknown>>(
      `SELECT * FROM inputs WHERE workflow_id = ? ORDER BY created_at DESC`,
      [workflowId]
    );

    if (!results) return [];
    return results.map((row) => this.mapRowToInput(row));
  }

  /**
   * Get inputs by IDs.
   */
  async getByIds(inputIds: string[], tx?: DBInterface): Promise<Input[]> {
    const db = tx || this.db.db;

    if (inputIds.length === 0) return [];

    const placeholders = inputIds.map(() => "?").join(", ");
    const results = await db.execO<Record<string, unknown>>(
      `SELECT * FROM inputs WHERE id IN (${placeholders})`,
      inputIds
    );

    if (!results) return [];
    return results.map((row) => this.mapRowToInput(row));
  }

  /**
   * Delete all inputs for a workflow.
   */
  async deleteByWorkflow(workflowId: string, tx?: DBInterface): Promise<void> {
    const db = tx || this.db.db;
    await db.exec(`DELETE FROM inputs WHERE workflow_id = ?`, [workflowId]);
  }

  /**
   * Get inputs for a workflow with computed status (exec-16).
   *
   * Status is computed as:
   * - pending: Any event with caused_by containing this input has status='pending' or 'reserved'
   * - done: All events with caused_by containing this input have status='consumed' or 'skipped'
   * - skipped: (future) Input marked as skipped
   *
   * Note: Uses JSON array containment check. SQLite doesn't have native JSON array
   * containment, so we use LIKE with delimiters for reliable matching.
   */
  async getByWorkflowWithStatus(
    workflowId: string,
    options: { limit?: number; offset?: number } = {},
    tx?: DBInterface
  ): Promise<InputWithStatus[]> {
    const db = tx || this.db.db;

    // Query inputs with status computed from events
    // An input is 'done' only if it has caused_by events AND none are pending/reserved
    // An input is 'pending' if it has no caused_by events OR any are pending/reserved
    let query = `
      SELECT i.*,
        CASE
          WHEN EXISTS (
            SELECT 1 FROM events e
            WHERE e.workflow_id = i.workflow_id
            AND (e.caused_by LIKE '%"' || i.id || '"%')
            AND e.status IN ('pending', 'reserved')
          ) THEN 'pending'
          WHEN EXISTS (
            SELECT 1 FROM events e
            WHERE e.workflow_id = i.workflow_id
            AND (e.caused_by LIKE '%"' || i.id || '"%')
          ) THEN 'done'
          ELSE 'pending'
        END as computed_status
      FROM inputs i
      WHERE i.workflow_id = ?
      ORDER BY i.created_at DESC
    `;

    const params: unknown[] = [workflowId];

    if (options.limit) {
      query += ` LIMIT ?`;
      params.push(options.limit);
    }

    if (options.offset) {
      query += ` OFFSET ?`;
      params.push(options.offset);
    }

    const results = await db.execO<Record<string, unknown>>(query, params);

    if (!results) return [];
    return results.map((row) => this.mapRowToInputWithStatus(row));
  }

  /**
   * Get aggregated input statistics by source/type for a workflow (exec-16).
   *
   * Returns counts of pending, done, and skipped inputs grouped by source and type.
   */
  async getStatsByWorkflow(
    workflowId: string,
    tx?: DBInterface
  ): Promise<InputStats[]> {
    const db = tx || this.db.db;

    const query = `
      SELECT
        i.source,
        i.type,
        SUM(CASE
          WHEN EXISTS (
            SELECT 1 FROM events e
            WHERE e.workflow_id = i.workflow_id
            AND (e.caused_by LIKE '%"' || i.id || '"%')
            AND e.status IN ('pending', 'reserved')
          ) THEN 1
          WHEN NOT EXISTS (
            SELECT 1 FROM events e
            WHERE e.workflow_id = i.workflow_id
            AND (e.caused_by LIKE '%"' || i.id || '"%')
          ) THEN 1
          ELSE 0
        END) as pending_count,
        SUM(CASE
          WHEN EXISTS (
            SELECT 1 FROM events e
            WHERE e.workflow_id = i.workflow_id
            AND (e.caused_by LIKE '%"' || i.id || '"%')
          ) AND NOT EXISTS (
            SELECT 1 FROM events e
            WHERE e.workflow_id = i.workflow_id
            AND (e.caused_by LIKE '%"' || i.id || '"%')
            AND e.status IN ('pending', 'reserved')
          ) THEN 1 ELSE 0
        END) as done_count,
        0 as skipped_count,
        COUNT(*) as total_count
      FROM inputs i
      WHERE i.workflow_id = ?
      GROUP BY i.source, i.type
      ORDER BY i.source, i.type
    `;

    const results = await db.execO<Record<string, unknown>>(query, [workflowId]);

    if (!results) return [];
    return results.map((row) => ({
      source: row.source as string,
      type: row.type as string,
      pending_count: row.pending_count as number,
      done_count: row.done_count as number,
      skipped_count: row.skipped_count as number,
      total_count: row.total_count as number,
    }));
  }

  /**
   * Get stale inputs - inputs pending longer than threshold (exec-16).
   *
   * @param workflowId - Workflow ID
   * @param thresholdMs - Threshold in milliseconds (default: 7 days)
   * @returns Inputs that have been pending longer than threshold
   */
  async getStaleInputs(
    workflowId: string,
    thresholdMs: number = 7 * 24 * 60 * 60 * 1000,
    tx?: DBInterface
  ): Promise<InputWithStatus[]> {
    const db = tx || this.db.db;
    const cutoffTime = Date.now() - thresholdMs;

    const query = `
      SELECT i.*,
        'pending' as computed_status
      FROM inputs i
      WHERE i.workflow_id = ?
      AND i.created_at < ?
      AND (
        EXISTS (
          SELECT 1 FROM events e
          WHERE e.workflow_id = i.workflow_id
          AND (e.caused_by LIKE '%"' || i.id || '"%')
          AND e.status IN ('pending', 'reserved')
        )
        OR NOT EXISTS (
          SELECT 1 FROM events e
          WHERE e.workflow_id = i.workflow_id
          AND (e.caused_by LIKE '%"' || i.id || '"%')
        )
      )
      ORDER BY i.created_at ASC
    `;

    const results = await db.execO<Record<string, unknown>>(query, [workflowId, cutoffTime]);

    if (!results) return [];
    return results.map((row) => this.mapRowToInputWithStatus(row));
  }

  /**
   * Count inputs needing attention for a workflow (exec-16).
   * This includes stale inputs and any inputs with blocked/indeterminate mutations.
   */
  async countNeedsAttention(
    workflowId: string,
    staleThresholdMs: number = 7 * 24 * 60 * 60 * 1000,
    tx?: DBInterface
  ): Promise<number> {
    const db = tx || this.db.db;
    const cutoffTime = Date.now() - staleThresholdMs;

    // Count stale inputs (pending longer than threshold)
    const staleQuery = `
      SELECT COUNT(DISTINCT i.id) as count
      FROM inputs i
      WHERE i.workflow_id = ?
      AND i.created_at < ?
      AND (
        EXISTS (
          SELECT 1 FROM events e
          WHERE e.workflow_id = i.workflow_id
          AND (e.caused_by LIKE '%"' || i.id || '"%')
          AND e.status IN ('pending', 'reserved')
        )
        OR NOT EXISTS (
          SELECT 1 FROM events e
          WHERE e.workflow_id = i.workflow_id
          AND (e.caused_by LIKE '%"' || i.id || '"%')
        )
      )
    `;

    const staleResult = await db.execO<{ count: number }>(staleQuery, [workflowId, cutoffTime]);
    const staleCount = staleResult?.[0]?.count || 0;

    // Count inputs with indeterminate mutations (needs user action)
    const indeterminateQuery = `
      SELECT COUNT(DISTINCT i.id) as count
      FROM inputs i
      JOIN events e ON e.workflow_id = i.workflow_id
        AND (e.caused_by LIKE '%"' || i.id || '"%')
      JOIN handler_runs hr ON hr.id = e.reserved_by_run_id
      JOIN mutations m ON m.handler_run_id = hr.id
      WHERE i.workflow_id = ?
      AND m.status = 'indeterminate'
      AND m.resolved_by = ''
    `;

    const indeterminateResult = await db.execO<{ count: number }>(indeterminateQuery, [workflowId]);
    const indeterminateCount = indeterminateResult?.[0]?.count || 0;

    return staleCount + indeterminateCount;
  }

  /**
   * Map a database row to an Input object.
   */
  private mapRowToInput(row: Record<string, unknown>): Input {
    return {
      id: row.id as string,
      workflow_id: row.workflow_id as string,
      source: row.source as string,
      type: row.type as string,
      external_id: row.external_id as string,
      title: row.title as string,
      created_by_run_id: row.created_by_run_id as string,
      created_at: row.created_at as number,
    };
  }

  /**
   * Map a database row to an InputWithStatus object.
   */
  private mapRowToInputWithStatus(row: Record<string, unknown>): InputWithStatus {
    return {
      ...this.mapRowToInput(row),
      status: (row.computed_status as InputStatus) || "done",
    };
  }
}
