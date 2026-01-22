import { DBInterface } from "../interfaces";

export async function migrateV1(tx: DBInterface["tx"] extends (fn: (tx: infer T) => any) => any ? T : never) {

  // VERSION: 1
  await tx.exec(`PRAGMA user_version = 1`);

  // Chats table with all final columns
  await tx.exec(`CREATE TABLE IF NOT EXISTS chats (
    id TEXT PRIMARY KEY NOT NULL,
    created_at DATETIME DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at DATETIME DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    read_at DATETIME,
    first_message_content TEXT,
    first_message_time DATETIME
  )`);

  // Tasks table with all final columns
  // DEPRECATED fields (kept for backwards compatibility, not used in code):
  // - task: legacy field, never used
  // - cron: workflows have their own cron field now
  // Active fields added in later migrations:
  // - workflow_id, asks added in v30 migration. See Spec 10.
  // - chat_id added in v10 migration.
  // 'deleted' is actively used for soft-delete - do NOT remove.
  await tx.exec(`CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY NOT NULL,
    timestamp INTEGER NOT NULL DEFAULT 0,
    task TEXT NOT NULL DEFAULT '',
    reply TEXT DEFAULT '',
    state TEXT DEFAULT '',
    thread_id TEXT DEFAULT '',
    error TEXT DEFAULT '',
    deleted BOOLEAN DEFAULT FALSE,
    type TEXT DEFAULT '',
    title TEXT NOT NULL DEFAULT '',
    cron TEXT NOT NULL DEFAULT ''
  )`);

  // Notes table
  await tx.exec(`CREATE TABLE IF NOT EXISTS notes (
    id TEXT PRIMARY KEY NOT NULL,
    title TEXT NOT NULL DEFAULT '',
    content TEXT NOT NULL DEFAULT '',
    tags TEXT NOT NULL DEFAULT '',
    priority TEXT NOT NULL DEFAULT '',
    created DATETIME DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated DATETIME DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  )`);

  // Memory implementation tables
  await tx.exec(`CREATE TABLE IF NOT EXISTS threads (
    id TEXT NOT NULL PRIMARY KEY,
    title TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL DEFAULT '',
    metadata TEXT NOT NULL DEFAULT ''
  )`);

  await tx.exec(`CREATE TABLE IF NOT EXISTS messages (
    id TEXT NOT NULL PRIMARY KEY,
    thread_id TEXT NOT NULL DEFAULT '',
    role TEXT NOT NULL DEFAULT '',
    content TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT ''
  )`);

  // DEPRECATED: resources table is no longer used. Kept for backwards compatibility.
  // Will be dropped in a future migration. See Spec 08.
  // Original purpose: Shared working memory and contextual resources.
  // Removal reason: Feature was never implemented or used.
  await tx.exec(`CREATE TABLE IF NOT EXISTS resources (
    id TEXT NOT NULL PRIMARY KEY,
    workingMemory TEXT NOT NULL DEFAULT '',
    metadata TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL DEFAULT ''
  )`);

  // Chats indexes
  await tx.exec(
    `CREATE INDEX IF NOT EXISTS idx_chats_updated_at ON chats(updated_at)`
  );
  await tx.exec(
    `CREATE INDEX IF NOT EXISTS idx_chats_first_message_time ON chats(first_message_time)`
  );

  // Tasks indexes
  await tx.exec(
    `CREATE INDEX IF NOT EXISTS idx_tasks_timestamp ON tasks(timestamp)`
  );
  await tx.exec(
    `CREATE INDEX IF NOT EXISTS idx_tasks_reply ON tasks(reply)`
  );
  await tx.exec(
    `CREATE INDEX IF NOT EXISTS idx_tasks_state ON tasks(state)`
  );
  await tx.exec(
    `CREATE INDEX IF NOT EXISTS idx_tasks_reply_timestamp ON tasks(reply, timestamp)`
  );
  await tx.exec(
    `CREATE INDEX IF NOT EXISTS idx_tasks_state_timestamp ON tasks(state, timestamp)`
  );

  // Notes indexes
  await tx.exec(
    `CREATE INDEX IF NOT EXISTS idx_notes_updated ON notes(updated)`
  );
  await tx.exec(
    `CREATE INDEX IF NOT EXISTS idx_notes_priority ON notes(priority)`
  );

  // Memory tables indexes
  await tx.exec(
    `CREATE INDEX IF NOT EXISTS idx_threads_updated_at ON threads(updated_at)`
  );
  await tx.exec(
    `CREATE INDEX IF NOT EXISTS idx_messages_thread_id ON messages(thread_id)`
  );
  await tx.exec(
    `CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at)`
  );
  // DEPRECATED: Index for unused resources table. See Spec 08.
  await tx.exec(
    `CREATE INDEX IF NOT EXISTS idx_resources_id ON resources(id)`
  );

  await tx.exec("SELECT crsql_as_crr('chats')");
  await tx.exec("SELECT crsql_as_crr('tasks')");
  await tx.exec("SELECT crsql_as_crr('notes')");
  await tx.exec("SELECT crsql_as_crr('threads')");
  await tx.exec("SELECT crsql_as_crr('messages')");
  // DEPRECATED: resources table CRR. See Spec 08.
  await tx.exec("SELECT crsql_as_crr('resources')");
}