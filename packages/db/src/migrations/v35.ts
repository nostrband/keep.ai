import { DBInterface } from "../interfaces";

/**
 * Migration v35: Add items table for logical items infrastructure
 *
 * Logical items are the fundamental unit of work in Keep.AI automations.
 * Scripts use Items.withItem() to process work in discrete, trackable units.
 *
 * Item states:
 * - processing: Handler is executing
 * - done: Handler completed successfully
 * - failed: Handler threw an error
 * - skipped: User explicitly skipped (manual action)
 *
 * See specs/logical-items.md for design details.
 */
export async function migrateV35(
  tx: DBInterface["tx"] extends (fn: (tx: infer T) => any) => any ? T : never
) {
  // VERSION: 35
  await tx.exec(`PRAGMA user_version = 35`);

  // Create items table
  // CRSQLite requires NOT NULL columns to have DEFAULT values
  await tx.exec(`
    CREATE TABLE IF NOT EXISTS items (
      id TEXT PRIMARY KEY NOT NULL DEFAULT '',
      workflow_id TEXT NOT NULL DEFAULT '',
      logical_item_id TEXT NOT NULL DEFAULT '',
      title TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'processing',
      current_attempt_id INTEGER NOT NULL DEFAULT 1,
      created_by TEXT NOT NULL DEFAULT 'workflow',
      created_by_run_id TEXT NOT NULL DEFAULT '',
      last_run_id TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL DEFAULT 0,
      UNIQUE(workflow_id, logical_item_id)
    )
  `);

  // Create indexes for common queries
  await tx.exec(
    `CREATE INDEX IF NOT EXISTS idx_items_workflow ON items(workflow_id)`
  );
  await tx.exec(
    `CREATE INDEX IF NOT EXISTS idx_items_status ON items(workflow_id, status)`
  );
  await tx.exec(
    `CREATE INDEX IF NOT EXISTS idx_items_created_at ON items(created_at DESC)`
  );

  // Enable CRSQLite sync for cross-device sync
  await tx.exec("SELECT crsql_as_crr('items')");
}
