import { DBInterface } from "../interfaces";

export async function migrateV5(tx: DBInterface["tx"] extends (fn: (tx: infer T) => any) => any ? T : never) {

  // VERSION: 5
  await tx.exec(`PRAGMA user_version = 5`);

  // Task states table
  await tx.exec(`CREATE TABLE IF NOT EXISTS task_states (
    id TEXT PRIMARY KEY NOT NULL,
    goal TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    plan TEXT NOT NULL DEFAULT '',
    asks TEXT NOT NULL DEFAULT ''
  )`);

  await tx.exec("SELECT crsql_as_crr('task_states')");
}