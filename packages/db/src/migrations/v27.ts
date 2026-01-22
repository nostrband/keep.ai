import { DBInterface } from "../interfaces";

/**
 * Migration v27: Workflows Status Cleanup (Spec 11)
 *
 * Standardizes workflow status values to be explicit and consistent:
 * - '' (empty) -> 'draft' (No script yet, cannot run)
 * - 'disabled' -> 'paused' (User paused)
 * - Adds 'ready' status (Has script, not yet activated)
 * - 'active' unchanged (Running on schedule)
 * - 'error' for escalated/auth errors (Needs user attention)
 */
export async function migrateV27(tx: DBInterface["tx"] extends (fn: (tx: infer T) => any) => any ? T : never) {

  // VERSION: 27
  await tx.exec(`PRAGMA user_version = 27`);

  // Update existing status values
  // '' (empty) -> 'draft'
  await tx.exec(`UPDATE workflows SET status = 'draft' WHERE status = ''`);

  // 'disabled' -> 'paused'
  await tx.exec(`UPDATE workflows SET status = 'paused' WHERE status = 'disabled'`);

  // Update workflows that have scripts but are still draft to 'ready'
  // A workflow with an active_script_id should be 'ready' not 'draft'
  await tx.exec(`
    UPDATE workflows
    SET status = 'ready'
    WHERE status = 'draft'
      AND active_script_id != ''
  `);
}
