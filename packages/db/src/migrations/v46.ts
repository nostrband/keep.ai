import { DBInterface } from "../interfaces";

/**
 * Migration v46: Unified Retry Recovery
 *
 * Adds pending_retry_run_id to workflows table. When set, the scheduler
 * creates a targeted retry session via retryWorkflowSession() with correct
 * phase-reset rules. Used by all recovery paths: crash, transient, fix.
 *
 * See specs/new/fix-retries.md for design details.
 */
export async function migrateV46(
  tx: DBInterface["tx"] extends (fn: (tx: infer T) => any) => any ? T : never
) {
  // VERSION: 46
  await tx.exec(`PRAGMA user_version = 46`);

  // =========================================
  // ALTER workflows TABLE - Add pending_retry_run_id column
  // =========================================

  await tx.exec("SELECT crsql_begin_alter('workflows')");

  await tx.exec(`
    ALTER TABLE workflows ADD COLUMN pending_retry_run_id TEXT NOT NULL DEFAULT ''
  `);

  await tx.exec("SELECT crsql_commit_alter('workflows')");
}
