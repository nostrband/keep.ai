import { AssistantUIMessage } from "@app/proto";
import { CRSqliteDB } from "./database";
import { DBInterface } from "./interfaces";
import debug from "debug";

const debugMemoryStore = debug("db:memory-store");

export type Thread = {
  id: string;
  title?: string;
  created_at: Date;
  updated_at: Date;
  metadata?: Record<string, unknown>;
};

export class MemoryStore {
  private db: CRSqliteDB;

  constructor(db: CRSqliteDB) {
    this.db = db;
  }

  // Thread operations
  async saveThread(thread: Thread, tx?: DBInterface): Promise<void> {
    const db = tx || this.db.db;
    await db.exec(
      `INSERT OR REPLACE INTO threads (id, title, created_at, updated_at, metadata)
        VALUES (?, ?, ?, ?, ?)`,
      [
        thread.id,
        thread.title || "",
        thread.created_at.toISOString(),
        thread.updated_at.toISOString(),
        JSON.stringify(thread.metadata || {}),
      ]
    );
  }

  async getThread(threadId: string, tx?: DBInterface): Promise<Thread | null> {
    const db = tx || this.db.db;
    const results = await db.execO<Record<string, unknown>>(
      `SELECT * FROM threads WHERE id = ?`,
      [threadId]
    );

    if (!results || results.length === 0) {
      return null;
    }

    const row = results[0];
    return {
      id: row.id as string,
      title: (row.title as string) || undefined,
      created_at: new Date(row.created_at as string),
      updated_at: new Date(row.updated_at as string),
      metadata: row.metadata ? JSON.parse(row.metadata as string) : undefined,
    };
  }

  async listThreads(): Promise<Thread[]> {
    const results = await this.db.db.execO<Record<string, unknown>>(
      `SELECT * FROM threads ORDER BY updated_at DESC`
    );

    if (!results) return [];

    return results.map((row) => ({
      id: row.id as string,
      title: (row.title as string) || undefined,
      created_at: new Date(row.created_at as string),
      updated_at: new Date(row.updated_at as string),
      metadata: row.metadata ? JSON.parse(row.metadata as string) : undefined,
    }));
  }

  // Message operations
  async saveMessages(
    messages: AssistantUIMessage[],
    tx?: DBInterface
  ): Promise<void> {
    const db = tx || this.db.db;
    for (const message of messages) {
      if (!message.metadata) throw new Error("Empty message metadata");
      const metadata = message.metadata;
      const threadId = metadata.threadId;

      if (!threadId) {
        throw new Error("Message metadata must include threadId");
      }

      await db.exec(
        `INSERT OR REPLACE INTO messages (id, thread_id, role, content, created_at)
          VALUES (?, ?, ?, ?, ?)`,
        [
          message.id,
          threadId,
          message.role,
          JSON.stringify(message),
          metadata.createdAt || new Date().toISOString(),
        ]
      );
    }
  }

  async getMessages({
    threadId,
    messageId,
    limit = 50,
    since,
  }: {
    threadId?: string;
    messageId?: string;
    limit?: number;
    since?: string;
  }): Promise<AssistantUIMessage[]> {
    let sql = `SELECT * FROM messages`;
    const args: (string | number)[] = [];
    let whereAdded = false;

    if (threadId) {
      sql += ` WHERE thread_id = ?`;
      args.push(threadId);
      whereAdded = true;
    }

    if (messageId) {
      sql += whereAdded ? ` AND id = ?` : ` WHERE id = ?`;
      args.push(messageId);
      whereAdded = true;
    }

    if (since) {
      sql += whereAdded ? ` AND created_at > ?` : ` WHERE created_at > ?`;
      args.push(since);
    }

    // A batch of latest messages
    sql += ` ORDER BY created_at DESC`;

    if (limit) {
      sql += ` LIMIT ?`;
      args.push(limit);
    }

    const results = await this.db.db.execO<Record<string, unknown>>(sql, args);

    if (!results) return [];

    return results
      .filter((row) => !!row.content)
      .map((row) => {
        // Parse the full UIMessage from content field
        try {
          return JSON.parse(row.content as string) as AssistantUIMessage;
        } catch (e) {
          debugMemoryStore("Bad message in db", row, e);
          return undefined;
        }
      })
      .filter((m) => !!m)
      .filter((m) => !!m.role)
      .filter((m) => !!m.parts)
      .sort((a, b) =>
        // re-sort ASC
        a.metadata!.createdAt! < b.metadata!.createdAt!
          ? -1
          : a.metadata!.createdAt! > b.metadata!.createdAt!
          ? 1
          : 0
      );
  }
}
