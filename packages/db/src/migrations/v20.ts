import { DBInterface } from "../interfaces";

export async function migrateV20(tx: DBInterface["tx"] extends (fn: (tx: infer T) => any) => any ? T : never) {

  // VERSION: 20
  await tx.exec(`PRAGMA user_version = 20`);

  // Add retry tracking fields to script_runs table for Spec 10 - Retry Failed Run.
  // - retry_of: ID of the original failed run (null for non-retry runs)
  // - retry_count: Which retry attempt this is (0 for non-retry runs)
  // These fields allow tracking retry chains and displaying retry history in the UI.
  await tx.exec(`SELECT crsql_begin_alter('script_runs')`);
  await tx.exec(`ALTER TABLE script_runs ADD COLUMN retry_of text not null default ''`);
  await tx.exec(`ALTER TABLE script_runs ADD COLUMN retry_count integer not null default 0`);
  await tx.exec(`SELECT crsql_commit_alter('script_runs')`);
}
