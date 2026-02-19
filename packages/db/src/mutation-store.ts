import { bytesToHex } from "@noble/ciphers/utils";
import { randomBytes } from "@noble/ciphers/crypto";
import { KeepDb } from "./database";
import { DBInterface } from "./interfaces";

/**
 * Mutation status tracking.
 * - pending: Mutation record created, not yet executed
 * - in_flight: External call started (for crash detection)
 * - applied: External call completed successfully
 * - failed: External call failed definitively
 * - needs_reconcile: Uncertain outcome, reconciliation in progress
 * - indeterminate: Uncertain outcome, reconciliation exhausted or unavailable
 */
export type MutationStatus =
  | "pending"
  | "in_flight"
  | "applied"
  | "failed"
  | "needs_reconcile"
  | "indeterminate";

/**
 * Result from a connector's reconcile() method.
 * Per docs/dev/13-reconciliation.md §13.6.2:
 * - applied: Mutation confirmed as committed
 * - failed: Mutation confirmed as not committed (safe to retry)
 * - retry: Reconciliation inconclusive, should retry later
 */
export interface ReconcileResult {
  status: "applied" | "failed" | "retry";
  /** Tool-specific result (e.g., message ID for email) - only when status=applied */
  result?: unknown;
}

/**
 * User resolution for indeterminate mutations.
 *
 * Per exec-14 spec:
 * - user_assert_applied: User verified mutation happened
 * - user_assert_failed: User verified mutation did not happen
 * - user_skip: User wants to skip this event
 * - user_retry: Legacy alias for user_assert_failed (creates retry)
 * - reconciliation: Resolved by automated reconciliation scheduler
 */
export type MutationResolution =
  | "user_skip"
  | "user_retry"
  | "user_assert_failed"
  | "user_assert_applied"
  | "reconciliation";

/**
 * Mutation record — ledger entry for tracking external side effects.
 *
 * Each consumer handler run can have at most one mutation (1:1 relationship).
 * The mutation tracks the external call (e.g., send email, post message)
 * for crash recovery and reconciliation.
 *
 * Lifecycle: pending → in_flight → applied | failed | needs_reconcile → indeterminate
 *
 * The mutation status determines how the execution model handles crashes:
 * - pending/failed: Pre-mutation, safe to release events and retry
 * - in_flight: Uncertain, needs reconciliation if connector supports it
 * - applied: Post-mutation, events must be consumed (no re-delivery)
 * - needs_reconcile: Actively attempting to verify outcome
 * - indeterminate: Reconciliation exhausted, needs user resolution
 */
export interface Mutation {
  id: string;
  /** Handler run that owns this mutation (1:1 relationship) */
  handler_run_id: string;
  /** Workflow this mutation belongs to */
  workflow_id: string;
  /** Connector name (e.g., 'gmail', 'slack') — set when tool is called */
  tool_namespace: string;
  /** Method name within connector (e.g., 'send', 'post') — set when tool is called */
  tool_method: string;
  /** JSON-serialized tool call parameters — set when tool is called */
  params: string;
  /** Connector-generated key for idempotent retries */
  idempotency_key: string;
  /** Current mutation status (see MutationStatus) */
  status: MutationStatus;
  /** JSON-serialized tool call result (only when status=applied) */
  result: string;
  /** Error message (when status=failed, needs_reconcile, or indeterminate) */
  error: string;
  /** Number of reconciliation attempts made so far */
  reconcile_attempts: number;
  /** Unix ms timestamp of last reconciliation attempt (0 if none) */
  last_reconcile_at: number;
  /** Unix ms timestamp of next scheduled reconciliation (0 if none) */
  next_reconcile_at: number;
  /** User resolution for indeterminate mutations (empty if not resolved) */
  resolved_by: MutationResolution | "";
  /** Unix ms timestamp when user resolved this mutation (0 if not resolved) */
  resolved_at: number;
  /** User-facing title from prepareResult.ui.title (exec-15) */
  ui_title: string;
  created_at: number;
  updated_at: number;
}

/**
 * Input for creating a new mutation.
 */
export interface CreateMutationInput {
  handler_run_id: string;
  workflow_id: string;
  /** User-facing title from prepareResult.ui.title (exec-15) */
  ui_title?: string;
}

/**
 * Input for creating a mutation directly in in_flight status.
 * Used when mutation tool is intercepted — no "pending" state needed.
 */
