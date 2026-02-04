import { DBInterface } from "../interfaces";

/**
 * Migration v43: Create producer_schedules Table
 *
 * Per exec-13 spec: Implement per-producer scheduling.
 *
 * Each producer can have its own schedule (interval or cron):
 * - Stored per-producer in producer_schedules table
 * - Scheduler checks next_run_at when finding runnable producers
 * - Producers run independently (A's schedule doesn't affect B)
 *
 * Examples:
 * - Producer A: interval '5m' (every 5 minutes)
 * - Producer B: cron '0 9 * * *' (daily at 9am)
 *
 * This replaces the per-workflow next_run_timestamp which was wrong
 * granularity (all producers shared one timestamp).
 *
 * See specs/exec-13-producer-scheduling.md for design details.
 */
export async function migrateV43(
  tx: DBInterface["tx"] extends (fn: (tx: infer T) => any) => any ? T : never
) {
  // VERSION: 43
  await tx.exec(`PRAGMA user_version = 43`);

  // =========================================
  // CREATE producer_schedules TABLE
  // =========================================

  await tx.exec(`
    CREATE TABLE IF NOT EXISTS producer_schedules (
      id TEXT PRIMARY KEY NOT NULL DEFAULT '',
      workflow_id TEXT NOT NULL DEFAULT '',
      producer_name TEXT NOT NULL DEFAULT '',
      schedule_type TEXT NOT NULL DEFAULT '',
      schedule_value TEXT NOT NULL DEFAULT '',
      next_run_at INTEGER NOT NULL DEFAULT 0,
      last_run_at INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL DEFAULT 0,
      UNIQUE(workflow_id, producer_name)
    )
  `);

  // Create indexes for efficient queries
  await tx.exec(
    `CREATE INDEX IF NOT EXISTS idx_producer_schedules_workflow ON producer_schedules(workflow_id)`
  );
  await tx.exec(
    `CREATE INDEX IF NOT EXISTS idx_producer_schedules_next_run ON producer_schedules(next_run_at)`
  );

  // Register as CRR for sync
  await tx.exec("SELECT crsql_as_crr('producer_schedules')");
}
