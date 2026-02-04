import { DBInterface } from "../interfaces";

/**
 * Migration v42: Add wake_at Column to handler_state
 *
 * Per exec-11 spec: Implement per-consumer wakeAt scheduling.
 *
 * Each consumer can specify a wakeAt time in their PrepareResult:
 * - Stored per-consumer in handler_state table
 * - Scheduler checks wakeAt when finding runnable consumers
 * - Enables time-based scheduling without event triggers
 *
 * Examples:
 * - Daily digest consumer: wakeAt = "2024-01-16T09:00:00Z"
 * - Batch timeout consumer: wakeAt = "2024-01-15T14:00:00Z"
 *
 * Host enforces constraints on wakeAt (30s min, 24h max from now).
 *
 * See specs/exec-11-scheduler-state.md for design details.
 */
export async function migrateV42(
  tx: DBInterface["tx"] extends (fn: (tx: infer T) => any) => any ? T : never
) {
  // VERSION: 42
  await tx.exec(`PRAGMA user_version = 42`);

  // =========================================
  // ADD wake_at COLUMN TO handler_state
  // =========================================

  // handler_state is a CRR table, must use crsql_begin_alter/crsql_commit_alter
  await tx.exec("SELECT crsql_begin_alter('handler_state')");

  // Add wake_at column - stores Unix timestamp (milliseconds) for next wake time
  // NULL means no scheduled wake (only triggered by events)
  // Note: Using INTEGER (not TEXT) for efficient comparisons
  // Default 0 means no wake_at set (NULL would require special handling in CRR)
  await tx.exec(
    `ALTER TABLE handler_state ADD COLUMN wake_at INTEGER NOT NULL DEFAULT 0`
  );

  await tx.exec("SELECT crsql_commit_alter('handler_state')");

  // Create index for efficient wakeAt queries
  // Enables: "find consumers where wake_at <= now AND wake_at > 0"
  await tx.exec(
    `CREATE INDEX IF NOT EXISTS idx_handler_state_wake_at ON handler_state(wake_at)`
  );
}