export interface CreateInFlightInput {
  handler_run_id: string;
  workflow_id: string;
  tool_namespace: string;
  tool_method: string;
  params: string;
  idempotency_key?: string;
  /** User-facing title from prepareResult.ui.title (exec-15) */
  ui_title?: string;
}

/**
 * Input for updating a mutation.
 */
export interface UpdateMutationInput {
  tool_namespace?: string;
  tool_method?: string;
  params?: string;
  idempotency_key?: string;
  status?: MutationStatus;
  result?: string;
  error?: string;
  reconcile_attempts?: number;
  last_reconcile_at?: number;
  next_reconcile_at?: number;
  resolved_by?: MutationResolution | "";
  resolved_at?: number;
}

/**
 * Store for managing mutations in the execution model.
 *
 * Mutations track external side effects for crash recovery and reconciliation.
 * Each handler run can have at most one mutation (1:1 relationship).
 */
export class MutationStore {
  private db: KeepDb;

  constructor(db: KeepDb) {
    this.db = db;
  }

  /**
   * Get a mutation by ID.
   *
   * @internal Execution-model primitive. Use ExecutionModelManager for state transitions.
   */
  async get(id: string, tx?: DBInterface): Promise<Mutation | null> {
    const db = tx || this.db.db;
    const results = await db.execO<Record<string, unknown>>(
      `SELECT * FROM mutations WHERE id = ?`,
      [id]
    );

    if (!results || results.length === 0) {
      return null;
    }

    return this.mapRowToMutation(results[0]);
  }

  /**
   * Get a mutation by handler run ID.
   *
   * @internal Execution-model primitive. Use ExecutionModelManager for state transitions.
   */
  async getByHandlerRunId(
    handlerRunId: string,
    tx?: DBInterface
  ): Promise<Mutation | null> {
    const db = tx || this.db.db;
    const results = await db.execO<Record<string, unknown>>(
      `SELECT * FROM mutations WHERE handler_run_id = ?`,
      [handlerRunId]
    );

    if (!results || results.length === 0) {
      return null;
    }

    return this.mapRowToMutation(results[0]);
  }

  /**
   * Create a new mutation record.
   * Must be called BEFORE executing external call for crash detection.
   * Each handler run can have at most one mutation (1:1 relationship).
   */
  async create(input: CreateMutationInput, tx?: DBInterface): Promise<Mutation> {
    if (!tx) {
      return this.db.db.tx((tx) => this.create(input, tx));
    }
    const db = tx;

    // Check uniqueness: one mutation per handler_run_id
    const existing = await this.getByHandlerRunId(input.handler_run_id, db);
    if (existing) {
      throw new Error(`Mutation already exists for handler run ${input.handler_run_id}`);
    }

    const id = bytesToHex(randomBytes(16));
    const now = Date.now();
    const uiTitle = input.ui_title || "";

    await db.exec(
      `INSERT INTO mutations (
        id, handler_run_id, workflow_id, tool_namespace, tool_method,
        params, idempotency_key, status, result, error,
        reconcile_attempts, last_reconcile_at, next_reconcile_at,
        resolved_by, resolved_at, ui_title, created_at, updated_at
      ) VALUES (?, ?, ?, '', '', '', '', 'pending', '', '', 0, 0, 0, '', 0, ?, ?, ?)`,
      [id, input.handler_run_id, input.workflow_id, uiTitle, now, now]
    );

    return {
      id,
      handler_run_id: input.handler_run_id,
      workflow_id: input.workflow_id,
      tool_namespace: "",
      tool_method: "",
      params: "",
      idempotency_key: "",
      status: "pending",
      result: "",
      error: "",
      reconcile_attempts: 0,
      last_reconcile_at: 0,
      next_reconcile_at: 0,
      resolved_by: "",
      resolved_at: 0,
      ui_title: uiTitle,
      created_at: now,
      updated_at: now,
    };
  }

