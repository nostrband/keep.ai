import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DBInterface, KeepDb, NotificationStore, Notification } from "@app/db";
import { createDBNode } from "@app/node";

/**
 * Helper to create notifications table without full migration system.
 * This allows testing the store in isolation without CR-SQLite dependencies.
 */
async function createNotificationsTable(db: DBInterface): Promise<void> {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY NOT NULL,
      workflow_id TEXT NOT NULL,
      type TEXT NOT NULL,
      payload TEXT NOT NULL DEFAULT '',
      timestamp TEXT NOT NULL,
      acknowledged_at TEXT NOT NULL DEFAULT '',
      resolved_at TEXT NOT NULL DEFAULT '',
      workflow_title TEXT NOT NULL DEFAULT ''
    )
  `);
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_notifications_workflow_id ON notifications(workflow_id)`);
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_notifications_timestamp ON notifications(timestamp)`);
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_notifications_type ON notifications(type)`);
}

describe("NotificationStore", () => {
  let db: DBInterface;
  let keepDb: KeepDb;
  let notificationStore: NotificationStore;

  beforeEach(async () => {
    db = await createDBNode(":memory:");
    keepDb = new KeepDb(db);
    // Create table manually instead of running full migrations
    await createNotificationsTable(db);
    notificationStore = new NotificationStore(keepDb);
  });

  afterEach(async () => {
    if (db) {
      await db.close();
    }
  });

  describe("saveNotification and getNotifications", () => {
    it("should save and retrieve a notification", async () => {
      const notification = {
        id: "notif-1",
        workflow_id: "workflow-1",
        type: "error" as const,
        payload: JSON.stringify({ message: "Auth failed" }),
        timestamp: new Date().toISOString(),
        acknowledged_at: "",
        resolved_at: "",
        workflow_title: "My Workflow",
      };

      await notificationStore.saveNotification(notification);
      const notifications = await notificationStore.getNotifications();

      expect(notifications).toHaveLength(1);
      expect(notifications[0]).toEqual(notification);
    });

    it("should retrieve notifications ordered by timestamp DESC", async () => {
      const now = Date.now();
      const notifications = [
        {
          id: "notif-1",
          workflow_id: "workflow-1",
          type: "error" as const,
          payload: "{}",
          timestamp: new Date(now - 2000).toISOString(),
          acknowledged_at: "",
          resolved_at: "",
          workflow_title: "Workflow 1",
        },
        {
          id: "notif-2",
          workflow_id: "workflow-2",
          type: "escalated" as const,
          payload: "{}",
          timestamp: new Date(now).toISOString(),
          acknowledged_at: "",
          resolved_at: "",
          workflow_title: "Workflow 2",
        },
        {
          id: "notif-3",
          workflow_id: "workflow-1",
          type: "script_message" as const,
          payload: "{}",
          timestamp: new Date(now - 1000).toISOString(),
          acknowledged_at: "",
          resolved_at: "",
          workflow_title: "Workflow 1",
        },
      ];

      for (const n of notifications) {
        await notificationStore.saveNotification(n);
      }

      const results = await notificationStore.getNotifications();
      expect(results).toHaveLength(3);
      expect(results[0].id).toBe("notif-2"); // Most recent first
      expect(results[1].id).toBe("notif-3");
      expect(results[2].id).toBe("notif-1");
    });

    it("should filter notifications by workflowId", async () => {
      const notifications = [
        {
          id: "notif-1",
          workflow_id: "workflow-1",
          type: "error" as const,
          payload: "{}",
          timestamp: new Date().toISOString(),
          acknowledged_at: "",
          resolved_at: "",
          workflow_title: "Workflow 1",
        },
        {
          id: "notif-2",
          workflow_id: "workflow-2",
          type: "error" as const,
          payload: "{}",
          timestamp: new Date().toISOString(),
          acknowledged_at: "",
          resolved_at: "",
          workflow_title: "Workflow 2",
        },
      ];

      for (const n of notifications) {
        await notificationStore.saveNotification(n);
      }

      const results = await notificationStore.getNotifications({
        workflowId: "workflow-1",
      });
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe("notif-1");
    });

    it("should filter unresolved notifications only", async () => {
      const notifications = [
        {
          id: "notif-1",
          workflow_id: "workflow-1",
          type: "error" as const,
          payload: "{}",
          timestamp: new Date().toISOString(),
          acknowledged_at: "",
          resolved_at: "",
          workflow_title: "Workflow 1",
        },
        {
          id: "notif-2",
          workflow_id: "workflow-1",
          type: "error" as const,
          payload: "{}",
          timestamp: new Date().toISOString(),
          acknowledged_at: "",
          resolved_at: new Date().toISOString(),
          workflow_title: "Workflow 1",
        },
      ];

      for (const n of notifications) {
        await notificationStore.saveNotification(n);
      }

      const results = await notificationStore.getNotifications({
        unresolvedOnly: true,
      });
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe("notif-1");
    });

    it("should limit the number of results", async () => {
      for (let i = 0; i < 10; i++) {
        await notificationStore.saveNotification({
          id: `notif-${i}`,
          workflow_id: "workflow-1",
          type: "error" as const,
          payload: "{}",
          timestamp: new Date(Date.now() + i).toISOString(),
          acknowledged_at: "",
          resolved_at: "",
          workflow_title: "Workflow 1",
        });
      }

      const results = await notificationStore.getNotifications({ limit: 5 });
      expect(results).toHaveLength(5);
    });
  });

  describe("getNotification", () => {
    it("should return a single notification by id", async () => {
      const notification = {
        id: "notif-1",
        workflow_id: "workflow-1",
        type: "error" as const,
        payload: JSON.stringify({ message: "Test" }),
        timestamp: new Date().toISOString(),
        acknowledged_at: "",
        resolved_at: "",
        workflow_title: "My Workflow",
      };

      await notificationStore.saveNotification(notification);
      const result = await notificationStore.getNotification("notif-1");

      expect(result).toEqual(notification);
    });

    it("should return null for non-existent notification", async () => {
      const result = await notificationStore.getNotification("non-existent");
      expect(result).toBeNull();
    });
  });

  describe("acknowledgeNotification", () => {
    it("should set acknowledged_at timestamp", async () => {
      await notificationStore.saveNotification({
        id: "notif-1",
        workflow_id: "workflow-1",
        type: "error" as const,
        payload: "{}",
        timestamp: new Date().toISOString(),
        acknowledged_at: "",
        resolved_at: "",
        workflow_title: "Workflow 1",
      });

      await notificationStore.acknowledgeNotification("notif-1");
      const result = await notificationStore.getNotification("notif-1");

      expect(result?.acknowledged_at).not.toBe("");
      expect(new Date(result!.acknowledged_at).getTime()).toBeLessThanOrEqual(Date.now());
    });
  });

  describe("resolveNotification", () => {
    it("should set resolved_at timestamp", async () => {
      await notificationStore.saveNotification({
        id: "notif-1",
        workflow_id: "workflow-1",
        type: "error" as const,
        payload: "{}",
        timestamp: new Date().toISOString(),
        acknowledged_at: "",
        resolved_at: "",
        workflow_title: "Workflow 1",
      });

      await notificationStore.resolveNotification("notif-1");
      const result = await notificationStore.getNotification("notif-1");

      expect(result?.resolved_at).not.toBe("");
      expect(new Date(result!.resolved_at).getTime()).toBeLessThanOrEqual(Date.now());
    });
  });

  describe("getUnresolvedError", () => {
    it("should return the latest unresolved error for a workflow", async () => {
      const now = Date.now();
      const notifications = [
        {
          id: "notif-1",
          workflow_id: "workflow-1",
          type: "error" as const,
          payload: JSON.stringify({ message: "Old error" }),
          timestamp: new Date(now - 1000).toISOString(),
          acknowledged_at: "",
          resolved_at: "",
          workflow_title: "Workflow 1",
        },
        {
          id: "notif-2",
          workflow_id: "workflow-1",
          type: "error" as const,
          payload: JSON.stringify({ message: "Latest error" }),
          timestamp: new Date(now).toISOString(),
          acknowledged_at: "",
          resolved_at: "",
          workflow_title: "Workflow 1",
        },
        {
          id: "notif-3",
          workflow_id: "workflow-1",
          type: "error" as const,
          payload: JSON.stringify({ message: "Resolved error" }),
          timestamp: new Date(now + 1000).toISOString(),
          acknowledged_at: "",
          resolved_at: new Date().toISOString(),
          workflow_title: "Workflow 1",
        },
      ];

      for (const n of notifications) {
        await notificationStore.saveNotification(n);
      }

      const result = await notificationStore.getUnresolvedError("workflow-1");
      expect(result?.id).toBe("notif-2");
      expect(JSON.parse(result!.payload).message).toBe("Latest error");
    });

    it("should return null when no unresolved errors exist", async () => {
      await notificationStore.saveNotification({
        id: "notif-1",
        workflow_id: "workflow-1",
        type: "error" as const,
        payload: "{}",
        timestamp: new Date().toISOString(),
        acknowledged_at: "",
        resolved_at: new Date().toISOString(),
        workflow_title: "Workflow 1",
      });

      const result = await notificationStore.getUnresolvedError("workflow-1");
      expect(result).toBeNull();
    });

    it("should not return escalated or script_message as errors", async () => {
      await notificationStore.saveNotification({
        id: "notif-1",
        workflow_id: "workflow-1",
        type: "escalated" as const,
        payload: "{}",
        timestamp: new Date().toISOString(),
        acknowledged_at: "",
        resolved_at: "",
        workflow_title: "Workflow 1",
      });

      const result = await notificationStore.getUnresolvedError("workflow-1");
      expect(result).toBeNull();
    });
  });

  describe("countUnresolved", () => {
    it("should count all unresolved notifications", async () => {
      const notifications = [
        {
          id: "notif-1",
          workflow_id: "workflow-1",
          type: "error" as const,
          payload: "{}",
          timestamp: new Date().toISOString(),
          acknowledged_at: "",
          resolved_at: "",
          workflow_title: "Workflow 1",
        },
        {
          id: "notif-2",
          workflow_id: "workflow-2",
          type: "escalated" as const,
          payload: "{}",
          timestamp: new Date().toISOString(),
          acknowledged_at: "",
          resolved_at: "",
          workflow_title: "Workflow 2",
        },
        {
          id: "notif-3",
          workflow_id: "workflow-1",
          type: "error" as const,
          payload: "{}",
          timestamp: new Date().toISOString(),
          acknowledged_at: "",
          resolved_at: new Date().toISOString(),
          workflow_title: "Workflow 1",
        },
      ];

      for (const n of notifications) {
        await notificationStore.saveNotification(n);
      }

      const count = await notificationStore.countUnresolved();
      expect(count).toBe(2);
    });

    it("should count unresolved notifications for specific workflow", async () => {
      const notifications = [
        {
          id: "notif-1",
          workflow_id: "workflow-1",
          type: "error" as const,
          payload: "{}",
          timestamp: new Date().toISOString(),
          acknowledged_at: "",
          resolved_at: "",
          workflow_title: "Workflow 1",
        },
        {
          id: "notif-2",
          workflow_id: "workflow-2",
          type: "error" as const,
          payload: "{}",
          timestamp: new Date().toISOString(),
          acknowledged_at: "",
          resolved_at: "",
          workflow_title: "Workflow 2",
        },
      ];

      for (const n of notifications) {
        await notificationStore.saveNotification(n);
      }

      const count = await notificationStore.countUnresolved("workflow-1");
      expect(count).toBe(1);
    });
  });

  describe("getUnresolvedNotifications", () => {
    it("should return count and list of unresolved notifications", async () => {
      for (let i = 0; i < 15; i++) {
        await notificationStore.saveNotification({
          id: `notif-${i}`,
          workflow_id: "workflow-1",
          type: "error" as const,
          payload: "{}",
          timestamp: new Date(Date.now() + i).toISOString(),
          acknowledged_at: "",
          resolved_at: i % 2 === 0 ? "" : new Date().toISOString(),
          workflow_title: "Workflow 1",
        });
      }

      const result = await notificationStore.getUnresolvedNotifications(5);
      expect(result.count).toBe(8); // Half are unresolved (0, 2, 4, 6, 8, 10, 12, 14)
      expect(result.notifications).toHaveLength(5); // Limited to 5
    });
  });
});
