import { DBInterface } from "../interfaces";

export async function migrateV23(tx: DBInterface["tx"] extends (fn: (tx: infer T) => any) => any ? T : never) {

  // VERSION: 23
  await tx.exec(`PRAGMA user_version = 23`);

  // Create chat_notifications table for per-device notification tracking.
  //
  // Per the FIXME in MessageNotifications.ts (line 35), the current implementation
  // uses a global `read_at` timestamp on the `chats` table to track which messages
  // have been notified. This causes a problem for multi-device users:
  //
  // - When a message is notified on Device A, read_at is set globally
  // - Device B never receives the notification because read_at is already set
  //
  // This table tracks notifications per-device using the cr-sqlite site_id as
  // the device identifier. Each device maintains its own notification state.
  //
  // IMPORTANT: This is a LOCAL table (not a CRR) because:
  // 1. Notification tracking is device-specific by design
  // 2. Each device should maintain its own notification history
  // 3. Syncing notification state would defeat the purpose of per-device tracking
  await tx.exec(`
    CREATE TABLE IF NOT EXISTS chat_notifications (
      chat_id TEXT NOT NULL,
      device_id TEXT NOT NULL,
      notified_at TEXT NOT NULL,
      PRIMARY KEY (chat_id, device_id)
    )
  `);

  // Index for efficient queries by device
  await tx.exec(`
    CREATE INDEX IF NOT EXISTS idx_chat_notifications_device
    ON chat_notifications (device_id, notified_at)
  `);
}