  /**
   * Create a mutation directly in in_flight status with tool info.
   * Skips the "pending" state — used when the tool-wrapper intercepts a mutation tool call.
   * Each handler run can have at most one mutation (1:1 relationship).
   */
  async createInFlight(input: CreateInFlightInput, tx?: DBInterface): Promise<Mutation> {
    if (!tx) {
      return this.db.db.tx((tx) => this.createInFlight(input, tx));
    }
    const db = tx;

    // Check uniqueness: one mutation per handler_run_id
    const existing = await this.getByHandlerRunId(input.handler_run_id, db);
    if (existing) {
      throw new Error(`Mutation already exists for handler run ${input.handler_run_id}`);
    }

    const id = bytesToHex(randomBytes(16));
    const now = Date.now();
    const uiTitle = input.ui_title || "";

    await db.exec(
      `INSERT INTO mutations (
        id, handler_run_id, workflow_id, tool_namespace, tool_method,
        params, idempotency_key, status, result, error,
        reconcile_attempts, last_reconcile_at, next_reconcile_at,
        resolved_by, resolved_at, ui_title, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'in_flight', '', '', 0, 0, 0, '', 0, ?, ?, ?)`,
      [
        id, input.handler_run_id, input.workflow_id,
        input.tool_namespace, input.tool_method,
        input.params, input.idempotency_key || "",
        uiTitle, now, now,
      ]
    );

    return {
      id,
      handler_run_id: input.handler_run_id,
      workflow_id: input.workflow_id,
      tool_namespace: input.tool_namespace,
      tool_method: input.tool_method,
      params: input.params,
      idempotency_key: input.idempotency_key || "",
      status: "in_flight",
      result: "",
      error: "",
      reconcile_attempts: 0,
      last_reconcile_at: 0,
      next_reconcile_at: 0,
      resolved_by: "",
      resolved_at: 0,
      ui_title: uiTitle,
      created_at: now,
      updated_at: now,
    };
  }

  /**
   * Update a mutation.
   *
   * @internal Execution-model primitive. Use ExecutionModelManager for state transitions.
   */
  async update(
    id: string,
    input: UpdateMutationInput,
    tx?: DBInterface
  ): Promise<void> {
    const db = tx || this.db.db;
    const now = Date.now();

    const updates: string[] = ["updated_at = ?"];
    const params: unknown[] = [now];

    if (input.tool_namespace !== undefined) {
      updates.push("tool_namespace = ?");
      params.push(input.tool_namespace);
    }
    if (input.tool_method !== undefined) {
      updates.push("tool_method = ?");
      params.push(input.tool_method);
    }
    if (input.params !== undefined) {
      updates.push("params = ?");
      params.push(input.params);
    }
    if (input.idempotency_key !== undefined) {
      updates.push("idempotency_key = ?");
      params.push(input.idempotency_key);
    }
    if (input.status !== undefined) {
      updates.push("status = ?");
      params.push(input.status);
    }
    if (input.result !== undefined) {
      updates.push("result = ?");
      params.push(input.result);
    }
    if (input.error !== undefined) {
      updates.push("error = ?");
      params.push(input.error);
    }
    if (input.reconcile_attempts !== undefined) {
      updates.push("reconcile_attempts = ?");
      params.push(input.reconcile_attempts);
    }
    if (input.last_reconcile_at !== undefined) {
      updates.push("last_reconcile_at = ?");
      params.push(input.last_reconcile_at);
    }
    if (input.next_reconcile_at !== undefined) {
      updates.push("next_reconcile_at = ?");
      params.push(input.next_reconcile_at);
    }
    if (input.resolved_by !== undefined) {
      updates.push("resolved_by = ?");
      params.push(input.resolved_by);
    }
    if (input.resolved_at !== undefined) {
      updates.push("resolved_at = ?");
      params.push(input.resolved_at);
    }

    params.push(id);
    await db.exec(
      `UPDATE mutations SET ${updates.join(", ")} WHERE id = ?`,
      params
    );
  }

  /**
   * Mark mutation as in_flight (about to execute external call).
   */
  async markInFlight(
    id: string,
    toolInfo: {
      tool_namespace: string;
      tool_method: string;
      params: string;
      idempotency_key?: string;
    },
    tx?: DBInterface
  ): Promise<void> {
    await this.update(
      id,
      {
        status: "in_flight",
        tool_namespace: toolInfo.tool_namespace,
        tool_method: toolInfo.tool_method,
        params: toolInfo.params,
        idempotency_key: toolInfo.idempotency_key || "",
      },
      tx
    );
  }

  /**
   * Mark mutation as applied with result.
   */
  async markApplied(id: string, result: string, tx?: DBInterface): Promise<void> {
    await this.update(id, { status: "applied", result }, tx);
  }

  /**
   * Mark mutation as failed with error.
   */
  async markFailed(id: string, error: string, tx?: DBInterface): Promise<void> {
    await this.update(id, { status: "failed", error }, tx);
  }

