import { DBInterface } from "../interfaces";

/**
 * Migration v37: Drop Deprecated Tables
 *
 * Removes tables that are no longer used in the application:
 *
 * Dropped CRR tables:
 * - resources: Never implemented, zero usage (Spec 08)
 * - task_states: Data migrated to tasks.asks field (Spec 10, v31/v32)
 *
 * Dropped LOCAL tables:
 * - chat_notifications: Per-device tracking removed (Spec 07)
 *
 * See IMPLEMENTATION_PLAN.md Technical Debt section for context.
 */
export async function migrateV37(
  tx: DBInterface["tx"] extends (fn: (tx: infer T) => any) => any ? T : never
) {
  // VERSION: 37
  await tx.exec(`PRAGMA user_version = 37`);

  // =========================================
  // DROP DEPRECATED CRR TABLES
  // =========================================

  // Drop resources table - never used, feature never implemented (Spec 08)
  // Must undo CRR before dropping
  await tx.exec("SELECT crsql_as_crr_undo('resources')");
  await tx.exec(`DROP INDEX IF EXISTS idx_resources_id`);
  await tx.exec(`DROP TABLE IF EXISTS resources`);

  // Drop task_states table - data migrated to tasks.asks in v31/v32 (Spec 10)
  // Must undo CRR before dropping
  await tx.exec("SELECT crsql_as_crr_undo('task_states')");
  await tx.exec(`DROP TABLE IF EXISTS task_states`);

  // =========================================
  // DROP DEPRECATED LOCAL TABLES
  // =========================================

  // Drop chat_notifications table - per-device tracking removed (Spec 07)
  // This was a LOCAL table (not CRR), so no crsql_as_crr_undo needed
  await tx.exec(`DROP INDEX IF EXISTS idx_chat_notifications_device`);
  await tx.exec(`DROP TABLE IF EXISTS chat_notifications`);
}
