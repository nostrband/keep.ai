import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DBInterface, KeepDb, ChatStore, ChatMessage } from "@app/db";
import { createDBNode } from "@app/node";

/**
 * Helper to create chat_messages table without full migration system.
 * This allows testing the store in isolation without CR-SQLite dependencies.
 */
async function createChatMessagesTable(db: DBInterface): Promise<void> {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS chat_messages (
      id TEXT PRIMARY KEY NOT NULL,
      chat_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      task_run_id TEXT NOT NULL DEFAULT '',
      script_id TEXT NOT NULL DEFAULT '',
      failed_script_run_id TEXT NOT NULL DEFAULT ''
    )
  `);
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_chat_messages_chat_id ON chat_messages(chat_id)`);
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_chat_messages_timestamp ON chat_messages(timestamp)`);
}

/**
 * Helper to create chats table without full migration system.
 */
async function createChatsTable(db: DBInterface): Promise<void> {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS chats (
      id TEXT PRIMARY KEY NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      read_at TEXT,
      first_message_content TEXT,
      first_message_time TEXT,
      workflow_id TEXT NOT NULL DEFAULT ''
    )
  `);
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_chats_workflow_id ON chats(workflow_id)`);
}

/**
 * Helper to create chat_events table for backwards compatibility tests.
 */
async function createChatEventsTable(db: DBInterface): Promise<void> {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS chat_events (
      id TEXT PRIMARY KEY NOT NULL,
      chat_id TEXT NOT NULL,
      type TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      content TEXT NOT NULL
    )
  `);
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_chat_events_chat_id ON chat_events(chat_id)`);
}

describe("ChatStore", () => {
  let db: DBInterface;
  let keepDb: KeepDb;
  let chatStore: ChatStore;

  beforeEach(async () => {
    db = await createDBNode(":memory:");
    keepDb = new KeepDb(db);
    // Create tables manually instead of running full migrations
    await createChatMessagesTable(db);
    await createChatsTable(db);
    await createChatEventsTable(db);
    chatStore = new ChatStore(keepDb);
  });

  afterEach(async () => {
    if (db) {
      await db.close();
    }
  });

  // ============================================================
  // Chat Messages Tests (Spec 12 - new chat_messages table)
  // ============================================================

  describe("saveChatMessage and getNewChatMessages", () => {
    it("should save and retrieve a chat message", async () => {
      const message: ChatMessage = {
        id: "msg-1",
        chat_id: "chat-1",
        role: "user",
        content: JSON.stringify({ parts: [{ type: "text", text: "Hello" }] }),
        timestamp: new Date().toISOString(),
        task_run_id: "",
        script_id: "",
        failed_script_run_id: "",
      };

      await chatStore.saveChatMessage(message);
      const messages = await chatStore.getNewChatMessages({ chatId: "chat-1" });

      expect(messages).toHaveLength(1);
      expect(messages[0]).toEqual(message);
    });

    it("should save message with all metadata fields", async () => {
      const message: ChatMessage = {
        id: "msg-1",
        chat_id: "chat-1",
        role: "assistant",
        content: JSON.stringify({ parts: [{ type: "text", text: "I updated the script" }] }),
        timestamp: new Date().toISOString(),
        task_run_id: "task-run-1",
        script_id: "script-1",
        failed_script_run_id: "failed-run-1",
      };

      await chatStore.saveChatMessage(message);
      const result = await chatStore.getChatMessageById("msg-1");

      expect(result).not.toBeNull();
      expect(result?.task_run_id).toBe("task-run-1");
      expect(result?.script_id).toBe("script-1");
      expect(result?.failed_script_run_id).toBe("failed-run-1");
    });

    it("should return messages in ascending order by timestamp", async () => {
      const now = Date.now();
      const messages: ChatMessage[] = [
        {
          id: "msg-3",
          chat_id: "chat-1",
          role: "assistant",
          content: "Third",
          timestamp: new Date(now + 2000).toISOString(),
          task_run_id: "",
          script_id: "",
          failed_script_run_id: "",
        },
        {
          id: "msg-1",
          chat_id: "chat-1",
          role: "user",
          content: "First",
          timestamp: new Date(now).toISOString(),
          task_run_id: "",
          script_id: "",
          failed_script_run_id: "",
        },
        {
          id: "msg-2",
          chat_id: "chat-1",
          role: "assistant",
          content: "Second",
          timestamp: new Date(now + 1000).toISOString(),
          task_run_id: "",
          script_id: "",
          failed_script_run_id: "",
        },
      ];

      // Insert in non-chronological order
      for (const m of messages) {
        await chatStore.saveChatMessage(m);
      }

      const results = await chatStore.getNewChatMessages({ chatId: "chat-1" });

      expect(results).toHaveLength(3);
      // Should be sorted ASC for display
      expect(results[0].id).toBe("msg-1");
      expect(results[1].id).toBe("msg-2");
      expect(results[2].id).toBe("msg-3");
    });

    it("should filter messages by chat_id", async () => {
      const messages: ChatMessage[] = [
        {
          id: "msg-1",
          chat_id: "chat-1",
          role: "user",
          content: "Hello from chat 1",
          timestamp: new Date().toISOString(),
          task_run_id: "",
          script_id: "",
          failed_script_run_id: "",
        },
        {
          id: "msg-2",
          chat_id: "chat-2",
          role: "user",
          content: "Hello from chat 2",
          timestamp: new Date().toISOString(),
          task_run_id: "",
          script_id: "",
          failed_script_run_id: "",
        },
      ];

      for (const m of messages) {
        await chatStore.saveChatMessage(m);
      }

      const results = await chatStore.getNewChatMessages({ chatId: "chat-1" });

      expect(results).toHaveLength(1);
      expect(results[0].id).toBe("msg-1");
    });

    it("should filter messages with since timestamp", async () => {
      const now = Date.now();
      const cutoff = new Date(now + 1000).toISOString();

      const messages: ChatMessage[] = [
        {
          id: "msg-1",
          chat_id: "chat-1",
          role: "user",
          content: "Old message",
          timestamp: new Date(now).toISOString(),
          task_run_id: "",
          script_id: "",
          failed_script_run_id: "",
        },
        {
          id: "msg-2",
          chat_id: "chat-1",
          role: "assistant",
          content: "New message",
          timestamp: new Date(now + 2000).toISOString(),
          task_run_id: "",
          script_id: "",
          failed_script_run_id: "",
        },
      ];

      for (const m of messages) {
        await chatStore.saveChatMessage(m);
      }

      const results = await chatStore.getNewChatMessages({
        chatId: "chat-1",
        since: cutoff,
      });

      expect(results).toHaveLength(1);
      expect(results[0].id).toBe("msg-2");
    });

    it("should filter messages with before timestamp", async () => {
      const now = Date.now();
      const cutoff = new Date(now + 1000).toISOString();

      const messages: ChatMessage[] = [
        {
          id: "msg-1",
          chat_id: "chat-1",
          role: "user",
          content: "Old message",
          timestamp: new Date(now).toISOString(),
          task_run_id: "",
          script_id: "",
          failed_script_run_id: "",
        },
        {
          id: "msg-2",
          chat_id: "chat-1",
          role: "assistant",
          content: "New message",
          timestamp: new Date(now + 2000).toISOString(),
          task_run_id: "",
          script_id: "",
          failed_script_run_id: "",
        },
      ];

      for (const m of messages) {
        await chatStore.saveChatMessage(m);
      }

      const results = await chatStore.getNewChatMessages({
        chatId: "chat-1",
        before: cutoff,
      });

      expect(results).toHaveLength(1);
      expect(results[0].id).toBe("msg-1");
    });

    it("should limit the number of results", async () => {
      for (let i = 0; i < 10; i++) {
        await chatStore.saveChatMessage({
          id: `msg-${i}`,
          chat_id: "chat-1",
          role: "user",
          content: `Message ${i}`,
          timestamp: new Date(Date.now() + i * 1000).toISOString(),
          task_run_id: "",
          script_id: "",
          failed_script_run_id: "",
        });
      }

      const results = await chatStore.getNewChatMessages({
        chatId: "chat-1",
        limit: 5,
      });

      expect(results).toHaveLength(5);
      // Should get the LATEST 5, sorted ASC (msg-5 through msg-9)
      expect(results[0].id).toBe("msg-5");
      expect(results[4].id).toBe("msg-9");
    });

    it("should handle empty metadata fields with defaults", async () => {
      const message: ChatMessage = {
        id: "msg-1",
        chat_id: "chat-1",
        role: "user",
        content: "Hello",
        timestamp: new Date().toISOString(),
        task_run_id: "",
        script_id: "",
        failed_script_run_id: "",
      };

      await chatStore.saveChatMessage(message);
      const result = await chatStore.getChatMessageById("msg-1");

      expect(result?.task_run_id).toBe("");
      expect(result?.script_id).toBe("");
      expect(result?.failed_script_run_id).toBe("");
    });
  });

  describe("getChatMessageById", () => {
    it("should return a single message by id", async () => {
      const message: ChatMessage = {
        id: "msg-1",
        chat_id: "chat-1",
        role: "assistant",
        content: JSON.stringify({ parts: [{ type: "text", text: "Test" }] }),
        timestamp: new Date().toISOString(),
        task_run_id: "task-1",
        script_id: "",
        failed_script_run_id: "",
      };

      await chatStore.saveChatMessage(message);
      const result = await chatStore.getChatMessageById("msg-1");

      expect(result).toEqual(message);
    });

    it("should return null for non-existent message", async () => {
      const result = await chatStore.getChatMessageById("non-existent");
      expect(result).toBeNull();
    });
  });

  describe("countNewMessages", () => {
    it("should count all messages when no chatId provided", async () => {
      const messages: ChatMessage[] = [
        {
          id: "msg-1",
          chat_id: "chat-1",
          role: "user",
          content: "Message 1",
          timestamp: new Date().toISOString(),
          task_run_id: "",
          script_id: "",
          failed_script_run_id: "",
        },
        {
          id: "msg-2",
          chat_id: "chat-2",
          role: "user",
          content: "Message 2",
          timestamp: new Date().toISOString(),
          task_run_id: "",
          script_id: "",
          failed_script_run_id: "",
        },
        {
          id: "msg-3",
          chat_id: "chat-1",
          role: "assistant",
          content: "Message 3",
          timestamp: new Date().toISOString(),
          task_run_id: "",
          script_id: "",
          failed_script_run_id: "",
        },
      ];

      for (const m of messages) {
        await chatStore.saveChatMessage(m);
      }

      const count = await chatStore.countNewMessages();
      expect(count).toBe(3);
    });

    it("should count messages for specific chat", async () => {
      const messages: ChatMessage[] = [
        {
          id: "msg-1",
          chat_id: "chat-1",
          role: "user",
          content: "Message 1",
          timestamp: new Date().toISOString(),
          task_run_id: "",
          script_id: "",
          failed_script_run_id: "",
        },
        {
          id: "msg-2",
          chat_id: "chat-2",
          role: "user",
          content: "Message 2",
          timestamp: new Date().toISOString(),
          task_run_id: "",
          script_id: "",
          failed_script_run_id: "",
        },
        {
          id: "msg-3",
          chat_id: "chat-1",
          role: "assistant",
          content: "Message 3",
          timestamp: new Date().toISOString(),
          task_run_id: "",
          script_id: "",
          failed_script_run_id: "",
        },
      ];

      for (const m of messages) {
        await chatStore.saveChatMessage(m);
      }

      const count = await chatStore.countNewMessages("chat-1");
      expect(count).toBe(2);
    });

    it("should return 0 when no messages exist", async () => {
      const count = await chatStore.countNewMessages("non-existent");
      expect(count).toBe(0);
    });
  });

  describe("getLastMessageActivity", () => {
    it("should return the timestamp of the most recent message", async () => {
      const now = Date.now();
      const timestamps = [now, now + 1000, now + 2000];

      for (let i = 0; i < timestamps.length; i++) {
        await chatStore.saveChatMessage({
          id: `msg-${i}`,
          chat_id: "chat-1",
          role: "user",
          content: `Message ${i}`,
          timestamp: new Date(timestamps[i]).toISOString(),
          task_run_id: "",
          script_id: "",
          failed_script_run_id: "",
        });
      }

      const lastActivity = await chatStore.getLastMessageActivity("chat-1");
      expect(lastActivity).toBe(new Date(now + 2000).toISOString());
    });

    it("should return null when chat has no messages", async () => {
      const lastActivity = await chatStore.getLastMessageActivity("non-existent");
      expect(lastActivity).toBeNull();
    });
  });

  // ============================================================
  // Chats Table Tests
  // ============================================================

  describe("createChat and getChat", () => {
    it("should create and retrieve a chat", async () => {
      await chatStore.createChat({
        chatId: "chat-1",
        message: {
          id: "msg-1",
          role: "user",
          parts: [{ type: "text", text: "Hello world" }],
          metadata: { createdAt: new Date().toISOString() },
        },
        workflowId: "workflow-1",
      });

      const chat = await chatStore.getChat("chat-1");

      expect(chat).not.toBeNull();
      expect(chat?.id).toBe("chat-1");
      expect(chat?.workflow_id).toBe("workflow-1");
      expect(chat?.first_message_content).toBe("Hello world");
    });

    it("should create chat without workflowId", async () => {
      await chatStore.createChat({
        chatId: "chat-1",
        message: {
          id: "msg-1",
          role: "user",
          parts: [{ type: "text", text: "Hello" }],
          metadata: { createdAt: new Date().toISOString() },
        },
      });

      const chat = await chatStore.getChat("chat-1");

      expect(chat).not.toBeNull();
      expect(chat?.workflow_id).toBe("");
    });

    it("should return null for non-existent chat", async () => {
      const chat = await chatStore.getChat("non-existent");
      expect(chat).toBeNull();
    });
  });

  describe("getChatByWorkflowId", () => {
    it("should return chat by workflow_id", async () => {
      await chatStore.createChat({
        chatId: "chat-1",
        message: {
          id: "msg-1",
          role: "user",
          parts: [{ type: "text", text: "Hello" }],
          metadata: { createdAt: new Date().toISOString() },
        },
        workflowId: "workflow-1",
      });

      const chat = await chatStore.getChatByWorkflowId("workflow-1");

      expect(chat).not.toBeNull();
      expect(chat?.id).toBe("chat-1");
      expect(chat?.workflow_id).toBe("workflow-1");
    });

    it("should return null when workflow has no chat", async () => {
      const chat = await chatStore.getChatByWorkflowId("non-existent");
      expect(chat).toBeNull();
    });
  });

  describe("updateChat", () => {
    it("should update the updated_at timestamp", async () => {
      await chatStore.createChat({
        chatId: "chat-1",
        message: {
          id: "msg-1",
          role: "user",
          parts: [{ type: "text", text: "Hello" }],
          metadata: { createdAt: new Date().toISOString() },
        },
      });

      const originalChat = await chatStore.getChat("chat-1");
      const newDate = new Date(Date.now() + 60000);

      await chatStore.updateChat({ chatId: "chat-1", updatedAt: newDate });
      const updatedChat = await chatStore.getChat("chat-1");

      expect(updatedChat?.updated_at).toBe(newDate.toISOString());
      expect(updatedChat?.updated_at).not.toBe(originalChat?.updated_at);
    });
  });

  describe("deleteChat", () => {
    it("should delete a chat", async () => {
      await chatStore.createChat({
        chatId: "chat-1",
        message: {
          id: "msg-1",
          role: "user",
          parts: [{ type: "text", text: "Hello" }],
          metadata: { createdAt: new Date().toISOString() },
        },
      });

      await chatStore.deleteChat({ chatId: "chat-1" });
      const chat = await chatStore.getChat("chat-1");

      expect(chat).toBeNull();
    });
  });

  describe("readChat", () => {
    it("should update the read_at timestamp", async () => {
      await chatStore.createChat({
        chatId: "chat-1",
        message: {
          id: "msg-1",
          role: "user",
          parts: [{ type: "text", text: "Hello" }],
          metadata: { createdAt: new Date().toISOString() },
        },
      });

      const originalChat = await chatStore.getChat("chat-1");

      // Wait a bit to ensure timestamp difference
      await new Promise(resolve => setTimeout(resolve, 10));
      await chatStore.readChat("chat-1");

      const updatedChat = await chatStore.getChat("chat-1");

      expect(updatedChat?.read_at).not.toBe(originalChat?.read_at);
    });

    it("should use event timestamp if it's in the future", async () => {
      await chatStore.createChat({
        chatId: "chat-1",
        message: {
          id: "msg-1",
          role: "user",
          parts: [{ type: "text", text: "Hello" }],
          metadata: { createdAt: new Date().toISOString() },
        },
      });

      const futureTimestamp = new Date(Date.now() + 100000).toISOString();
      await chatStore.readChat("chat-1", futureTimestamp);

      const chat = await chatStore.getChat("chat-1");
      expect(chat?.read_at).toBe(futureTimestamp);
    });
  });

  describe("getAllChats", () => {
    it("should return all chats ordered by updated_at DESC", async () => {
      const now = Date.now();

      for (let i = 0; i < 3; i++) {
        await chatStore.createChat({
          chatId: `chat-${i}`,
          message: {
            id: `msg-${i}`,
            role: "user",
            parts: [{ type: "text", text: `Message ${i}` }],
            metadata: { createdAt: new Date(now + i * 1000).toISOString() },
          },
          workflowId: `workflow-${i}`,
        });
        // Update to ensure ordering
        await chatStore.updateChat({
          chatId: `chat-${i}`,
          updatedAt: new Date(now + i * 1000),
        });
      }

      const chats = await chatStore.getAllChats();

      expect(chats).toHaveLength(3);
      // Most recently updated should be first
      expect(chats[0].id).toBe("chat-2");
      expect(chats[1].id).toBe("chat-1");
      expect(chats[2].id).toBe("chat-0");
    });

    it("should include workflow_id in results", async () => {
      await chatStore.createChat({
        chatId: "chat-1",
        message: {
          id: "msg-1",
          role: "user",
          parts: [{ type: "text", text: "Hello" }],
          metadata: { createdAt: new Date().toISOString() },
        },
        workflowId: "workflow-1",
      });

      const chats = await chatStore.getAllChats();

      expect(chats).toHaveLength(1);
      expect(chats[0].workflow_id).toBe("workflow-1");
    });
  });

  // ============================================================
  // Role type tests
  // ============================================================

  describe("role type handling", () => {
    it("should correctly handle user role", async () => {
      const message: ChatMessage = {
        id: "msg-1",
        chat_id: "chat-1",
        role: "user",
        content: "Hello",
        timestamp: new Date().toISOString(),
        task_run_id: "",
        script_id: "",
        failed_script_run_id: "",
      };

      await chatStore.saveChatMessage(message);
      const result = await chatStore.getChatMessageById("msg-1");

      expect(result?.role).toBe("user");
    });

    it("should correctly handle assistant role", async () => {
      const message: ChatMessage = {
        id: "msg-1",
        chat_id: "chat-1",
        role: "assistant",
        content: "Hello",
        timestamp: new Date().toISOString(),
        task_run_id: "",
        script_id: "",
        failed_script_run_id: "",
      };

      await chatStore.saveChatMessage(message);
      const result = await chatStore.getChatMessageById("msg-1");

      expect(result?.role).toBe("assistant");
    });
  });

  // ============================================================
  // Edge cases
  // ============================================================

  describe("edge cases", () => {
    it("should handle empty chat (no messages)", async () => {
      const messages = await chatStore.getNewChatMessages({ chatId: "empty-chat" });
      expect(messages).toHaveLength(0);
    });

    it("should handle message content with special characters", async () => {
      const message: ChatMessage = {
        id: "msg-1",
        chat_id: "chat-1",
        role: "user",
        content: JSON.stringify({ text: "Hello 'world'! \"test\" <script>alert(1)</script>" }),
        timestamp: new Date().toISOString(),
        task_run_id: "",
        script_id: "",
        failed_script_run_id: "",
      };

      await chatStore.saveChatMessage(message);
      const result = await chatStore.getChatMessageById("msg-1");

      expect(result).not.toBeNull();
      expect(JSON.parse(result!.content).text).toContain("<script>");
    });

    it("should handle very long content", async () => {
      const longContent = "x".repeat(100000);
      const message: ChatMessage = {
        id: "msg-1",
        chat_id: "chat-1",
        role: "user",
        content: longContent,
        timestamp: new Date().toISOString(),
        task_run_id: "",
        script_id: "",
        failed_script_run_id: "",
      };

      await chatStore.saveChatMessage(message);
      const result = await chatStore.getChatMessageById("msg-1");

      expect(result?.content.length).toBe(100000);
    });

    it("should handle INSERT OR REPLACE correctly", async () => {
      const originalMessage: ChatMessage = {
        id: "msg-1",
        chat_id: "chat-1",
        role: "user",
        content: "Original content",
        timestamp: new Date().toISOString(),
        task_run_id: "",
        script_id: "",
        failed_script_run_id: "",
      };

      await chatStore.saveChatMessage(originalMessage);

      const updatedMessage: ChatMessage = {
        ...originalMessage,
        content: "Updated content",
        script_id: "script-1",
      };

      await chatStore.saveChatMessage(updatedMessage);

      const messages = await chatStore.getNewChatMessages({ chatId: "chat-1" });
      expect(messages).toHaveLength(1);
      expect(messages[0].content).toBe("Updated content");
      expect(messages[0].script_id).toBe("script-1");
    });
  });
});
