import { DBInterface } from "../interfaces";

/**
 * Migration v40: Migrate handler_runs Status Data
 *
 * Per exec-09 spec: Migrate existing phase values to status.
 *
 * This is split from v39 because CRR table writes cannot be in
 * the same transaction as ALTER TABLE operations.
 *
 * Migration rules:
 * - phase='committed' -> status='committed'
 * - phase='failed' -> status='failed:logic'
 * - phase='suspended' -> status='paused:reconciliation'
 * - All other phases (active runs) -> status='active' (already default)
 *
 * After migration, 'failed' and 'suspended' are no longer valid phase values.
 * The state machine will set status instead of changing phase.
 */
export async function migrateV40(
  tx: DBInterface["tx"] extends (fn: (tx: infer T) => any) => any ? T : never
) {
  // VERSION: 40
  await tx.exec(`PRAGMA user_version = 40`);

  // =========================================
  // MIGRATE EXISTING DATA
  // =========================================

  // Committed runs: phase='committed' -> status='committed'
  await tx.exec(`
    UPDATE handler_runs
    SET status = 'committed'
    WHERE phase = 'committed'
  `);

  // Failed runs: phase='failed' -> status='failed:logic'
  // We keep the phase as 'failed' for now for backwards compatibility,
  // but new code will use status for terminal detection
  await tx.exec(`
    UPDATE handler_runs
    SET status = 'failed:logic'
    WHERE phase = 'failed'
  `);

  // Suspended runs: phase='suspended' -> status='paused:reconciliation'
  // These were indeterminate mutations waiting for user resolution
  await tx.exec(`
    UPDATE handler_runs
    SET status = 'paused:reconciliation'
    WHERE phase = 'suspended'
  `);

  // All other runs should already have status='active' from default
}
