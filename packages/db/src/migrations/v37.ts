import { DBInterface } from "../interfaces";

/**
 * Migration v37: Mark Deprecated Tables
 *
 * The following tables are deprecated and no longer used:
 * - resources: Never implemented, zero usage (Spec 08)
 * - task_states: Data migrated to tasks.asks field (Spec 10, v31/v32)
 * - chat_notifications: Per-device tracking removed (Spec 07)
 *
 * Tables are kept in place to avoid issues with CRR undo/drop.
 */
export async function migrateV37(
  tx: DBInterface["tx"] extends (fn: (tx: infer T) => any) => any ? T : never
) {
  // VERSION: 37
  await tx.exec(`PRAGMA user_version = 37`);

  // Deprecated tables (kept in place, no longer used):
  // - resources (CRR)
  // - task_states (CRR)
  // - chat_notifications (local)
}
