import { AssistantUIMessage } from "@app/proto";
import { CRSqliteDB } from "./database";
import debug from "debug";

const debugMemoryStore = debug("db:memory-store");

export type Thread = {
  id: string;
  title?: string;
  user_id: string;
  created_at: Date;
  updated_at: Date;
  metadata?: Record<string, unknown>;
};

export type Resource = {
  id: string;
  workingMemory?: string;
  metadata?: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
};

export class MemoryStore {
  private db: CRSqliteDB;
  private user_id: string;

  constructor(db: CRSqliteDB, user_id: string) {
    this.db = db;
    this.user_id = user_id;
  }

  // Thread operations
  async saveThread(thread: Thread): Promise<void> {
    await this.db.db.exec(
      `INSERT OR REPLACE INTO threads (id, title, user_id, created_at, updated_at, metadata)
        VALUES (?, ?, ?, ?, ?, ?)`,
      [
        thread.id,
        thread.title || "",
        thread.user_id,
        thread.created_at.toISOString(),
        thread.updated_at.toISOString(),
        JSON.stringify(thread.metadata || {}),
      ]
    );
  }

  async getThread(threadId: string): Promise<Thread | null> {
    const results = await this.db.db.execO<Record<string, unknown>>(
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
      user_id: row.user_id as string,
      created_at: new Date(row.created_at as string),
      updated_at: new Date(row.updated_at as string),
      metadata: row.metadata ? JSON.parse(row.metadata as string) : undefined,
    };
  }

  async listThreads(): Promise<Thread[]> {
    const results = await this.db.db.execO<Record<string, unknown>>(
      `SELECT * FROM threads WHERE user_id = ? ORDER BY updated_at DESC`,
      [this.user_id]
    );

    if (!results) return [];

    return results.map((row) => ({
      id: row.id as string,
      title: (row.title as string) || undefined,
      user_id: row.user_id as string,
      created_at: new Date(row.created_at as string),
      updated_at: new Date(row.updated_at as string),
      metadata: row.metadata ? JSON.parse(row.metadata as string) : undefined,
    }));
  }

  // Message operations
  async saveMessages(messages: AssistantUIMessage[]): Promise<void> {
    for (const message of messages) {
      if (!message.metadata) throw new Error("Empty message metadata");
      const metadata = message.metadata;
      const threadId = metadata.threadId;

      if (!threadId) {
        throw new Error("Message metadata must include threadId");
      }

      await this.db.db.exec(
        `INSERT OR REPLACE INTO messages (id, thread_id, user_id, role, content, created_at)
          VALUES (?, ?, ?, ?, ?, ?)`,
        [
          message.id,
          threadId,
          this.user_id,
          message.role,
          JSON.stringify(message),
          metadata.createdAt || new Date().toISOString(),
        ]
      );
    }
  }

  async getMessages({
    threadId,
    limit = 50,
    since,
  }: {
    threadId?: string;
    limit?: number;
    since?: string;
  }): Promise<AssistantUIMessage[]> {
    let sql = `SELECT * FROM messages WHERE user_id = ?`;
    const args: (string | number)[] = [this.user_id];

    if (threadId) {
      sql += ` AND thread_id = ?`;
      args.push(threadId);
    }

    if (since) {
      sql += ` AND created_at > ?`;
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
      .sort((a, b) =>
        // re-sort ASC
        a.metadata!.createdAt! < b.metadata!.createdAt!
          ? -1
          : a.metadata!.createdAt! > b.metadata!.createdAt!
          ? 1
          : 0
      );
  }

  // Resource operations
  async saveResource(resource: Resource): Promise<void> {
    await this.db.db.exec(
      `INSERT OR REPLACE INTO resources (id, workingMemory, metadata, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)`,
      [
        resource.id,
        resource.workingMemory || "",
        JSON.stringify(resource.metadata || {}),
        resource.created_at.toISOString(),
        resource.updated_at.toISOString(),
      ]
    );
  }

  async getResource(): Promise<Resource | null> {
    const results = await this.db.db.execO<Record<string, unknown>>(
      `SELECT * FROM resources WHERE id = ?`,
      [this.user_id]
    );

    if (!results || results.length === 0) {
      return null;
    }

    const row = results[0];
    return {
      id: row.id as string,
      workingMemory: (row.workingMemory as string) || undefined,
      metadata: row.metadata ? JSON.parse(row.metadata as string) : undefined,
      created_at: new Date(row.created_at as string),
      updated_at: new Date(row.updated_at as string),
    };
  }

  // Set resource (full replace of working memory content)
  async setResource(
    workingMemory: string,
    metadata?: Record<string, unknown>
  ): Promise<void> {
    const now = new Date();
    await this.db.db.exec(
      `INSERT OR REPLACE INTO resources (id, workingMemory, metadata, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)`,
      [
        this.user_id,
        workingMemory,
        JSON.stringify(metadata || {}),
        now.toISOString(),
        now.toISOString(),
      ]
    );
  }
}
