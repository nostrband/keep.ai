import { DBInterface } from "../interfaces";

/**
 * Migration v33: Add connections table for OAuth service connections
 *
 * This table stores metadata about OAuth connections (Gmail, Notion, etc.).
 * Actual OAuth tokens are stored in files at {userPath}/connectors/{service}/{accountId}.json
 * to keep sensitive data out of the synced database.
 *
 * See specs/connectors-02-connection-manager.md for design details.
 */
export async function migrateV33(
  tx: DBInterface["tx"] extends (fn: (tx: infer T) => any) => any ? T : never
) {
  // VERSION: 33
  await tx.exec(`PRAGMA user_version = 33`);

  // Create connections table
  // Note: CRSQLite requires NOT NULL columns to have DEFAULT values
  await tx.exec(`
    CREATE TABLE IF NOT EXISTS connections (
      id TEXT PRIMARY KEY NOT NULL DEFAULT '',
      service TEXT NOT NULL DEFAULT '',
      account_id TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'connected',
      label TEXT,
      error TEXT,
      created_at INTEGER NOT NULL DEFAULT 0,
      last_used_at INTEGER,
      metadata TEXT
    )
  `);

  // Index for filtering by service
  await tx.exec(
    `CREATE INDEX IF NOT EXISTS idx_connections_service ON connections(service)`
  );

  // Mark table for CRSQLite sync
  await tx.exec("SELECT crsql_as_crr('connections')");
}
