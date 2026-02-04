import { DBInterface } from "../interfaces";

/**
 * Migration v38: Drop chat_events Table
 *
 * The chat_events table was created in v9 and has been replaced by three
 * purpose-specific tables per Spec 12:
 * - chat_messages: User-visible conversation messages
 * - notifications: Actionable items requiring user attention
 * - execution_logs: Tool calls and debugging data
 *
 * Data was migrated from chat_events to the new tables in v30.
 * All code has been migrated to use the new tables.
 * This migration drops the now-unused chat_events table.
 *
 * See IMPLEMENTATION_PLAN.md Technical Debt section for context.
 */
export async function migrateV38(
  tx: DBInterface["tx"] extends (fn: (tx: infer T) => any) => any ? T : never
) {
  // VERSION: 38
  await tx.exec(`PRAGMA user_version = 38`);

  // =========================================
  // DROP DEPRECATED CRR TABLE: chat_events
  // =========================================

  // The chat_events table is a CRR table (created in v9 with crsql_as_crr)
  // Must undo CRR before dropping
  await tx.exec("SELECT crsql_as_crr_undo('chat_events')");

  // Drop indexes first
  await tx.exec(`DROP INDEX IF EXISTS idx_chat_events_chat_id`);
  await tx.exec(`DROP INDEX IF EXISTS idx_chat_events_timestamp`);

  // Drop the table
  await tx.exec(`DROP TABLE IF EXISTS chat_events`);
}
