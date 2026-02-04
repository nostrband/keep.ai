import { DBInterface } from "../interfaces";

/**
 * Migration v41: Add retry_of Column to handler_runs
 *
 * Per exec-10 spec: Implement retry chain tracking.
 *
 * Each retry attempt is a separate run record linked via `retry_of`:
 * - `retry_of` points to the previous attempt's handler_run.id
 * - NULL/empty for first attempts
 * - Allows tracking full retry history
 *
 * This enables:
 * - Full observability of retry attempts
 * - Phase reset rules (before mutation = fresh start, after mutation = continue from emitting)
 * - Crash recovery with proper retry linking
 *
 * See specs/exec-10-retry-chain.md for design details.
 */
export async function migrateV41(
  tx: DBInterface["tx"] extends (fn: (tx: infer T) => any) => any ? T : never
) {
  // VERSION: 41
  await tx.exec(`PRAGMA user_version = 41`);

  // =========================================
  // ADD retry_of COLUMN TO handler_runs
  // =========================================

  // handler_runs is a CRR table, must use crsql_begin_alter/crsql_commit_alter
  await tx.exec("SELECT crsql_begin_alter('handler_runs')");

  // Add retry_of column - links to previous attempt's handler_run.id
  // Empty string (DEFAULT '') for first attempts, non-empty for retries
  // Note: CRSQLite requires NOT NULL with DEFAULT for CRR tables
  await tx.exec(
    `ALTER TABLE handler_runs ADD COLUMN retry_of TEXT NOT NULL DEFAULT ''`
  );

  await tx.exec("SELECT crsql_commit_alter('handler_runs')");

  // Create index for efficient retry chain queries
  // This enables fast lookups of:
  // - All retries for a given original run
  // - Finding the latest attempt in a chain
  await tx.exec(
    `CREATE INDEX IF NOT EXISTS idx_handler_runs_retry_of ON handler_runs(retry_of)`
  );
}
