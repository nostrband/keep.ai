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
 * - needs_reconcile: Needs reconciliation (future use)
 * - indeterminate: Uncertain outcome (crash during external call)
 */
export type MutationStatus =
  | "pending"
  | "in_flight"
  | "applied"
  | "failed"
  | "needs_reconcile"
  | "indeterminate";

/**
 * User resolution for indeterminate mutations.
 */
export type MutationResolution =
  | "user_skip"
  | "user_retry"
  | "user_assert_failed";

/**
 * Mutation record - ledger for tracking external side effects.
 */
export interface Mutation {
  id: string;
  handler_run_id: string;
  workflow_id: string;
  tool_namespace: string;
  tool_method: string;
  params: string; // JSON
  idempotency_key: string;
  status: MutationStatus;
  result: string; // JSON
  error: string;
  reconcile_attempts: number;
  last_reconcile_at: number;
  next_reconcile_at: number;
  resolved_by: MutationResolution | "";
  resolved_at: number;
  created_at: number;
  updated_at: number;
}

/**
 * Input for creating a new mutation.
 */
export interface CreateMutationInput {
  handler_run_id: string;
  workflow_id: string;
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
   */
  async create(input: CreateMutationInput, tx?: DBInterface): Promise<Mutation> {
    const db = tx || this.db.db;
    const id = bytesToHex(randomBytes(16));
    const now = Date.now();

    await db.exec(
      `INSERT INTO mutations (
        id, handler_run_id, workflow_id, tool_namespace, tool_method,
        params, idempotency_key, status, result, error,
        reconcile_attempts, last_reconcile_at, next_reconcile_at,
        resolved_by, resolved_at, created_at, updated_at
      ) VALUES (?, ?, ?, '', '', '', '', 'pending', '', '', 0, 0, 0, '', 0, ?, ?)`,
      [id, input.handler_run_id, input.workflow_id, now, now]
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
      created_at: now,
      updated_at: now,
    };
  }

  /**
   * Update a mutation.
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
      created_at: row.created_at as number,
      updated_at: row.updated_at as number,
    };
  }
}
