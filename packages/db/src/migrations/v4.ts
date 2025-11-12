import { DBInterface } from "../interfaces";

export async function migrateV4(tx: DBInterface["tx"] extends (fn: (tx: infer T) => any) => any ? T : never) {

  // VERSION: 5
  await tx.exec(`PRAGMA user_version = 4`);

  // Inbox table
  await tx.exec(`CREATE TABLE IF NOT EXISTS inbox (
    id TEXT PRIMARY KEY NOT NULL,
    source TEXT NOT NULL DEFAULT '',
    source_id TEXT NOT NULL DEFAULT '',
    target TEXT NOT NULL DEFAULT '',
    target_id TEXT NOT NULL DEFAULT '',
    content TEXT NOT NULL DEFAULT '',
    timestamp TEXT NOT NULL DEFAULT '',
    handler_timestamp TEXT NOT NULL DEFAULT '',
    handler_thread_id TEXT NOT NULL DEFAULT ''
  )`);

  // Inbox indexes for efficient querying
  await tx.exec(
    `CREATE INDEX IF NOT EXISTS idx_inbox_timestamp ON inbox(timestamp)`
  );
  await tx.exec(
    `CREATE INDEX IF NOT EXISTS idx_inbox_source ON inbox(source)`
  );
  await tx.exec(
    `CREATE INDEX IF NOT EXISTS idx_inbox_target ON inbox(target)`
  );
  await tx.exec(
    `CREATE INDEX IF NOT EXISTS idx_inbox_handler_timestamp ON inbox(handler_timestamp)`
  );

  await tx.exec("SELECT crsql_as_crr('inbox')");
}