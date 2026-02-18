import { DBInterface } from "../interfaces";

/**
 * Migration v48: Add handler_runs.mutation_outcome and workflows.error
 *
 * Part of the Execution State Consolidation (exec-state-consolidation spec).
 *
 * handler_runs.mutation_outcome: Denormalized mutation outcome on the handler run.
 * Values: "" (no mutation or pre-mutation), "success", "failure", "skipped".
 * Set by applyMutation/failMutation/skipMutation in ExecutionModelManager.
 * Used by crash recovery and updateHandlerRunStatus to determine pre/post-mutation
 * disposition without joining to the mutations table.
 *
 * workflows.error: System-controlled error description.
 * Set by updateHandlerRunStatus when handler needs user attention (e.g. auth failure,
 * indeterminate mutation). Cleared by mutation resolution methods.
 * Orthogonal to workflow.status which is user-controlled (active/paused/etc).
 * Scheduler checks: status = "active" AND error = "" AND NOT maintenance.
 */
export async function migrateV48(
  tx: DBInterface["tx"] extends (fn: (tx: infer T) => any) => any ? T : never
) {
  // VERSION: 48
  await tx.exec(`PRAGMA user_version = 48`);

  // =========================================
  // ALTER handler_runs TABLE - Add mutation_outcome column
  // =========================================

  await tx.exec("SELECT crsql_begin_alter('handler_runs')");

  await tx.exec(`
    ALTER TABLE handler_runs ADD COLUMN mutation_outcome TEXT NOT NULL DEFAULT ''
  `);

  await tx.exec("SELECT crsql_commit_alter('handler_runs')");

  // =========================================
  // ALTER workflows TABLE - Add error column
  // =========================================

  await tx.exec("SELECT crsql_begin_alter('workflows')");

  await tx.exec(`
    ALTER TABLE workflows ADD COLUMN error TEXT NOT NULL DEFAULT ''
  `);

  await tx.exec("SELECT crsql_commit_alter('workflows')");
}
