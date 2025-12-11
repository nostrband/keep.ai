import { AssistantUIMessage } from "@app/proto";
import { ChatStore } from "./chat-store";
import { KeepDb } from "./database";
import { MemoryStore, Thread } from "./memory-store";
import { NoteStore } from "./note-store";
import { TaskStore } from "./task-store";
import { bytesToHex } from "@noble/ciphers/utils";
import { randomBytes } from "@noble/ciphers/crypto";
import { NostrPeerStore } from "./nostr-peer-store";
import { InboxItem, InboxStore } from "./inbox-store";
import { FileStore } from "./file-store";

export const MAX_STATUS_TTL = 60 * 1000; // 1 minute in milliseconds

export class KeepDbApi {
  public readonly db: KeepDb;
  public readonly memoryStore: MemoryStore;
  public readonly chatStore: ChatStore;
  public readonly noteStore: NoteStore;
  public readonly taskStore: TaskStore;
  public readonly nostrPeerStore: NostrPeerStore;
  public readonly inboxStore: InboxStore;
  public readonly fileStore: FileStore;

  constructor(db: KeepDb) {
    this.db = db;
    this.memoryStore = new MemoryStore(db);
    this.chatStore = new ChatStore(db);
    this.noteStore = new NoteStore(db);
    this.taskStore = new TaskStore(db);
    this.nostrPeerStore = new NostrPeerStore(db);
    this.inboxStore = new InboxStore(db);
    this.fileStore = new FileStore(db);
  }

  async addMessage(input: {
    threadId: string;
    content: string;
    role?: "user" | "assistant"; // default = user
  }): Promise<AssistantUIMessage> {
    return await this.db.db.tx(async (tx) => {
      const now = new Date();
      const role = input.role || "user";
      const chatId = input.threadId; // Reuse threadId as chatId

      // First ensure the thread exists
      const existingThread = await this.memoryStore.getThread(
        input.threadId,
        tx
      );
      if (!existingThread) {
        const newThread: Thread = {
          id: input.threadId,
          title: input.threadId,
          created_at: now,
          updated_at: now,
          metadata: {},
        };
        await this.memoryStore.saveThread(newThread, tx);
      }

      // Create the message in AssistantUIMessage format
      const message: AssistantUIMessage = {
        id: bytesToHex(randomBytes(16)),
        role,
        parts: [{ type: "text", text: input.content }],
        metadata: {
          threadId: input.threadId,
          createdAt: now.toISOString(),
        },
      };

      // Save the message to both tables
      await this.memoryStore.saveMessages([message], tx);
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

      // Create task for agent to process the user message
      if (role === "user") {
        const inboxItem: InboxItem = {
          id: message.id,
          source: "user",
          source_id: message.id,
          target: "router",
          target_id: "",
          // FIXME Since we added 'postponing' to inbox,
          // worker started delaying tasks due to clock drift
          // across devices. We should add created_at timestamp
          // to track when item was created, and use timestamp
          // for postponing
          timestamp: "", // for now, make it empty to ensure worker starts immediately
          content: JSON.stringify(message),
          handler_thread_id: "",
          handler_timestamp: "",
        };
        await this.inboxStore.saveInbox(inboxItem, tx);
      }

      return message;
    });
  }

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

  async setAgentStatus(value: string): Promise<void> {
    const timestamp = new Date().toISOString();
    const sql = `
      INSERT OR REPLACE INTO agent_state (key, value, timestamp)
      VALUES ('status', ?, ?)
    `;
    await this.db.db.exec(sql, [value, timestamp]);
  }

  async getAgentStatus(): Promise<string> {
    const sql = `
      SELECT value, timestamp FROM agent_state WHERE key = 'status'
    `;
    const result = await this.db.db.execO<{ value: string; timestamp: string }>(
      sql
    );

    if (!result || result.length === 0) {
      return "";
    }

    const row = result[0];
    const timestampMs = new Date(row.timestamp).getTime();
    const nowMs = Date.now();

    // Check if timestamp is older than MAX_STATUS_TTL (1 minute)
    if (nowMs - timestampMs > MAX_STATUS_TTL) {
      return "";
    }

    return row.value;
  }
}
