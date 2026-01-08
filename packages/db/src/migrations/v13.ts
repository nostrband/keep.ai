import { DBInterface } from "../interfaces";

export async function migrateV13(tx: DBInterface["tx"] extends (fn: (tx: infer T) => any) => any ? T : never) {

  // VERSION: 13
  await tx.exec(`PRAGMA user_version = 13`);

  // Add cost field to task_runs table,
  // note the crsql_begin_alter/crsql_commit_alter wrapper
  await tx.exec(`SELECT crsql_begin_alter('task_runs')`);
  await tx.exec(`ALTER TABLE task_runs ADD COLUMN cost integer not null default 0`);
  await tx.exec(`SELECT crsql_commit_alter('task_runs')`);
}
