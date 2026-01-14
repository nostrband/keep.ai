import { DBInterface } from "../interfaces";

export async function migrateV16(tx: DBInterface["tx"] extends (fn: (tx: infer T) => any) => any ? T : never) {

  // VERSION: 16
  await tx.exec(`PRAGMA user_version = 16`);

  // Create workflows table
  await tx.exec(`CREATE TABLE workflows (
    id text not null primary key,
    title text not null default '',
    task_id text not null default '',
    timestamp text not null default '',
    cron text not null default '',
    events text not null default '',
    status text not null default ''
  )`);

  // Add the table to CRR for conflict-free replication
  await tx.exec(`SELECT crsql_as_crr('workflows')`);

  // Create indexes for performance
  await tx.exec(`CREATE INDEX idx_workflows_task_id ON workflows(task_id)`);
  await tx.exec(`CREATE INDEX idx_workflows_timestamp ON workflows(timestamp)`);
  await tx.exec(`CREATE INDEX idx_workflows_status ON workflows(status)`);

  // Add workflow_id and type fields to scripts table,
  // note the crsql_begin_alter/crsql_commit_alter wrapper
  await tx.exec(`SELECT crsql_begin_alter('scripts')`);
  await tx.exec(`ALTER TABLE scripts ADD COLUMN workflow_id text not null default ''`);
  await tx.exec(`SELECT crsql_commit_alter('scripts')`);

  await tx.exec(`SELECT crsql_begin_alter('scripts')`);
  await tx.exec(`ALTER TABLE scripts ADD COLUMN type text not null default ''`);
  await tx.exec(`SELECT crsql_commit_alter('scripts')`);

  // Add workflow_id and type fields to script_runs table
  await tx.exec(`SELECT crsql_begin_alter('script_runs')`);
  await tx.exec(`ALTER TABLE script_runs ADD COLUMN workflow_id text not null default ''`);
  await tx.exec(`SELECT crsql_commit_alter('script_runs')`);

  await tx.exec(`SELECT crsql_begin_alter('script_runs')`);
  await tx.exec(`ALTER TABLE script_runs ADD COLUMN type text not null default ''`);
  await tx.exec(`SELECT crsql_commit_alter('script_runs')`);
}
