import { DBInterface } from "../interfaces";

/**
 * Migration v31: Tasks Table Schema Changes (Spec 10)
 *
 * This migration adds columns to the tasks table:
 * - workflow_id - link back to workflow
 * - asks - moved from task_states
 *
 * Data migration is in v32 due to cr-sqlite requiring ALTER TABLE to be
 * committed before UPDATE can operate on the new columns.
 *
 * Deprecation notes:
 * - tasks.task and tasks.cron are deprecated (never used, or moved to workflows)
 * - task_states table is deprecated (asks moved to tasks, goal/notes/plan removed)
 * - task_runs input_ and output_ state fields are deprecated
 */
export async function migrateV31(tx: DBInterface["tx"] extends (fn: (tx: infer T) => any) => any ? T : never) {
  // VERSION: 31
  await tx.exec(`PRAGMA user_version = 31`);

  // Add workflow_id to tasks using crsql_begin_alter/crsql_commit_alter
  await tx.exec(`SELECT crsql_begin_alter('tasks')`);
  await tx.exec(`ALTER TABLE tasks ADD COLUMN workflow_id TEXT NOT NULL DEFAULT ''`);
  await tx.exec(`SELECT crsql_commit_alter('tasks')`);
  await tx.exec(`CREATE INDEX IF NOT EXISTS idx_tasks_workflow_id ON tasks(workflow_id)`);

  // Add asks to tasks (moved from task_states)
  await tx.exec(`SELECT crsql_begin_alter('tasks')`);
  await tx.exec(`ALTER TABLE tasks ADD COLUMN asks TEXT NOT NULL DEFAULT ''`);
  await tx.exec(`SELECT crsql_commit_alter('tasks')`);

  // Data migration moved to v32 due to cr-sqlite requiring ALTER to be committed
  // before UPDATE can see the new columns
}
