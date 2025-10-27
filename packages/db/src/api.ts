import { AssistantUIMessage } from "@app/proto";
import { ChatStore } from "./chat-store";
import { KeepDb } from "./database";
import { MemoryStore, Thread } from "./memory-store";
import { NoteStore } from "./note-store";
import { TaskStore } from "./task-store";
import { bytesToHex } from "@noble/ciphers/utils";
import { randomBytes } from "@noble/ciphers/crypto";

export class KeepDbApi {
  #db: KeepDb;
  #userId: string;
  #memoryStore: MemoryStore;
  #chatStore: ChatStore;
  #noteStore: NoteStore;
  #taskStore: TaskStore;

  constructor(db: KeepDb, userId: string) {
    this.#db = db;
    this.#userId = userId;
    this.#memoryStore = new MemoryStore(db, userId);
    this.#chatStore = new ChatStore(db, userId);
    this.#noteStore = new NoteStore(db, userId);
    this.#taskStore = new TaskStore(db, userId);
  }

  get db() {
    return this.#db;
  }
  get userId() {
    return this.#userId;
  }
  get memoryStore() {
    return this.#memoryStore;
  }
  get chatStore() {
    return this.#chatStore;
  }
  get noteStore() {
    return this.#noteStore;
  }
  get taskStore() {
    return this.#taskStore;
  }

  async addMessage(input: {
    threadId: string;
    content: string;
    role?: "user" | "assistant"; // default = user
  }): Promise<AssistantUIMessage> {
    const now = new Date();
    const role = input.role || "user";
    const chatId = input.threadId; // Reuse threadId as chatId
    
    // First ensure the thread exists
    const existingThread = await this.memoryStore.getThread(input.threadId);
    if (!existingThread) {
      const newThread: Thread = {
        id: input.threadId,
        title: input.threadId,
        user_id: this.userId,
        created_at: now,
        updated_at: now,
        metadata: {},
      };
      await this.memoryStore.saveThread(newThread);
    }

    // Create the message in AssistantUIMessage format
    const message: AssistantUIMessage = {
      id: bytesToHex(randomBytes(16)),
      role,
      parts: [{ type: "text", text: input.content }],
      metadata: {
        threadId: input.threadId,
        userId: this.userId,
        createdAt: now.toISOString(),
      },
    };

    // Save the message
    await this.memoryStore.saveMessages([message]);

    // Ensure Chat object exists with threadId reused as chatId
    const existingChat = await this.chatStore.getChat(chatId);
    if (existingChat) {
      // Update existing chat
      await this.chatStore.updateChat({ chatId, updatedAt: now });
    } else {
      // Create new chat
      await this.chatStore.createChat({ chatId, message });
    }

    // Create task for agent to process the user message
    if (role === "user") {
      // Create task with type='message' and message_id in 'task' field
      const taskId = bytesToHex(randomBytes(16));
      const timestamp = Math.floor(Date.now() / 1000);
      await this.taskStore.addTask(
        taskId,
        timestamp,
        message.id, // message_id placed into 'task' field
        "message", // type='message'
        input.threadId,
        "", // title
        "" // cron
      );
    }

    return message;
  }

  async getNewAssistantMessages(): Promise<AssistantUIMessage[]> {
    const sql = `
      SELECT m.*
      FROM messages AS m
      JOIN chats AS c ON c.id = m.thread_id
      WHERE (c.read_at IS NULL OR m.created_at > c.read_at) AND m.role = 'assistant'
      ORDER BY m.created_at
    `;
    
    const result = await this.#db.db.execO<Record<string, unknown>>(sql);
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
}
