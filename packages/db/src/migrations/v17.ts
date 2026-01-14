import { DBInterface } from "../interfaces";

export async function migrateV17(tx: DBInterface["tx"] extends (fn: (tx: infer T) => any) => any ? T : never) {

  // VERSION: 17
  await tx.exec(`PRAGMA user_version = 17`);

  // Add next_run_timestamp field to workflows table,
  // note the crsql_begin_alter/crsql_commit_alter wrapper
  await tx.exec(`SELECT crsql_begin_alter('workflows')`);
  await tx.exec(`ALTER TABLE workflows ADD COLUMN next_run_timestamp text not null default ''`);
  await tx.exec(`SELECT crsql_commit_alter('workflows')`);
}