  /**
   * Mark mutation as indeterminate (crashed during external call).
   */
  async markIndeterminate(
    id: string,
    error: string,
    tx?: DBInterface
  ): Promise<void> {
    await this.update(id, { status: "indeterminate", error }, tx);
  }

  /**
   * Mark mutation as needs_reconcile (uncertain outcome, will retry).
   * Per docs/dev/13-reconciliation.md §13.7.2.
   */
  async markNeedsReconcile(
    id: string,
    error: string,
    tx?: DBInterface
  ): Promise<void> {
    const now = Date.now();
    await this.update(
      id,
      {
        status: "needs_reconcile",
        error,
        last_reconcile_at: now,
        // Schedule first reconciliation attempt immediately (scheduler will pick up)
        next_reconcile_at: now,
      },
      tx
    );
  }

  /**
   * Get mutations due for reconciliation.
   * Per docs/dev/13-reconciliation.md §13.7.4.
   */
  async getDueForReconciliation(tx?: DBInterface): Promise<Mutation[]> {
    const db = tx || this.db.db;
    const now = Date.now();
    const results = await db.execO<Record<string, unknown>>(
      `SELECT * FROM mutations
       WHERE status = 'needs_reconcile'
       AND next_reconcile_at <= ?
       ORDER BY next_reconcile_at ASC`,
      [now]
    );

    if (!results) return [];
    return results.map((row) => this.mapRowToMutation(row));
  }

  /**
   * Increment reconcile attempts and schedule next attempt.
   * Per docs/dev/13-reconciliation.md §13.7.4.
   *
   * @param id - Mutation ID
   * @param nextAttemptDelayMs - Delay before next attempt (for exponential backoff)
   */
  async scheduleNextReconcile(
    id: string,
    nextAttemptDelayMs: number,
    tx?: DBInterface
  ): Promise<void> {
    const now = Date.now();
    const db = tx || this.db.db;

    // Atomically increment attempts and schedule next
    await db.exec(
      `UPDATE mutations SET
        reconcile_attempts = reconcile_attempts + 1,
        last_reconcile_at = ?,
        next_reconcile_at = ?,
        updated_at = ?
       WHERE id = ?`,
      [now, now + nextAttemptDelayMs, now, id]
    );
  }

  /**
   * Get mutations in needs_reconcile state for a workflow.
   */
  async getNeedsReconcile(
    workflowId?: string,
    tx?: DBInterface
  ): Promise<Mutation[]> {
    const db = tx || this.db.db;
    let query = `SELECT * FROM mutations WHERE status = 'needs_reconcile'`;
    const params: unknown[] = [];

    if (workflowId) {
      query += ` AND workflow_id = ?`;
      params.push(workflowId);
    }

    query += ` ORDER BY next_reconcile_at ASC`;

    const results = await db.execO<Record<string, unknown>>(query, params);
    if (!results) return [];
    return results.map((row) => this.mapRowToMutation(row));
  }

  /**
   * Resolve an indeterminate mutation.
   */
  async resolve(
    id: string,
    resolution: MutationResolution,
    tx?: DBInterface
  ): Promise<void> {
    await this.update(
      id,
      {
        resolved_by: resolution,
        resolved_at: Date.now(),
      },
      tx
    );
  }

  /**
   * Get mutations by workflow.
   */
  async getByWorkflow(
    workflowId: string,
    options: { status?: MutationStatus; limit?: number } = {},
    tx?: DBInterface
  ): Promise<Mutation[]> {
    const db = tx || this.db.db;
    let query = `SELECT * FROM mutations WHERE workflow_id = ?`;
    const params: unknown[] = [workflowId];

    if (options.status) {
      query += ` AND status = ?`;
      params.push(options.status);
    }

    query += ` ORDER BY created_at DESC`;

    if (options.limit) {
      query += ` LIMIT ?`;
      params.push(options.limit);
    }

    const results = await db.execO<Record<string, unknown>>(query, params);
    if (!results) return [];
    return results.map((row) => this.mapRowToMutation(row));
  }

  /**
   * Get indeterminate mutations that need resolution.
   */
  async getIndeterminate(tx?: DBInterface): Promise<Mutation[]> {
    const db = tx || this.db.db;
    const results = await db.execO<Record<string, unknown>>(
      `SELECT * FROM mutations
       WHERE status = 'indeterminate' AND resolved_by = ''
       ORDER BY created_at`
    );

    if (!results) return [];
    return results.map((row) => this.mapRowToMutation(row));
  }

