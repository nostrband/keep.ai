import { DBInterface } from "../interfaces";

export async function migrateV9(tx: DBInterface["tx"] extends (fn: (tx: infer T) => any) => any ? T : never) {

  // VERSION: 9
  await tx.exec(`PRAGMA user_version = 9`);

  // Create chat_events table with crr tracking
  await tx.exec(`CREATE TABLE chat_events (
    id text not null primary key,
    chat_id text not null default '',
    type text not null default '',
    timestamp text not null default '',
    content text not null default ''
  )`);

  await tx.exec(`SELECT crsql_as_crr('chat_events')`);

  // Create indexes on chat_id and timestamp for performance
  await tx.exec(`CREATE INDEX idx_chat_events_chat_id ON chat_events(chat_id)`);
  await tx.exec(`CREATE INDEX idx_chat_events_timestamp ON chat_events(timestamp)`);

  // Transfer existing messages from messages table where thread_id='main' to chat_events
  await tx.exec(`INSERT INTO chat_events (id, chat_id, type, timestamp, content)
    SELECT id, 'main' as chat_id, 'message' as type, created_at as timestamp, content
    FROM messages 
    WHERE thread_id = 'main'`);
}