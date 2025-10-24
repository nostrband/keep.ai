import { generateId } from "ai";
import { CRSqliteDB } from "./database";
import { AssistantUIMessage } from "@app/proto";
import debug from "debug";

const debugChatStore = debug("db:chat-store");

export class ChatStore {
  private db: CRSqliteDB;
  private user_id: string;

  constructor(db: CRSqliteDB, user_id: string) {
    this.db = db;
    this.user_id = user_id;
  }

  // Create a new chat ID (but don't save to DB yet - only when first message is sent)
  async createChatId(): Promise<string> {
    const id = generateId();
    // Don't write chats to db until first message is sent
    return id;
  }

  // Save chat info when messages are sent (creates/updates chat entry)
  async createChat(opts: {
    chatId: string;
    message: AssistantUIMessage;
  }): Promise<void> {
    const { chatId, message: firstMessage } = opts;

    if (!firstMessage) return;

    const firstMessageContent = firstMessage.parts
      .filter((part) => part.type === "text")
      .map((part) => part.text)
      .join("");

    // Create new chat with first message info
    const now = new Date().toISOString();
    await this.db.db.exec(
      `INSERT INTO chats (id, user_id, first_message_content, first_message_time, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?)`,
      [chatId, this.user_id, firstMessageContent, now, now, now]
    );
  }

  // Update chat info when new messages are sent
  async updateChat(opts: { chatId: string; updatedAt: Date }): Promise<void> {
    const { chatId, updatedAt } = opts;

    // Update existing chat
    const result = await this.db.db.exec(
      `UPDATE chats
          SET updated_at = ?
          WHERE id = ? AND user_id = ?`,
      [updatedAt.toISOString(), chatId, this.user_id]
    );

    // Note: cr-sqlite exec doesn't return changes count like better-sqlite3
    // We'll assume the operation succeeded if no error was thrown
  }

  // Delete chat
  async deleteChat(opts: { chatId: string }): Promise<void> {
    const { chatId } = opts;

    // Delete existing chat
    await this.db.db.exec(
      `DELETE FROM chats
          WHERE id = ? AND user_id = ?`,
      [chatId, this.user_id]
    );

    // Note: cr-sqlite exec doesn't return changes count like better-sqlite3
    // We'll assume the operation succeeded if no error was thrown
  }

  // Mark chat as read by updating read_at timestamp
  async readChat(chatId: string): Promise<void> {
    const now = new Date().toISOString();

    await this.db.db.exec(
      `UPDATE chats SET read_at = ? WHERE id = ? AND user_id = ?`,
      [now, chatId, this.user_id]
    );
  }

  // Get all chats for sidebar - now reads directly from chats table
  async getAllChats(): Promise<
    Array<{
      id: string;
      updated_at: string;
      first_message: string | null;
      first_message_time: string | null;
      read_at: string | null;
    }>
  > {
    const results = await this.db.db.execO<Record<string, unknown>>(
      `SELECT
            id,
            updated_at,
            first_message_content as first_message,
            first_message_time,
            read_at
          FROM chats
          WHERE user_id = ?
          ORDER BY updated_at DESC
          LIMIT 100`,
      [this.user_id]
    );

    if (!results) return [];

    return results.map((row) => ({
      id: row.id as string,
      updated_at: row.updated_at as string,
      first_message: row.first_message as string | null,
      first_message_time: row.first_message_time as string | null,
      read_at: row.read_at as string | null,
    }));
  }
}
