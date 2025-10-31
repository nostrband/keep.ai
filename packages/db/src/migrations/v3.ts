import { DBInterface } from "../interfaces";

export async function migrateV3(tx: DBInterface["tx"] extends (fn: (tx: infer T) => any) => any ? T : never) {

  // VERSION: 3
  await tx.exec(`PRAGMA user_version = 3`);

  // Nostr peers table
  await tx.exec(`CREATE TABLE IF NOT EXISTS nostr_peers (
    peer_pubkey TEXT NOT NULL PRIMARY KEY,
    peer_id TEXT DEFAULT '',
    local_pubkey TEXT DEFAULT '',
    local_id TEXT DEFAULT '',
    device_info TEXT DEFAULT '',
    timestamp TEXT DEFAULT '',
    relays TEXT DEFAULT ''
  )`);

  // Index for timestamp-based queries
  await tx.exec(
    `CREATE INDEX IF NOT EXISTS idx_nostr_peers_timestamp ON nostr_peers(timestamp)`
  );

  await tx.exec("SELECT crsql_as_crr('nostr_peers')");

  // Nostr peer cursors table (not synced across devices)
  await tx.exec(`CREATE TABLE IF NOT EXISTS nostr_peer_cursors (
    peer_pubkey TEXT NOT NULL PRIMARY KEY,
    send_cursor TEXT NOT NULL DEFAULT '',
    send_cursor_id TEXT NOT NULL DEFAULT '',
    send_changes_event_id TEXT NOT NULL DEFAULT '',
    send_changes_timestamp number NOT NULL DEFAULT '',
    recv_cursor TEXT NOT NULL DEFAULT '',
    recv_cursor_id TEXT NOT NULL DEFAULT '',
    recv_changes_event_id TEXT NOT NULL DEFAULT '',
    recv_changes_timestamp number NOT NULL DEFAULT ''
  )`);
}