import { CRSqliteDB } from "./database";
import { DBInterface } from "./interfaces";
import { AssistantUIMessage } from "@app/proto";

/**
 * ChatMessage represents a user-visible message in the conversation.
 * Optional metadata fields link to related data for rich rendering.
 *
 * UI Rendering:
 * - script_id present → Show script summary box at bottom of message
 * - task_run_id present → Show "ℹ️" icon linking to execution detail
 * - failed_script_run_id present → Visual indicator this was auto-fix response
 */
export interface ChatMessage {
  id: string;
  chat_id: string;
  role: "user" | "assistant";
  content: string;  // JSON-serialized AssistantUIMessage or plain text
  timestamp: string;
  task_run_id: string;        // Link to execution logs ("ℹ️" icon)
  script_id: string;          // Script saved by this message (summary box)
  failed_script_run_id: string;  // If maintenance: what broke
}

interface ChatMessageRow {
  id: string;
  chat_id: string;
  role: string;
  content: string;
  timestamp: string;
  task_run_id: string;
  script_id: string;
  failed_script_run_id: string;
}

function rowToChatMessage(row: ChatMessageRow): ChatMessage {
  return {
    id: row.id,
    chat_id: row.chat_id,
    role: row.role as "user" | "assistant",
    content: row.content,
    timestamp: row.timestamp,
    task_run_id: row.task_run_id || "",
    script_id: row.script_id || "",
    failed_script_run_id: row.failed_script_run_id || "",
  };
}

/**
 * Parses a ChatMessage's content into AssistantUIMessage format.
 * If the content is already valid JSON, returns it directly.
 * Otherwise, wraps the plain text content in the expected structure.
 *
 * This is the single source of truth for ChatMessage -> AssistantUIMessage conversion.
 */
export function parseMessageContent(msg: ChatMessage): AssistantUIMessage {
  try {
    return JSON.parse(msg.content);
  } catch {
    // Fallback for messages that aren't JSON
    return {
      id: msg.id,
      role: msg.role,
      parts: [{ type: "text", text: msg.content }],
      metadata: {
        threadId: msg.chat_id,
        createdAt: msg.timestamp,
      },
    };
  }
}

export class ChatStore {
  private db: CRSqliteDB;

  constructor(db: CRSqliteDB) {
    this.db = db;
  }

  // Save chat info when messages are sent (creates/updates chat entry)
  async createChat(
    opts: {
      chatId: string;
      message: AssistantUIMessage;
      workflowId?: string;  // Direct link to workflow (Spec 09)
    },
    tx?: DBInterface
  ): Promise<void> {
    const { chatId, message: firstMessage, workflowId } = opts;

    if (!firstMessage) return;

    // Note: first_message_content and first_message_time are deprecated (Spec 09)
    // but we still populate them for backwards compatibility
    const firstMessageContent = firstMessage.parts
      .filter((part) => part.type === "text")
      .map((part) => part.text)
      .join("");

    // Create new chat with first message info
    const now = new Date().toISOString();
    const db = tx || this.db.db;
    await db.exec(
      `INSERT INTO chats (id, first_message_content, first_message_time, created_at, updated_at, read_at, workflow_id)
          VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [chatId, firstMessageContent, now, now, now, now, workflowId || '']
    );
  }

  // Update chat info when new messages are sent
  async updateChat(
    opts: { chatId: string; updatedAt: Date },
    tx?: DBInterface
  ): Promise<void> {
    const { chatId, updatedAt } = opts;

    // Update existing chat
    const db = tx || this.db.db;
    await db.exec(
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
  async getChat(
    chatId: string,
    tx?: DBInterface
  ): Promise<{
    id: string;
    first_message_content: string | null;
    first_message_time: string | null;
    created_at: string;
    updated_at: string;
    read_at: string | null;
    workflow_id: string;
  } | null> {
    const db = tx || this.db.db;
    const results = await db.execO<Record<string, unknown>>(
      `SELECT id, first_message_content, first_message_time, created_at, updated_at, read_at, workflow_id
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
      workflow_id: (row.workflow_id as string) || '',
    };
  }

  // Get chat by workflow_id (Spec 09)
  async getChatByWorkflowId(workflowId: string): Promise<{
    id: string;
    created_at: string;
    workflow_id: string;
  } | null> {
    const results = await this.db.db.execO<Record<string, unknown>>(
      `SELECT id, created_at, workflow_id
       FROM chats
       WHERE workflow_id = ?
       LIMIT 1`,
      [workflowId]
    );

    if (!results || results.length === 0) return null;

    const row = results[0];
    return {
      id: row.id as string,
      created_at: row.created_at as string,
      workflow_id: (row.workflow_id as string) || '',
    };
  }

