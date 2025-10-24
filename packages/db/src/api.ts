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
}
