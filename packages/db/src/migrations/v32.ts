import { DBInterface } from "../interfaces";

/**
 * Migration v32: Data Migration for Tasks Table Changes
 *
 * Populates the columns added in v31:
 * - tasks.workflow_id - from workflows.task_id relationship
 * - tasks.asks - from task_states.asks
 *
 * Split from v31 because cr-sqlite requires ALTER TABLE to be committed
 * before UPDATE can operate on the new columns.
 */
export async function migrateV32(tx: DBInterface["tx"] extends (fn: (tx: infer T) => any) => any ? T : never) {
  // VERSION: 32
  await tx.exec(`PRAGMA user_version = 32`);

  // Populate workflow_id from existing workflows (using workflows.task_id relationship)
  await tx.exec(`
    UPDATE tasks SET workflow_id = (
      SELECT w.id FROM workflows w WHERE w.task_id = tasks.id
    ) WHERE workflow_id = ''
  `);

  // Migrate asks from task_states to tasks
  await tx.exec(`
    UPDATE tasks SET asks = COALESCE(
      (SELECT ts.asks FROM task_states ts WHERE ts.id = tasks.id),
      ''
    ) WHERE asks = ''
  `);
}
