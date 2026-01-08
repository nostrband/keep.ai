import { DBInterface } from "../interfaces";

export async function migrateV12(tx: DBInterface["tx"] extends (fn: (tx: infer T) => any) => any ? T : never) {

  // VERSION: 12
  await tx.exec(`PRAGMA user_version = 12`);

  // Add result field to script_runs table,
  // note the crsql_begin_alter/crsql_commit_alter wrapper
  await tx.exec(`SELECT crsql_begin_alter('script_runs')`);
  await tx.exec(`ALTER TABLE script_runs ADD COLUMN result text not null default ''`);
  await tx.exec(`SELECT crsql_commit_alter('script_runs')`);
}
