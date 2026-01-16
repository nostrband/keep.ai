import { DBInterface } from "../interfaces";

export async function migrateV18(tx: DBInterface["tx"] extends (fn: (tx: infer T) => any) => any ? T : never) {

  // VERSION: 18
  await tx.exec(`PRAGMA user_version = 18`);

  // Add maintenance flag to workflows table for maintenance mode.
  // When a logic error occurs, the workflow is put into maintenance mode
  // (maintenance = 1) so the scheduler skips it while the agent auto-fixes.
  // After the fix is applied, maintenance is cleared (maintenance = 0)
  // and the workflow runs immediately to verify the fix.
  await tx.exec(`SELECT crsql_begin_alter('workflows')`);
  await tx.exec(`ALTER TABLE workflows ADD COLUMN maintenance integer not null default 0`);
  await tx.exec(`SELECT crsql_commit_alter('workflows')`);
}
