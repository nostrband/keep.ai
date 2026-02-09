import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  DBInterface,
  KeepDb,
  KeepDbApi,
  NotificationStore,
  ChatStore,
} from "@app/db";
import { createDBNode } from "@app/node";
import { makeUserSendTool, type UserSendContext } from "@app/agent";

/**
 * Helper to create notifications and chat_messages tables without full migration system.
 */
async function createUserSendTables(db: DBInterface): Promise<void> {
  // notifications table (v30)
  await db.exec(`
    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY NOT NULL,
      workflow_id TEXT NOT NULL DEFAULT '',
      type TEXT NOT NULL DEFAULT '',
      payload TEXT NOT NULL DEFAULT '',
      timestamp TEXT NOT NULL DEFAULT '',
      acknowledged_at TEXT NOT NULL DEFAULT '',
      resolved_at TEXT NOT NULL DEFAULT '',
      workflow_title TEXT NOT NULL DEFAULT ''
    )
  `);
  await db.exec(
    `CREATE INDEX IF NOT EXISTS idx_notifications_workflow_id ON notifications(workflow_id)`
  );

  // chat_messages table (v30)
  await db.exec(`
    CREATE TABLE IF NOT EXISTS chat_messages (
      id TEXT PRIMARY KEY NOT NULL,
      chat_id TEXT NOT NULL DEFAULT '',
      role TEXT NOT NULL DEFAULT '',
      content TEXT NOT NULL DEFAULT '',
      timestamp TEXT NOT NULL DEFAULT '',
      task_run_id TEXT NOT NULL DEFAULT '',
      script_id TEXT NOT NULL DEFAULT '',
      failed_script_run_id TEXT NOT NULL DEFAULT ''
    )
  `);
  await db.exec(
    `CREATE INDEX IF NOT EXISTS idx_chat_messages_chat_id ON chat_messages(chat_id)`
  );
}

describe("User Send Tool", () => {
  let db: DBInterface;
  let keepDb: KeepDb;
  let notificationStore: NotificationStore;
  let chatStore: ChatStore;
  let api: KeepDbApi;

  beforeEach(async () => {
    db = await createDBNode(":memory:");
    keepDb = new KeepDb(db);
    await createUserSendTables(db);
    notificationStore = new NotificationStore(keepDb);
    chatStore = new ChatStore(keepDb);
    // Create a partial KeepDbApi with just the stores we need
    api = { notificationStore, chatStore } as unknown as KeepDbApi;
  });

  afterEach(async () => {
    if (db) await db.close();
  });

  describe("with workflow context", () => {
    it("should create a notification", async () => {
      const context: UserSendContext = {
        workflowId: "wf-1",
        workflowTitle: "My Workflow",
        scriptRunId: "run-1",
      };

      const tool = makeUserSendTool(api, context);
      const result = await tool.execute!({ message: "Task completed successfully" });

      expect(result.success).toBe(true);
      expect(result.id).toBeTruthy();

      // Verify notification was saved
      const notifications = await notificationStore.getNotifications();
      expect(notifications).toHaveLength(1);
      expect(notifications[0].workflow_id).toBe("wf-1");
      expect(notifications[0].type).toBe("script_message");
      expect(notifications[0].workflow_title).toBe("My Workflow");

      const payload = JSON.parse(notifications[0].payload);
      expect(payload.message).toBe("Task completed successfully");
      expect(payload.script_run_id).toBe("run-1");
    });

    it("should handle missing scriptRunId", async () => {
      const context: UserSendContext = {
        workflowId: "wf-1",
        workflowTitle: "My Workflow",
      };

      const tool = makeUserSendTool(api, context);
      const result = await tool.execute!({ message: "Hello" });

      expect(result.success).toBe(true);

      const notifications = await notificationStore.getNotifications();
      expect(notifications).toHaveLength(1);
      const payload = JSON.parse(notifications[0].payload);
      expect(payload.script_run_id).toBe("");
    });

    it("should handle missing workflowTitle", async () => {
      const context: UserSendContext = {
        workflowId: "wf-1",
      };

      const tool = makeUserSendTool(api, context);
      const result = await tool.execute!({ message: "Hello" });

      expect(result.success).toBe(true);

      const notifications = await notificationStore.getNotifications();
      expect(notifications[0].workflow_title).toBe("");
    });
  });

  describe("without workflow context (fallback to chat)", () => {
    it("should create a chat message", async () => {
      const tool = makeUserSendTool(api);
      const result = await tool.execute!({ message: "Direct message to user" });

      expect(result.success).toBe(true);
      expect(result.id).toBeTruthy();

      // Verify chat message was saved (not a notification)
      const notifications = await notificationStore.getNotifications();
      expect(notifications).toHaveLength(0);

      // Verify via getChatMessageById
      const message = await chatStore.getChatMessageById(result.id);
      expect(message).not.toBeNull();
      expect(message!.role).toBe("assistant");
      expect(message!.chat_id).toBe("main");

      const content = JSON.parse(message!.content);
      expect(content.parts[0].text).toBe("Direct message to user");
    });

    it("should create a chat message with empty context", async () => {
      const context: UserSendContext = {};

      const tool = makeUserSendTool(api, context);
      const result = await tool.execute!({ message: "No workflow ID" });

      expect(result.success).toBe(true);

      // No workflowId means fallback to chat
      const notifications = await notificationStore.getNotifications();
      expect(notifications).toHaveLength(0);

      // Verify chat message was created
      const message = await chatStore.getChatMessageById(result.id);
      expect(message).not.toBeNull();
    });
  });

  describe("message handling", () => {
    it("should handle empty message", async () => {
      const tool = makeUserSendTool(api);
      const result = await tool.execute!({ message: "" });

      expect(result.success).toBe(true);
    });

    it("should handle long messages", async () => {
      const longMessage = "x".repeat(10000);
      const context: UserSendContext = { workflowId: "wf-1" };

      const tool = makeUserSendTool(api, context);
      const result = await tool.execute!({ message: longMessage });

      expect(result.success).toBe(true);

      const notifications = await notificationStore.getNotifications();
      const payload = JSON.parse(notifications[0].payload);
      expect(payload.message).toBe(longMessage);
    });

    it("should handle special characters in messages", async () => {
      const specialMessage = 'He said "hello" & she said \'goodbye\'\n<b>HTML</b>';
      const context: UserSendContext = { workflowId: "wf-1" };

      const tool = makeUserSendTool(api, context);
      const result = await tool.execute!({ message: specialMessage });

      expect(result.success).toBe(true);

      const notifications = await notificationStore.getNotifications();
      const payload = JSON.parse(notifications[0].payload);
      expect(payload.message).toBe(specialMessage);
    });

    it("should generate unique IDs for each call", async () => {
      const tool = makeUserSendTool(api);

      const result1 = await tool.execute!({ message: "msg 1" });
      const result2 = await tool.execute!({ message: "msg 2" });

      expect(result1.id).not.toBe(result2.id);
    });
  });
});
