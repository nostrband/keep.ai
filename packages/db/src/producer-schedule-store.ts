import { bytesToHex } from "@noble/ciphers/utils";
import { randomBytes } from "@noble/ciphers/crypto";
import { KeepDb } from "./database";
import { DBInterface } from "./interfaces";

/**
 * Producer schedule types.
 */
export type ScheduleType = "interval" | "cron";

/**
 * Producer schedule record.
 */
export interface ProducerSchedule {
  id: string;
  workflow_id: string;
  producer_name: string;
  schedule_type: ScheduleType;
  schedule_value: string;
  next_run_at: number;
  last_run_at: number;
  created_at: number;
  updated_at: number;
}

/**
 * Input for creating/updating a producer schedule.
 */
export interface ProducerScheduleInput {
  workflow_id: string;
  producer_name: string;
  schedule_type: ScheduleType;
  schedule_value: string;
  next_run_at: number;
}

/**
 * Store for managing per-producer schedules.
 *
 * Per exec-13 spec: Each producer has its own schedule that runs independently.
 * This replaces the per-workflow next_run_timestamp which had wrong granularity.
 */
export class ProducerScheduleStore {
  private db: KeepDb;

  constructor(db: KeepDb) {
    this.db = db;
  }

  /**
   * Get a producer schedule by workflow ID and producer name.
   */
  async get(
    workflowId: string,
    producerName: string,
    tx?: DBInterface
  ): Promise<ProducerSchedule | null> {
    const db = tx || this.db.db;
    const results = await db.execO<Record<string, unknown>>(
      `SELECT * FROM producer_schedules WHERE workflow_id = ? AND producer_name = ?`,
      [workflowId, producerName]
    );

    if (!results || results.length === 0) {
      return null;
    }

    return this.mapRowToSchedule(results[0]);
  }

  /**
   * Get all schedules for a workflow.
   * Ordered by next_run_at for priority scheduling.
   */
  async getForWorkflow(
    workflowId: string,
    tx?: DBInterface
  ): Promise<ProducerSchedule[]> {
    const db = tx || this.db.db;
    const results = await db.execO<Record<string, unknown>>(
      `SELECT * FROM producer_schedules WHERE workflow_id = ? ORDER BY next_run_at`,
      [workflowId]
    );

    if (!results) return [];
    return results.map((row) => this.mapRowToSchedule(row));
  }

  /**
   * Get producers that are due to run (next_run_at <= now).
   */
  async getDueProducers(
    workflowId: string,
    tx?: DBInterface
  ): Promise<ProducerSchedule[]> {
    const db = tx || this.db.db;
    const now = Date.now();

    const results = await db.execO<Record<string, unknown>>(
      `SELECT * FROM producer_schedules WHERE workflow_id = ? AND next_run_at <= ?`,
      [workflowId, now]
    );

    if (!results) return [];
    return results.map((row) => this.mapRowToSchedule(row));
  }

  /**
   * Get the next scheduled time across all producers for a workflow.
   * Returns null if no schedules exist.
   */
  async getNextScheduledTime(
    workflowId: string,
    tx?: DBInterface
  ): Promise<number | null> {
    const db = tx || this.db.db;

    const results = await db.execO<{ next: number | null }>(
      `SELECT MIN(next_run_at) as next FROM producer_schedules WHERE workflow_id = ?`,
      [workflowId]
    );

    if (!results || results.length === 0) return null;
    return results[0].next ?? null;
  }

  /**
   * Create or update a producer schedule (upsert).
   */
  async upsert(input: ProducerScheduleInput, tx?: DBInterface): Promise<void> {
    if (!tx) {
      return this.db.db.tx((tx) => this.upsert(input, tx));
    }
    const db = tx;
    const now = Date.now();

    // Check if exists
    const existing = await this.get(input.workflow_id, input.producer_name, db);

    if (existing) {
      // Update schedule config and next_run_at
      await db.exec(
        `UPDATE producer_schedules
         SET schedule_type = ?, schedule_value = ?, next_run_at = ?, updated_at = ?
         WHERE workflow_id = ? AND producer_name = ?`,
        [
          input.schedule_type,
          input.schedule_value,
          input.next_run_at,
          now,
          input.workflow_id,
          input.producer_name,
        ]
      );
    } else {
      // Insert new schedule
      const id = bytesToHex(randomBytes(16));
      await db.exec(
        `INSERT INTO producer_schedules (
          id, workflow_id, producer_name, schedule_type, schedule_value,
          next_run_at, last_run_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)`,
        [
          id,
          input.workflow_id,
          input.producer_name,
          input.schedule_type,
          input.schedule_value,
          input.next_run_at,
          now,
          now,
        ]
      );
    }
  }

  /**
   * Update schedule after producer runs.
   * Sets last_run_at to now and next_run_at to the provided value.
   */
  async updateAfterRun(
    workflowId: string,
    producerName: string,
    nextRunAt: number,
    tx?: DBInterface
  ): Promise<void> {
    const db = tx || this.db.db;
    const now = Date.now();

    await db.exec(
      `UPDATE producer_schedules
       SET next_run_at = ?, last_run_at = ?, updated_at = ?
       WHERE workflow_id = ? AND producer_name = ?`,
      [nextRunAt, now, now, workflowId, producerName]
    );
  }

  /**
   * Delete a producer schedule.
   * Used when producer is removed from workflow config.
   */
  async delete(
    workflowId: string,
    producerName: string,
    tx?: DBInterface
  ): Promise<void> {
    const db = tx || this.db.db;
    await db.exec(
      `DELETE FROM producer_schedules WHERE workflow_id = ? AND producer_name = ?`,
      [workflowId, producerName]
    );
  }

  /**
   * Reset all producer schedules for a workflow to run immediately.
   * Sets next_run_at to now for all producers.
   */
  async resetAllNextRunAt(workflowId: string, tx?: DBInterface): Promise<void> {
    const db = tx || this.db.db;
    const now = Date.now();
    await db.exec(
      `UPDATE producer_schedules SET next_run_at = ?, updated_at = ? WHERE workflow_id = ?`,
      [now, now, workflowId]
    );
  }

  /**
   * Delete all schedules for a workflow.
   */
  async deleteByWorkflow(workflowId: string, tx?: DBInterface): Promise<void> {
    const db = tx || this.db.db;
    await db.exec(`DELETE FROM producer_schedules WHERE workflow_id = ?`, [
      workflowId,
    ]);
  }

  /**
   * Map a database row to a ProducerSchedule object.
   */
  private mapRowToSchedule(row: Record<string, unknown>): ProducerSchedule {
    return {
      id: row.id as string,
      workflow_id: row.workflow_id as string,
      producer_name: row.producer_name as string,
      schedule_type: row.schedule_type as ScheduleType,
      schedule_value: row.schedule_value as string,
      next_run_at: row.next_run_at as number,
      last_run_at: row.last_run_at as number,
      created_at: row.created_at as number,
      updated_at: row.updated_at as number,
    };
  }
}
