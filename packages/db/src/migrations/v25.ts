import { DBInterface } from "../interfaces";

export async function migrateV25(tx: DBInterface["tx"] extends (fn: (tx: infer T) => any) => any ? T : never) {

  // VERSION: 25
  await tx.exec(`PRAGMA user_version = 25`);

  // Add indexes for commonly queried columns on script_runs table.
  //
  // Per specs script-runs-workflow-id-index.md and script-runs-retry-of-index.md:
  // - workflow_id is queried by getScriptRunsByWorkflowId(), getLatestRunsByWorkflowIds()
  // - retry_of is queried by getRetriesOfRun()
  //
  // These queries currently do full table scans on every run detail view
  // and workflow list load.

  // Index for workflow_id lookups (used to get runs for a specific workflow)
  await tx.exec(`CREATE INDEX IF NOT EXISTS idx_script_runs_workflow_id ON script_runs(workflow_id)`);

  // Index for retry_of lookups (used to get retries of a specific failed run)
  await tx.exec(`CREATE INDEX IF NOT EXISTS idx_script_runs_retry_of ON script_runs(retry_of)`);
}
