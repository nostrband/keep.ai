import { DBInterface } from "../interfaces";

/**
 * Migration v44: Input Ledger, Causal Tracking, and UI Title
 *
 * Per exec-15 spec: Input Ledger, Causal Tracking, and Topic Declarations.
 *
 * This migration adds:
 * 1. `inputs` table - Input Ledger tracking external inputs with user-facing metadata
 * 2. `caused_by` column on `events` - JSON array of input IDs for causal tracking
 * 3. `ui_title` column on `mutations` - User-facing description from prepareResult.ui
 *
 * The Input Ledger stores:
 * - External input metadata (source, type, external_id, title)
 * - Links to the producer run that registered the input
 * - Uniqueness by (workflow_id, source, type, external_id) for idempotent registration
 *
 * Causal tracking allows events to reference their originating inputs,
 * enabling tracing of event chains back to external triggers.
 *
 * See specs/new/exec-15-input-ledger-and-causal-tracking.md for design details.
 */
export async function migrateV44(
  tx: DBInterface["tx"] extends (fn: (tx: infer T) => any) => any ? T : never
) {
  // VERSION: 44
  await tx.exec(`PRAGMA user_version = 44`);

  // =========================================
  // CREATE inputs TABLE (Input Ledger)
  // =========================================

  // Note: cr-sqlite requires all NOT NULL columns in CRR tables to have DEFAULT values
  await tx.exec(`
    CREATE TABLE IF NOT EXISTS inputs (
      id TEXT PRIMARY KEY NOT NULL DEFAULT '',
      workflow_id TEXT NOT NULL DEFAULT '',
      source TEXT NOT NULL DEFAULT '',
      type TEXT NOT NULL DEFAULT '',
      external_id TEXT NOT NULL DEFAULT '',
      title TEXT NOT NULL DEFAULT '',
      created_by_run_id TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL DEFAULT 0
    )
  `);

  // Index for efficient workflow queries
  await tx.exec(
    `CREATE INDEX IF NOT EXISTS idx_inputs_workflow ON inputs(workflow_id)`
  );

  // Register as CRR for sync
  await tx.exec("SELECT crsql_as_crr('inputs')");

  // =========================================
  // ALTER events TABLE - Add caused_by column
  // =========================================

  // Use crsql_begin_alter/crsql_commit_alter for CRR tables
  await tx.exec("SELECT crsql_begin_alter('events')");

  await tx.exec(`
    ALTER TABLE events ADD COLUMN caused_by TEXT NOT NULL DEFAULT '[]'
  `);

  await tx.exec("SELECT crsql_commit_alter('events')");

  // =========================================
  // ALTER mutations TABLE - Add ui_title column
  // =========================================

  // Use crsql_begin_alter/crsql_commit_alter for CRR tables
  await tx.exec("SELECT crsql_begin_alter('mutations')");

  await tx.exec(`
    ALTER TABLE mutations ADD COLUMN ui_title TEXT NOT NULL DEFAULT ''
  `);

  await tx.exec("SELECT crsql_commit_alter('mutations')");
}