  /**
   * Get mutations caused by an input (exec-16).
   *
   * Traces from input → events (via caused_by) → handler_runs → mutations.
   * Returns mutations that resulted from processing events that reference this input.
   *
   * @param inputId - Input ID to trace
   * @param options - Query options (status filter, limit)
   * @returns Mutations caused by this input
   */
  async getByInputId(
    inputId: string,
    options: { status?: MutationStatus[]; limit?: number } = {},
    tx?: DBInterface
  ): Promise<Mutation[]> {
    const db = tx || this.db.db;

    let query = `
      SELECT DISTINCT m.*
      FROM mutations m
      JOIN events e ON e.reserved_by_run_id = m.handler_run_id
      WHERE (e.caused_by LIKE '%"' || ? || '"%')
    `;
    const params: unknown[] = [inputId];

    if (options.status && options.status.length > 0) {
      const placeholders = options.status.map(() => "?").join(", ");
      query += ` AND m.status IN (${placeholders})`;
      params.push(...options.status);
    }

    query += ` ORDER BY m.created_at DESC`;

    if (options.limit) {
      query += ` LIMIT ?`;
      params.push(options.limit);
    }

    const results = await db.execO<Record<string, unknown>>(query, params);
    if (!results) return [];
    return results.map((row) => this.mapRowToMutation(row));
  }

  /**
   * Get aggregated output statistics by connector for a workflow (exec-16).
   *
   * Groups mutations by tool_namespace (connector) and counts by status.
   */
  async getOutputStatsByWorkflow(
    workflowId: string,
    tx?: DBInterface
  ): Promise<Array<{
    tool_namespace: string;
    applied_count: number;
    failed_count: number;
    indeterminate_count: number;
    total_count: number;
  }>> {
    const db = tx || this.db.db;

    const query = `
      SELECT
        tool_namespace,
        SUM(CASE WHEN status = 'applied' THEN 1 ELSE 0 END) as applied_count,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed_count,
        SUM(CASE WHEN status = 'indeterminate' THEN 1 ELSE 0 END) as indeterminate_count,
        COUNT(*) as total_count
      FROM mutations
      WHERE workflow_id = ?
      AND tool_namespace != ''
      GROUP BY tool_namespace
      ORDER BY total_count DESC
    `;

    const results = await db.execO<Record<string, unknown>>(query, [workflowId]);
    if (!results) return [];

    return results.map((row) => ({
      tool_namespace: row.tool_namespace as string,
      applied_count: row.applied_count as number,
      failed_count: row.failed_count as number,
      indeterminate_count: row.indeterminate_count as number,
      total_count: row.total_count as number,
    }));
  }

  /**
   * Delete mutation by handler run ID.
   */
  async deleteByHandlerRun(
    handlerRunId: string,
    tx?: DBInterface
  ): Promise<void> {
    const db = tx || this.db.db;
    await db.exec(`DELETE FROM mutations WHERE handler_run_id = ?`, [
      handlerRunId,
    ]);
  }

  /**
   * Delete mutations by workflow.
   */
  async deleteByWorkflow(workflowId: string, tx?: DBInterface): Promise<void> {
    const db = tx || this.db.db;
    await db.exec(`DELETE FROM mutations WHERE workflow_id = ?`, [workflowId]);
  }

  /**
   * Map a database row to a Mutation object.
   */
  private mapRowToMutation(row: Record<string, unknown>): Mutation {
    return {
      id: row.id as string,
      handler_run_id: row.handler_run_id as string,
      workflow_id: row.workflow_id as string,
      tool_namespace: row.tool_namespace as string,
      tool_method: row.tool_method as string,
      params: row.params as string,
      idempotency_key: row.idempotency_key as string,
      status: row.status as MutationStatus,
      result: row.result as string,
      error: row.error as string,
      reconcile_attempts: row.reconcile_attempts as number,
      last_reconcile_at: row.last_reconcile_at as number,
      next_reconcile_at: row.next_reconcile_at as number,
      resolved_by: row.resolved_by as MutationResolution | "",
      resolved_at: row.resolved_at as number,
      ui_title: (row.ui_title as string) || "",
      created_at: row.created_at as number,
      updated_at: row.updated_at as number,
    };
  }
}
