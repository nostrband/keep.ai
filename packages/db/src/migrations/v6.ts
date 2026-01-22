import { DBInterface } from "../interfaces";

export async function migrateV6(tx: DBInterface["tx"] extends (fn: (tx: infer T) => any) => any ? T : never) {

  // VERSION: 6
  await tx.exec(`PRAGMA user_version = 6`);

  // Task runs table
  // DEPRECATED fields (kept for backwards compatibility, not used in code):
  // - reason: only "input" value was used, now removed
  // - input_goal, input_notes, input_plan, input_asks
  // - output_goal, output_notes, output_plan, output_asks
  // See Spec 10.
  await tx.exec(`CREATE TABLE IF NOT EXISTS task_runs (
    id TEXT PRIMARY KEY NOT NULL,
    task_id TEXT NOT NULL DEFAULT '',
    type TEXT NOT NULL DEFAULT '',
    start_timestamp TEXT NOT NULL DEFAULT '',
    thread_id TEXT NOT NULL DEFAULT '',
    reason TEXT NOT NULL DEFAULT '',
    inbox TEXT NOT NULL DEFAULT '',
    model TEXT NOT NULL DEFAULT '',
    input_goal TEXT NOT NULL DEFAULT '',
    input_notes TEXT NOT NULL DEFAULT '',
    input_plan TEXT NOT NULL DEFAULT '',
    input_asks TEXT NOT NULL DEFAULT '',
    output_goal TEXT NOT NULL DEFAULT '',
    output_notes TEXT NOT NULL DEFAULT '',
    output_plan TEXT NOT NULL DEFAULT '',
    output_asks TEXT NOT NULL DEFAULT '',
    end_timestamp TEXT NOT NULL DEFAULT '',
    state TEXT NOT NULL DEFAULT '',
    reply TEXT NOT NULL DEFAULT '',
    error TEXT NOT NULL DEFAULT '',
    steps INTEGER NOT NULL DEFAULT 0,
    run_sec INTEGER NOT NULL DEFAULT 0,
    input_tokens INTEGER NOT NULL DEFAULT 0,
    output_tokens INTEGER NOT NULL DEFAULT 0,
    cached_tokens INTEGER NOT NULL DEFAULT 0
  )`);

  // Indexes for efficient querying
  await tx.exec(
    `CREATE INDEX IF NOT EXISTS idx_task_runs_task_id ON task_runs(task_id)`
  );
  await tx.exec(
    `CREATE INDEX IF NOT EXISTS idx_task_runs_start_timestamp ON task_runs(start_timestamp)`
  );
  await tx.exec(
    `CREATE INDEX IF NOT EXISTS idx_task_runs_state ON task_runs(state)`
  );

  await tx.exec("SELECT crsql_as_crr('task_runs')");
}