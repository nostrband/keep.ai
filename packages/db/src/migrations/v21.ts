import { DBInterface } from "../interfaces";

export async function migrateV21(tx: DBInterface["tx"] extends (fn: (tx: infer T) => any) => any ? T : never) {

  // VERSION: 21
  await tx.exec(`PRAGMA user_version = 21`);

  // Add maintenance_fix_count to workflows table for tracking consecutive fix attempts.
  // When a logic error occurs and the workflow enters maintenance mode, this count is
  // incremented. When the fix succeeds (workflow runs without error after maintenance),
  // the count is reset to 0. If the count exceeds MAX_FIX_ATTEMPTS (3), the workflow
  // is escalated to the user (paused) instead of attempting another auto-fix.
  // This prevents infinite repair loops per spec 09b.
  await tx.exec(`SELECT crsql_begin_alter('workflows')`);
  await tx.exec(`ALTER TABLE workflows ADD COLUMN maintenance_fix_count integer not null default 0`);
  await tx.exec(`SELECT crsql_commit_alter('workflows')`);
}
