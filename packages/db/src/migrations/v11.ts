import { DBInterface } from "../interfaces";

export async function migrateV11(tx: DBInterface["tx"] extends (fn: (tx: infer T) => any) => any ? T : never) {

  // VERSION: 11
  await tx.exec(`PRAGMA user_version = 11`);

  // Create scripts table
  await tx.exec(`CREATE TABLE scripts (
    id text not null primary key,
    task_id text not null default '',
    version int not null default 0,
    timestamp text not null default '',
    code text not null default '',
    change_comment text not null default ''
  )`);

  // Add the table to CRR for conflict-free replication
  await tx.exec(`SELECT crsql_as_crr('scripts')`);

  // Create indexes for performance
  await tx.exec(`CREATE INDEX idx_scripts_task_id ON scripts(task_id)`);
  await tx.exec(`CREATE INDEX idx_scripts_timestamp ON scripts(timestamp)`);
  await tx.exec(`CREATE INDEX idx_scripts_version ON scripts(version)`);

  // Create script_runs table
  await tx.exec(`CREATE TABLE script_runs (
    id text not null primary key,
    script_id text not null default '',
    start_timestamp text not null default '',
    end_timestamp text not null default '',
    error text not null default ''
  )`);

  // Add the table to CRR for conflict-free replication
  await tx.exec(`SELECT crsql_as_crr('script_runs')`);

  // Create indexes for performance
  await tx.exec(`CREATE INDEX idx_script_runs_script_id ON script_runs(script_id)`);
  await tx.exec(`CREATE INDEX idx_script_runs_start_timestamp ON script_runs(start_timestamp)`);
}
