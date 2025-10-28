import { generateId } from "ai";
import { CRSqliteDB } from "./database";
import { AssistantUIMessage } from "@app/proto";
import debug from "debug";

const debugChatStore = debug("db:chat-store");

export class ChatStore {
  private db: CRSqliteDB;

  constructor(db: CRSqliteDB) {
    this.db = db;
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
      `INSERT INTO chats (id, first_message_content, first_message_time, created_at, updated_at, read_at)
          VALUES (?, ?, ?, ?, ?, ?)`,
      [chatId, firstMessageContent, now, now, now]
    );
  }

  // Update chat info when new messages are sent
  async updateChat(opts: { chatId: string; updatedAt: Date }): Promise<void> {
    const { chatId, updatedAt } = opts;

    // Update existing chat
    await this.db.db.exec(
      `UPDATE chats
          SET updated_at = ?
          WHERE id = ?`,
      [updatedAt.toISOString(), chatId]
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
          WHERE id = ?`,
      [chatId]
    );

    // Note: cr-sqlite exec doesn't return changes count like better-sqlite3
    // We'll assume the operation succeeded if no error was thrown
  }

  // Get a specific chat by ID
  async getChat(chatId: string): Promise<{
    id: string;
    first_message_content: string | null;
    first_message_time: string | null;
    created_at: string;
    updated_at: string;
    read_at: string | null;
  } | null> {
    const results = await this.db.db.execO<Record<string, unknown>>(
      `SELECT id, first_message_content, first_message_time, created_at, updated_at, read_at
       FROM chats
       WHERE id = ?`,
      [chatId]
    );

    if (!results || results.length === 0) return null;

    const row = results[0];
    return {
      id: row.id as string,
      first_message_content: row.first_message_content as string | null,
      first_message_time: row.first_message_time as string | null,
      created_at: row.created_at as string,
      updated_at: row.updated_at as string,
      read_at: row.read_at as string | null,
    };
  }

  // Mark chat as read by updating read_at timestamp
  async readChat(chatId: string): Promise<void> {
    const now = new Date().toISOString();

    await this.db.db.exec(
      `UPDATE chats SET read_at = ? WHERE id = ?`,
      [now, chatId]
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
          ORDER BY updated_at DESC
          LIMIT 100`
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
