import { bytesToHex } from "@noble/ciphers/utils";
import { randomBytes } from "@noble/ciphers/crypto";
import { KeepDb } from "./database";
import { DBInterface } from "./interfaces";

/**
 * Item status for the logical items system.
 * - processing: Handler is executing
 * - done: Handler completed successfully
 * - failed: Handler threw an error
 * - skipped: User explicitly skipped (manual action)
 *
 * @deprecated This type is part of the deprecated Items infrastructure (exec-02).
 * Use the new Topics-based event-driven execution model instead.
 */
export type ItemStatus = 'processing' | 'done' | 'failed' | 'skipped';

/**
 * Who created the item (for tracking purposes).
 *
 * @deprecated This type is part of the deprecated Items infrastructure (exec-02).
 */
export type ItemCreatedBy = 'workflow' | 'planner' | 'maintainer';

/**
 * Logical item record in the database.
 *
 * @deprecated This interface is part of the deprecated Items infrastructure (exec-02).
 */
export interface Item {
  id: string;
  workflow_id: string;
  logical_item_id: string;
  title: string;
  status: ItemStatus;
  current_attempt_id: number;
  created_by: ItemCreatedBy;
  created_by_run_id: string;
  last_run_id: string;
  created_at: number;
  updated_at: number;
}

/**
 * Options for listing items.
 *
 * @deprecated This interface is part of the deprecated Items infrastructure (exec-02).
 */
export interface ListItemsOptions {
  /** Filter by item status */
  status?: ItemStatus;
  /** Maximum number of items to return */
  limit?: number;
  /** Number of items to skip */
  offset?: number;
}

/**
 * Store for managing logical items in workflows.
 *
 * @deprecated This class is part of the deprecated Items infrastructure (exec-02).
 * The items table is kept for data preservation, but ItemStore should not be used
 * for new code. Use the new Topics-based event-driven execution model instead.
 *
 * See specs/exec-02-deprecate-items.md for details.
 */
export class ItemStore {
  private db: KeepDb;

  constructor(db: KeepDb) {
    this.db = db;
  }

  /**
   * Get an item by workflow ID and logical item ID.
   */
  async getItem(
    workflowId: string,
    logicalItemId: string,
    tx?: DBInterface
  ): Promise<Item | null> {
    const db = tx || this.db.db;
    const results = await db.execO<Record<string, unknown>>(
      `SELECT * FROM items WHERE workflow_id = ? AND logical_item_id = ?`,
      [workflowId, logicalItemId]
    );

    if (!results || results.length === 0) {
      return null;
    }

    return this.mapRowToItem(results[0]);
  }

  /**
   * Get or create an item, setting status to 'processing'.
   *
   * Behavior:
   * - If item exists and is 'done', returns it unchanged (for isDone check)
   * - If item exists and is 'failed' or 'skipped', resets to 'processing' for retry
   * - If item doesn't exist, creates a new one with 'processing' status
   *
   * @returns The item record (with isDone = item.status === 'done')
   */
  async startItem(
    workflowId: string,
    logicalItemId: string,
    title: string,
    createdBy: ItemCreatedBy,
    runId: string,
    tx?: DBInterface
  ): Promise<Item> {
    const db = tx || this.db.db;
    const now = Date.now();

    // Check if item exists
    const existing = await this.getItem(workflowId, logicalItemId, db);

    if (existing) {
      // If done, return as-is (caller checks isDone)
      if (existing.status === 'done') {
        return existing;
      }

      // If failed/skipped/processing, reset to processing (retry)
      await db.exec(
        `UPDATE items SET
          status = 'processing',
          title = ?,
          last_run_id = ?,
          updated_at = ?
        WHERE workflow_id = ? AND logical_item_id = ?`,
        [title, runId, now, workflowId, logicalItemId]
      );

      return {
        ...existing,
        status: 'processing',
        title,
        last_run_id: runId,
        updated_at: now,
      };
    }

    // Create new item
    const id = bytesToHex(randomBytes(16));
    await db.exec(
      `INSERT INTO items (
        id, workflow_id, logical_item_id, title, status,
        current_attempt_id, created_by, created_by_run_id, last_run_id,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'processing', 1, ?, ?, ?, ?, ?)`,
      [id, workflowId, logicalItemId, title, createdBy, runId, runId, now, now]
    );

    return {
      id,
      workflow_id: workflowId,
      logical_item_id: logicalItemId,
      title,
      status: 'processing',
      current_attempt_id: 1,
      created_by: createdBy,
      created_by_run_id: runId,
      last_run_id: runId,
      created_at: now,
      updated_at: now,
    };
  }

  /**
   * Update item status.
   */
  async setStatus(
    workflowId: string,
    logicalItemId: string,
    status: ItemStatus,
    runId: string,
    tx?: DBInterface
  ): Promise<void> {
    const db = tx || this.db.db;
    const now = Date.now();
    await db.exec(
      `UPDATE items SET status = ?, last_run_id = ?, updated_at = ?
       WHERE workflow_id = ? AND logical_item_id = ?`,
      [status, runId, now, workflowId, logicalItemId]
    );
  }

  /**
   * List items for a workflow with optional filtering and pagination.
   */
  async listItems(
    workflowId: string,
    options: ListItemsOptions = {},
    tx?: DBInterface
  ): Promise<Item[]> {
    const db = tx || this.db.db;
    let query = `SELECT * FROM items WHERE workflow_id = ?`;
    const params: unknown[] = [workflowId];

    if (options.status) {
      query += ` AND status = ?`;
      params.push(options.status);
    }

    query += ` ORDER BY created_at DESC`;

    if (options.limit) {
      query += ` LIMIT ?`;
      params.push(options.limit);
      if (options.offset) {
        query += ` OFFSET ?`;
        params.push(options.offset);
      }
    }

    const results = await db.execO<Record<string, unknown>>(query, params);
    if (!results) return [];

    return results.map(row => this.mapRowToItem(row));
  }

  /**
   * Count items by status for a workflow.
   * Returns a record with counts for each status.
   */
  async countByStatus(
    workflowId: string,
    tx?: DBInterface
  ): Promise<Record<ItemStatus, number>> {
    const db = tx || this.db.db;
    const results = await db.execO<{ status: ItemStatus; count: number }>(
      `SELECT status, COUNT(*) as count FROM items
       WHERE workflow_id = ? GROUP BY status`,
      [workflowId]
    );

    const result: Record<ItemStatus, number> = {
      processing: 0,
      done: 0,
      failed: 0,
      skipped: 0,
    };

    if (results) {
      for (const row of results) {
        result[row.status] = row.count;
      }
    }

    return result;
  }

  /**
   * Map a database row to an Item object.
   */
  private mapRowToItem(row: Record<string, unknown>): Item {
    return {
      id: row.id as string,
      workflow_id: row.workflow_id as string,
      logical_item_id: row.logical_item_id as string,
      title: row.title as string,
      status: row.status as ItemStatus,
      current_attempt_id: row.current_attempt_id as number,
      created_by: row.created_by as ItemCreatedBy,
      created_by_run_id: row.created_by_run_id as string,
      last_run_id: row.last_run_id as string,
      created_at: row.created_at as number,
      updated_at: row.updated_at as number,
    };
  }
}
