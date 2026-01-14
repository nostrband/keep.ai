import { DBInterface } from "../interfaces";

export async function migrateV15(tx: DBInterface["tx"] extends (fn: (tx: infer T) => any) => any ? T : never) {

  // VERSION: 15
  await tx.exec(`PRAGMA user_version = 15`);

  // Add chat_id field to tasks table,
  // note the crsql_begin_alter/crsql_commit_alter wrapper
  await tx.exec(`SELECT crsql_begin_alter('tasks')`);
  await tx.exec(`ALTER TABLE tasks ADD COLUMN chat_id text not null default ''`);
  await tx.exec(`SELECT crsql_commit_alter('tasks')`);
}
