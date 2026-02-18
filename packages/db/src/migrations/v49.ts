import { DBInterface } from "../interfaces";

/**
 * Migration v49: Backfill handler_runs.mutation_outcome from existing mutations.
 *
 * For handler runs that already have terminal mutations, set mutation_outcome
 * to match the mutation's resolved state:
 *
 * - mutation.status = 'applied' → mutation_outcome = 'success'
 * - mutation.status = 'failed' → mutation_outcome = 'failure'
 * - mutation.status = 'indeterminate' AND resolved_by = 'user_assert_applied' → 'success'
 * - mutation.status = 'indeterminate' AND resolved_by IN ('user_assert_failed', 'user_retry') → 'failure'
 * - mutation.status = 'indeterminate' AND resolved_by = 'user_skip' → 'skipped'
 * - All other statuses (pending, in_flight, needs_reconcile, unresolved indeterminate) → '' (unchanged)
 */
export async function migrateV49(
  tx: DBInterface["tx"] extends (fn: (tx: infer T) => any) => any ? T : never
) {
  // VERSION: 49
  await tx.exec(`PRAGMA user_version = 49`);

  // =========================================
  // Backfill mutation_outcome for applied mutations
  // =========================================

  await tx.exec(`
    UPDATE handler_runs
    SET mutation_outcome = 'success'
    WHERE id IN (
      SELECT handler_run_id FROM mutations WHERE status = 'applied'
    )
    AND mutation_outcome = ''
  `);

  // =========================================
  // Backfill mutation_outcome for failed mutations
  // =========================================

  await tx.exec(`
    UPDATE handler_runs
    SET mutation_outcome = 'failure'
    WHERE id IN (
      SELECT handler_run_id FROM mutations WHERE status = 'failed'
    )
    AND mutation_outcome = ''
  `);

  // =========================================
  // Backfill mutation_outcome for resolved indeterminate mutations
  // =========================================

  // user_assert_applied → success
  await tx.exec(`
    UPDATE handler_runs
    SET mutation_outcome = 'success'
    WHERE id IN (
      SELECT handler_run_id FROM mutations
      WHERE status = 'indeterminate' AND resolved_by = 'user_assert_applied'
    )
    AND mutation_outcome = ''
  `);

  // user_assert_failed or user_retry → failure
  await tx.exec(`
    UPDATE handler_runs
    SET mutation_outcome = 'failure'
    WHERE id IN (
      SELECT handler_run_id FROM mutations
      WHERE status = 'indeterminate' AND resolved_by IN ('user_assert_failed', 'user_retry')
    )
    AND mutation_outcome = ''
  `);

  // user_skip → skipped
  await tx.exec(`
    UPDATE handler_runs
    SET mutation_outcome = 'skipped'
    WHERE id IN (
      SELECT handler_run_id FROM mutations
      WHERE status = 'indeterminate' AND resolved_by = 'user_skip'
    )
    AND mutation_outcome = ''
  `);
}
