import { DBInterface } from "../interfaces";

export async function migrateV22(tx: DBInterface["tx"] extends (fn: (tx: infer T) => any) => any ? T : never) {

  // VERSION: 22
  await tx.exec(`PRAGMA user_version = 22`);

  // Add error_type to script_runs table for notification filtering.
  // Per spec 09 and 09b, the system should only notify users for non-fixable errors
  // (auth, permission, network) but NOT for logic errors which the agent handles
  // silently via maintenance mode. Storing error_type allows the web app to
  // filter notifications appropriately.
  //
  // Values: empty string (no error), 'auth', 'permission', 'network', 'logic'
  await tx.exec(`SELECT crsql_begin_alter('script_runs')`);
  await tx.exec(`ALTER TABLE script_runs ADD COLUMN error_type text not null default ''`);
  await tx.exec(`SELECT crsql_commit_alter('script_runs')`);
}