  // Mark chat as read by updating read_at timestamp
  // If eventTimestamp is provided and is in the future, use it to prevent
  // repeated updates from the future timestamp edge case
  async readChat(chatId: string, eventTimestamp?: string): Promise<void> {
    const now = new Date().toISOString();
    // Use the later of now or event timestamp to avoid repeated updates for future timestamps
    const readAt = eventTimestamp && eventTimestamp > now ? eventTimestamp : now;

    await this.db.db.exec(`UPDATE chats SET read_at = ? WHERE id = ?`, [
      readAt,
      chatId,
    ]);
  }

  // Get all chats for sidebar - now reads directly from chats table
  async getAllChats(): Promise<
    Array<{
      id: string;
      updated_at: string;
      first_message: string | null;
      first_message_time: string | null;
      read_at: string | null;
      workflow_id: string;
    }>
  > {
    const results = await this.db.db.execO<Record<string, unknown>>(
      `SELECT
            id,
            updated_at,
            first_message_content as first_message,
            first_message_time,
            read_at,
            workflow_id
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
      workflow_id: (row.workflow_id as string) || '',
    }));
  }

  // ============================================================
  // Chat Messages (Spec 12) - New purpose-specific table
  // ============================================================

  /**
   * Save a single chat message to the new chat_messages table (Spec 12).
   * This is the preferred method for saving messages going forward.
   */
  async saveChatMessage(message: ChatMessage, tx?: DBInterface): Promise<void> {
    const db = tx || this.db.db;
    await db.exec(
      `INSERT OR REPLACE INTO chat_messages (id, chat_id, role, content, timestamp, task_run_id, script_id, failed_script_run_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        message.id,
        message.chat_id,
        message.role,
        message.content,
        message.timestamp,
        message.task_run_id,
        message.script_id,
        message.failed_script_run_id,
      ]
    );
  }

  /**
   * Get chat messages from the new chat_messages table (Spec 12).
   * Returns messages in ascending order by timestamp for display.
   */
  async getNewChatMessages(opts: {
    chatId: string;
    limit?: number;
    before?: string;
    since?: string;
  }): Promise<ChatMessage[]> {
    let sql = `SELECT * FROM chat_messages WHERE chat_id = ?`;
    const args: (string | number)[] = [opts.chatId];

    if (opts.since) {
      sql += ` AND timestamp > ?`;
      args.push(opts.since);
    }

    if (opts.before) {
      sql += ` AND timestamp < ?`;
      args.push(opts.before);
    }

    // Order by timestamp DESC to get newest first for LIMIT
    sql += ` ORDER BY timestamp DESC`;

    if (opts.limit) {
      sql += ` LIMIT ?`;
      args.push(opts.limit);
    }

    const results = await this.db.db.execO<ChatMessageRow>(sql, args);

    if (!results) return [];

    // Convert and reverse to get ascending order for display
    return results.map(rowToChatMessage).reverse();
  }

  /**
   * Get a single chat message by ID from the new table (Spec 12).
   */
  async getChatMessageById(id: string): Promise<ChatMessage | null> {
    const results = await this.db.db.execO<ChatMessageRow>(
      "SELECT * FROM chat_messages WHERE id = ?",
      [id]
    );

    if (!results || results.length === 0) {
      return null;
    }

    return rowToChatMessage(results[0]);
  }

  /**
   * Count messages in the new chat_messages table (Spec 12).
   */
  async countNewMessages(chatId?: string): Promise<number> {
    let sql = `SELECT COUNT(*) as count FROM chat_messages`;
    const args: string[] = [];

    if (chatId) {
      sql += ` WHERE chat_id = ?`;
      args.push(chatId);
    }

    const results = await this.db.db.execO<{ count: number }>(sql, args);
    return results?.[0]?.count || 0;
  }

  /**
   * Get the last activity timestamp from the new chat_messages table (Spec 12).
   */
  async getLastMessageActivity(chatId: string): Promise<string | null> {
    const results = await this.db.db.execO<{ max_ts: string }>(
      `SELECT MAX(timestamp) as max_ts
       FROM chat_messages
       WHERE chat_id = ?`,
      [chatId]
    );

    if (!results || results.length === 0 || !results[0].max_ts) return null;
    return results[0].max_ts;
  }
}
