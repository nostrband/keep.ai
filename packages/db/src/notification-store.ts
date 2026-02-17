import { CRSqliteDB } from "./database";
import { DBInterface } from "./interfaces";

/**
 * Notification types for workflow events requiring user attention.
 * - error: Auth/permission/network error during run
 * - escalated: Auto-fix failed after 3 attempts
 * - maintenance_failed: Maintainer task could not fix the issue
 * - script_message: Script calls user.send() tool
 * - script_ask: Script calls user.ask() tool (v2)
 * - draft_archived: Draft workflow was archived due to inactivity
 */
export type NotificationType = "error" | "escalated" | "maintenance_failed" | "script_message" | "script_ask" | "draft_archived";

export interface Notification {
  id: string;
  workflow_id: string;
  type: NotificationType;
  payload: string;  // JSON with type-specific data
  timestamp: string;
  acknowledged_at: string;
  resolved_at: string;
  workflow_title: string;
}

interface NotificationRow {
  id: string;
  workflow_id: string;
  type: string;
  payload: string;
  timestamp: string;
  acknowledged_at: string;
  resolved_at: string;
  workflow_title: string;
}

function rowToNotification(row: NotificationRow): Notification {
  return {
    id: row.id,
    workflow_id: row.workflow_id,
    type: row.type as NotificationType,
    payload: row.payload,
    timestamp: row.timestamp,
    acknowledged_at: row.acknowledged_at,
    resolved_at: row.resolved_at,
    workflow_title: row.workflow_title,
  };
}

export class NotificationStore {
  private db: CRSqliteDB;

  constructor(db: CRSqliteDB) {
    this.db = db;
  }

  /**
   * Save a new notification.
   */
  async saveNotification(notification: Notification, tx?: DBInterface): Promise<void> {
    const db = tx || this.db.db;
    await db.exec(
      `INSERT OR REPLACE INTO notifications (id, workflow_id, type, payload, timestamp, acknowledged_at, resolved_at, workflow_title)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        notification.id,
        notification.workflow_id,
        notification.type,
        notification.payload,
        notification.timestamp,
        notification.acknowledged_at,
        notification.resolved_at,
        notification.workflow_title,
      ]
    );
  }

  /**
   * Get notifications with optional filtering.
   */
  async getNotifications(opts?: {
    workflowId?: string;
    unresolvedOnly?: boolean;
    limit?: number;
    before?: string;
  }): Promise<Notification[]> {
    // LEFT JOIN workflows to fill in empty workflow_title from the workflow record
    let sql = `SELECT n.id, n.workflow_id, n.type, n.payload, n.timestamp, n.acknowledged_at, n.resolved_at,
       CASE WHEN n.workflow_title = '' THEN COALESCE(w.title, '') ELSE n.workflow_title END as workflow_title
       FROM notifications n LEFT JOIN workflows w ON n.workflow_id = w.id`;
    const args: (string | number)[] = [];
    const conditions: string[] = [];

    if (opts?.workflowId) {
      conditions.push("n.workflow_id = ?");
      args.push(opts.workflowId);
    }

    if (opts?.unresolvedOnly) {
      conditions.push("n.resolved_at = ''");
    }

    if (opts?.before) {
      conditions.push("n.timestamp < ?");
      args.push(opts.before);
    }

    if (conditions.length > 0) {
      sql += " WHERE " + conditions.join(" AND ");
    }

    sql += " ORDER BY n.timestamp DESC";

    if (opts?.limit) {
      sql += " LIMIT ?";
      args.push(opts.limit);
    }

    const results = await this.db.db.execO<NotificationRow>(sql, args);

    if (!results) return [];

    return results.map(rowToNotification);
  }

  /**
   * Get a single notification by ID.
   */
  async getNotification(id: string): Promise<Notification | null> {
    const results = await this.db.db.execO<NotificationRow>(
      "SELECT * FROM notifications WHERE id = ?",
      [id]
    );

    if (!results || results.length === 0) {
      return null;
    }

    return rowToNotification(results[0]);
  }

  /**
   * Mark a notification as acknowledged (user has seen it).
   */
  async acknowledgeNotification(id: string): Promise<void> {
    const now = new Date().toISOString();
    await this.db.db.exec(
      `UPDATE notifications SET acknowledged_at = ? WHERE id = ?`,
      [now, id]
    );
  }

  /**
   * Mark a notification as resolved (issue has been addressed).
   */
  async resolveNotification(id: string): Promise<void> {
    const now = new Date().toISOString();
    await this.db.db.exec(
      `UPDATE notifications SET resolved_at = ? WHERE id = ?`,
      [now, id]
    );
  }

  /**
   * Get the latest unresolved error notification for a workflow.
   * Used to show error alerts on the workflow hub page.
   */
  async getUnresolvedError(workflowId: string): Promise<Notification | null> {
    const results = await this.db.db.execO<NotificationRow>(
      `SELECT n.id, n.workflow_id, n.type, n.payload, n.timestamp, n.acknowledged_at, n.resolved_at,
       CASE WHEN n.workflow_title = '' THEN COALESCE(w.title, '') ELSE n.workflow_title END as workflow_title
       FROM notifications n LEFT JOIN workflows w ON n.workflow_id = w.id
       WHERE n.workflow_id = ? AND n.type = 'error' AND n.resolved_at = ''
       ORDER BY n.timestamp DESC LIMIT 1`,
      [workflowId]
    );

    if (!results || results.length === 0) {
      return null;
    }

    return rowToNotification(results[0]);
  }

  /**
   * Get all unresolved notifications for a workflow.
   * Used to show notification banners on the workflow detail page.
   */
  async getUnresolvedWorkflowNotifications(workflowId: string): Promise<Notification[]> {
    const results = await this.db.db.execO<NotificationRow>(
      `SELECT n.id, n.workflow_id, n.type, n.payload, n.timestamp, n.acknowledged_at, n.resolved_at,
       CASE WHEN n.workflow_title = '' THEN COALESCE(w.title, '') ELSE n.workflow_title END as workflow_title
       FROM notifications n LEFT JOIN workflows w ON n.workflow_id = w.id
       WHERE n.workflow_id = ? AND n.resolved_at = ''
       ORDER BY n.timestamp DESC`,
      [workflowId]
    );

    if (!results) return [];

    return results.map(rowToNotification);
  }

  /**
   * Count unresolved notifications (for badge display).
   */
  async countUnresolved(workflowId?: string): Promise<number> {
    let sql = `SELECT COUNT(*) as count FROM notifications WHERE resolved_at = ''`;
    const args: string[] = [];

    if (workflowId) {
      sql += ` AND workflow_id = ?`;
      args.push(workflowId);
    }

    const results = await this.db.db.execO<{ count: number }>(sql, args);
    return results?.[0]?.count || 0;
  }

  /**
   * Get unresolved notifications count and list for the notification bell.
   */
  async getUnresolvedNotifications(limit: number = 10): Promise<{
    count: number;
    notifications: Notification[];
  }> {
    const [count, notifications] = await Promise.all([
      this.countUnresolved(),
      this.getNotifications({ unresolvedOnly: true, limit }),
    ]);

    return { count, notifications };
  }
}
