import { DBInterface } from "../interfaces";

/**
 * Migration v38: Mark chat_events as Deprecated
 *
 * The chat_events table was created in v9 and has been replaced by three
 * purpose-specific tables per Spec 12:
 * - chat_messages: User-visible conversation messages
 * - notifications: Actionable items requiring user attention
 * - execution_logs: Tool calls and debugging data
 *
 * Data was migrated from chat_events to the new tables in v30.
 * Table is kept in place to avoid issues with CRR undo/drop.
 */
export async function migrateV38(
  tx: DBInterface["tx"] extends (fn: (tx: infer T) => any) => any ? T : never
) {
  // VERSION: 38
  await tx.exec(`PRAGMA user_version = 38`);

  // Deprecated table (kept in place, no longer used):
  // - chat_events (CRR)
}
