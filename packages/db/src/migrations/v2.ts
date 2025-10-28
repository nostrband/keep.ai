import { DBInterface } from "../interfaces";

export async function migrateV2(tx: DBInterface["tx"] extends (fn: (tx: infer T) => any) => any ? T : never) {

  // VERSION: 2
  await tx.exec(`PRAGMA user_version = 2`);

  // Agent state table
  await tx.exec(`CREATE TABLE IF NOT EXISTS agent_state (
    key TEXT NOT NULL PRIMARY KEY,
    value TEXT NOT NULL DEFAULT '',
    timestamp TEXT NOT NULL DEFAULT ''
  )`);

  await tx.exec("SELECT crsql_as_crr('agent_state')");
}