import { DBInterface } from "../interfaces";

/**
 * Migration v39: Add Status Column to handler_runs
 *
 * Per exec-09 spec: Separate run status from phase.
 *
 * Phase tracks execution progress:
 *   preparing -> prepared -> mutating -> mutated -> emitting -> committed
 *
 * Status tracks why a run is paused/stopped:
 *   active | paused:transient | paused:approval | paused:reconciliation |
 *   failed:logic | failed:internal | committed | crashed
 *
 * This separation allows:
 * - Phase to only move forward (never reset on failure)
 * - Status to indicate why execution stopped
 * - Proper retry semantics (retry from same phase with new status)
 *
 * Data Migration:
 * - All existing runs get status='committed' if phase='committed'
 * - phase='failed' -> status='failed:logic', keep phase value
 * - phase='suspended' -> status='paused:reconciliation', keep phase value
 * - All other active phases -> status='active'
 *
 * Note: per AGENTS.md, CRR table alterations cannot include writes in same tx.
 * This migration only adds the column. Data migration follows.
 */
export async function migrateV39(
  tx: DBInterface["tx"] extends (fn: (tx: infer T) => any) => any ? T : never
) {
  // VERSION: 39
  await tx.exec(`PRAGMA user_version = 39`);

  // =========================================
  // ADD STATUS COLUMN TO handler_runs
  // =========================================

  // handler_runs is a CRR table, must use crsql_begin_alter/crsql_commit_alter
  await tx.exec("SELECT crsql_begin_alter('handler_runs')");

  // Add status column with default 'active' for new runs
  // Existing runs will be migrated in v40
  await tx.exec(
    `ALTER TABLE handler_runs ADD COLUMN status TEXT NOT NULL DEFAULT 'active'`
  );

  await tx.exec("SELECT crsql_commit_alter('handler_runs')");

  // Create index for efficient status queries
  await tx.exec(
    `CREATE INDEX IF NOT EXISTS idx_handler_runs_status ON handler_runs(status)`
  );
}
