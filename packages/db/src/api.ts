import { AssistantUIMessage } from "@app/proto";
import { ChatStore } from "./chat-store";
import { KeepDb } from "./database";
import { MemoryStore, Thread } from "./memory-store";
import { NoteStore } from "./note-store";
import { Task, TaskStore, TaskType } from "./task-store";
import { bytesToHex } from "@noble/ciphers/utils";
import { randomBytes } from "@noble/ciphers/crypto";
import { NostrPeerStore } from "./nostr-peer-store";
import { InboxItem, InboxStore } from "./inbox-store";
import { File, FileStore } from "./file-store";
import { ScriptStore, Workflow } from "./script-store";

export class KeepDbApi {
  public readonly db: KeepDb;
  public readonly memoryStore: MemoryStore;
  public readonly chatStore: ChatStore;
  public readonly noteStore: NoteStore;
  public readonly taskStore: TaskStore;
  public readonly nostrPeerStore: NostrPeerStore;
  public readonly inboxStore: InboxStore;
  public readonly fileStore: FileStore;
  public readonly scriptStore: ScriptStore;

  constructor(db: KeepDb) {
    this.db = db;
    this.memoryStore = new MemoryStore(db);
    this.chatStore = new ChatStore(db);
    this.noteStore = new NoteStore(db);
    this.taskStore = new TaskStore(db);
    this.nostrPeerStore = new NostrPeerStore(db);
    this.inboxStore = new InboxStore(db);
    this.fileStore = new FileStore(db);
    this.scriptStore = new ScriptStore(db);
  }

  async addMessage(input: {
    chatId: string;
    content: string;
    role?: "user" | "assistant"; // default = user
    files?: File[]; // array of file paths
  }): Promise<AssistantUIMessage> {
    return await this.db.db.tx(async (tx) => {
      const now = new Date();
      const role = input.role || "user";
      const chatId = input.chatId;

      // Get taskId by chatId
      const task = await this.taskStore.getTaskByChatId(chatId, tx);
      const taskId = task?.id || "";

      // Create the message in AssistantUIMessage format
      const parts: AssistantUIMessage["parts"] = [
        { type: "text", text: input.content },
      ];

      // Add file parts if files are provided
      if (input.files && input.files.length > 0) {
        for (const file of input.files) {
          parts.push({
            type: "file",
            url: file.path,
            mediaType: file.media_type,
            filename: file.name,
          });
        }
      }

      const message: AssistantUIMessage = {
        id: bytesToHex(randomBytes(16)),
        role,
        parts,
        metadata: {
          threadId: chatId,
          createdAt: now.toISOString(),
        },
      };

      // Save the message to chat
      await this.chatStore.saveChatMessages(chatId, [message], tx);

      // Ensure Chat object exists with threadId reused as chatId
      const existingChat = await this.chatStore.getChat(chatId, tx);
      if (existingChat) {
        // Update existing chat
        await this.chatStore.updateChat({ chatId, updatedAt: now }, tx);
      } else {
        // Create new chat
        await this.chatStore.createChat({ chatId, message }, tx);
      }

      // Send to task inbox
      if (role === "user") {
        const inboxItem: InboxItem = {
          id: message.id,
          source: "user",
          source_id: message.id,
          target: chatId === "main" ? "worker" : "planner",
          target_id: taskId,
          timestamp: now.toISOString(),
          content: JSON.stringify(message),
          handler_thread_id: "",
          handler_timestamp: "",
        };
        await this.inboxStore.saveInbox(inboxItem, tx);
      }

      return message;
    });
  }

  /**
   * Get the current device's ID (cr-sqlite site_id as hex string).
   * This uniquely identifies the device/database instance and persists across restarts.
   */
  async getDeviceId(): Promise<string> {
    const result = await this.db.db.execO<{ site_id: Uint8Array }>(
      "SELECT crsql_site_id() as site_id"
    );
    if (!result || result.length === 0) {
      throw new Error("Failed to get cr-sqlite site_id");
    }
    return bytesToHex(result[0].site_id);
  }

  /**
   * @deprecated Use getNewAssistantMessagesForDevice instead for multi-device support.
   * This method uses global read_at which doesn't work properly across devices.
   */
  async getNewAssistantMessages(): Promise<AssistantUIMessage[]> {
    const sql = `
      SELECT m.*
      FROM messages AS m
      JOIN chats AS c ON c.id = m.thread_id
      WHERE (c.read_at IS NULL OR m.created_at > c.read_at) AND m.role = 'assistant'
      ORDER BY m.created_at
    `;

    const result = await this.db.db.execO<Record<string, unknown>>(sql);
    if (!result) return [];

    return result
      .filter((row) => !!row.content)
      .map((row) => {
        // Parse the full UIMessage from content field
        try {
          return JSON.parse(row.content as string) as AssistantUIMessage;
        } catch (e) {
          console.debug("Bad message in db", row, e);
          return undefined;
        }
      })
      .filter((m) => !!m)
      .filter((m) => !!m.role);
  }

