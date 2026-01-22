import { DBInterface } from "../interfaces";

/**
 * Migration v30: Tasks Table Cleanup (Spec 10)
 *
 * This migration:
 * 1. Adds workflow_id and asks columns to tasks table
 * 2. Populates workflow_id from existing workflows
 * 3. Migrates asks from task_states to tasks
 * 4. Marks task_states as deprecated (table kept for backwards compatibility)
 *
 * Deprecation notes:
 * - tasks.task and tasks.cron are deprecated (never used, or moved to workflows)
 * - task_states table is deprecated (asks moved to tasks, goal/notes/plan removed)
 * - task_runs input_ and output_ state fields are deprecated
 */
export async function migrateV30(tx: DBInterface["tx"] extends (fn: (tx: infer T) => any) => any ? T : never) {
  // VERSION: 30
  await tx.exec(`PRAGMA user_version = 30`);

  // Add workflow_id to tasks using crsql_begin_alter/crsql_commit_alter
  await tx.exec(`SELECT crsql_begin_alter('tasks')`);
  await tx.exec(`ALTER TABLE tasks ADD COLUMN workflow_id TEXT NOT NULL DEFAULT ''`);
  await tx.exec(`SELECT crsql_commit_alter('tasks')`);
  await tx.exec(`CREATE INDEX IF NOT EXISTS idx_tasks_workflow_id ON tasks(workflow_id)`);

  // Add asks to tasks (moved from task_states)
  await tx.exec(`SELECT crsql_begin_alter('tasks')`);
  await tx.exec(`ALTER TABLE tasks ADD COLUMN asks TEXT NOT NULL DEFAULT ''`);
  await tx.exec(`SELECT crsql_commit_alter('tasks')`);

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