  /**
   * Get new assistant messages that haven't been notified on this specific device.
   * Uses the chat_notifications table for per-device tracking instead of global read_at.
   *
   * @param deviceId - The device ID (cr-sqlite site_id in hex). If not provided, uses current device.
   */
  async getNewAssistantMessagesForDevice(deviceId?: string): Promise<AssistantUIMessage[]> {
    // Get device ID if not provided
    const device = deviceId || await this.getDeviceId();

    // Query messages that are newer than the last notification timestamp for this device.
    // LEFT JOIN to chat_notifications: if no record exists, notified_at will be NULL.
    // This means unnotified chats will be included.
    const sql = `
      SELECT m.*
      FROM messages AS m
      LEFT JOIN chat_notifications AS cn ON cn.chat_id = m.thread_id AND cn.device_id = ?
      WHERE (cn.notified_at IS NULL OR m.created_at > cn.notified_at) AND m.role = 'assistant'
      ORDER BY m.created_at
    `;

    const result = await this.db.db.execO<Record<string, unknown>>(sql, [device]);
    if (!result) return [];

    return result
      .filter((row) => !!row.content)
      .map((row) => {
        // Parse the full UIMessage from content field
        try {
          return JSON.parse(row.content as string) as AssistantUIMessage;
        } catch (e) {
          console.debug("Bad message in db", row, e);
          return undefined;
        }
      })
      .filter((m) => !!m)
      .filter((m) => !!m.role);
  }

  /**
   * Set the user's autonomy preference.
   * @param mode - 'ai_decides' or 'coordinate'
   */
  async setAutonomyMode(mode: 'ai_decides' | 'coordinate'): Promise<void> {
    const timestamp = new Date().toISOString();
    const sql = `
      INSERT OR REPLACE INTO agent_state (key, value, timestamp)
      VALUES ('autonomy_mode', ?, ?)
    `;
    await this.db.db.exec(sql, [mode, timestamp]);
  }

  /**
   * Get the user's autonomy preference.
   * Defaults to 'ai_decides' if not set.
   */
  async getAutonomyMode(): Promise<'ai_decides' | 'coordinate'> {
    const sql = `
      SELECT value FROM agent_state WHERE key = 'autonomy_mode'
    `;
    const result = await this.db.db.execO<{ value: string }>(sql);

    if (!result || result.length === 0) {
      return 'ai_decides'; // Default mode
    }

    const value = result[0].value;
    if (value === 'coordinate') {
      return 'coordinate';
    }
    return 'ai_decides';
  }

  async createTask(input: {
    content: string;
    files?: File[];
    title?: string;
  }): Promise<{ chatId: string; taskId: string }> {
    return await this.db.db.tx(async (tx) => {
      const now = new Date();
      const timestamp = Math.floor(now.getTime() / 1000); // Convert to seconds

      // Generate ids
      const taskId = bytesToHex(randomBytes(16));
      const workflowId = bytesToHex(randomBytes(16));
      const chatId = bytesToHex(randomBytes(16));

      // Create the message in AssistantUIMessage format
      const parts: AssistantUIMessage["parts"] = [
        { type: "text", text: input.content },
      ];

      // Add file parts if files are provided
      if (input.files && input.files.length > 0) {
        for (const file of input.files) {
          parts.push({
            type: "file",
            url: file.path,
            mediaType: file.media_type,
            filename: file.name,
          });
        }
      }

      const message: AssistantUIMessage = {
        id: bytesToHex(randomBytes(16)),
        role: "user",
        parts,
        metadata: {
          threadId: chatId,
          createdAt: now.toISOString(),
        },
      };

      // Create the chat with the first message
      await this.chatStore.createChat({ chatId, message }, tx);

      // Save the message to the chat
      await this.chatStore.saveChatMessages(chatId, [message], tx);

      // Task
      const task: Task = {
        id: taskId,
        timestamp,
        reply: "",
        state: "",
        thread_id: "",
        error: "",
        type: "planner",
        title: input.title || "",
        chat_id: chatId,
      };

      // Create new task with type=planner and chat_id=chatId
      await this.taskStore.addTask(
        task,
        tx // pass transaction
      );

      const workflow: Workflow = {
        id: workflowId,
        cron: "",
        events: "",
        status: "",
        task_id: taskId,
        timestamp: now.toISOString(),
        title: task.title,
        next_run_timestamp: "",
        maintenance: false,
        maintenance_fix_count: 0,
        active_script_id: "",  // No active script yet, will be set when first script is saved
      };

      // Create the matching workflow
      await this.scriptStore.addWorkflow(
        workflow,
        tx // pass transaction
      );

      // Send message to the new task's inbox
      const inboxItem: InboxItem = {
        id: message.id,
        source: "user",
        source_id: message.id,
        target: task.type as TaskType,
        target_id: task.id,
        timestamp: now.toISOString(),
        content: JSON.stringify(message),
        handler_thread_id: "",
        handler_timestamp: "",
      };
      await this.inboxStore.saveInbox(inboxItem, tx);

      return { chatId, taskId };
    });
  }
}
