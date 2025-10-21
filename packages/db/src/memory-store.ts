import { AssistantUIMessage } from "@app/proto";
import { CRSqliteDB } from "./database";
import debug from "debug";

const debugMemoryStore = debug("db:memory-store");

export type StorageThreadType = {
  id: string;
  title?: string;
  resourceId: string;
  createdAt: Date;
  updatedAt: Date;
  metadata?: Record<string, unknown>;
};

export type StorageResourceType = {
  id: string;
  workingMemory?: string;
  metadata?: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
};

export class MemoryStore {
  private db: CRSqliteDB;
  private user_id: string;

  constructor(db: CRSqliteDB, user_id: string) {
    this.db = db;
    this.user_id = user_id;
  }

  // Thread operations
  async saveThread(thread: StorageThreadType): Promise<void> {
    await this.db.db.exec(`INSERT OR REPLACE INTO threads (id, title, resourceId, createdAt, updatedAt, metadata)
        VALUES (?, ?, ?, ?, ?, ?)`, [
      thread.id,
      thread.title || "",
      thread.resourceId,
      thread.createdAt.toISOString(),
      thread.updatedAt.toISOString(),
      JSON.stringify(thread.metadata || {})
    ]);
  }

  async getThread(threadId: string): Promise<StorageThreadType | null> {
    const results = await this.db.db.execO<Record<string, unknown>>(`SELECT * FROM threads WHERE id = ?`, [threadId]);

    if (!results || results.length === 0) {
      return null;
    }

    const row = results[0];
    return {
      id: row.id as string,
      title: (row.title as string) || undefined,
      resourceId: row.resourceId as string,
      createdAt: new Date(row.createdAt as string),
      updatedAt: new Date(row.updatedAt as string),
      metadata: row.metadata ? JSON.parse(row.metadata as string) : undefined,
    };
  }

  async listThreads(): Promise<StorageThreadType[]> {
    const results = await this.db.db.execO<Record<string, unknown>>(
      `SELECT * FROM threads WHERE resourceId = ? ORDER BY updatedAt DESC`, [this.user_id]
    );

    if (!results) return [];

    return results.map((row) => ({
      id: row.id as string,
      title: (row.title as string) || undefined,
      resourceId: row.resourceId as string,
      createdAt: new Date(row.createdAt as string),
      updatedAt: new Date(row.updatedAt as string),
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

      await this.db.db.exec(`INSERT OR REPLACE INTO messages (id, threadId, resourceId, role, content, createdAt)
          VALUES (?, ?, ?, ?, ?, ?)`, [
        message.id,
        threadId,
        this.user_id,
        message.role,
        JSON.stringify(message),
        metadata.createdAt || new Date().toISOString()
      ]);
    }
  }

  async getMessages({
    threadId,
    limit,
  }: {
    threadId?: string;
    limit?: number;
  }): Promise<AssistantUIMessage[]> {
    let sql = `SELECT * FROM messages WHERE resourceId = ?`;
    const args: (string | number)[] = [this.user_id];

    if (threadId) {
      sql += ` AND threadId = ?`;
      args.push(threadId);
    }

    // A batch of latest messages
    sql += ` ORDER BY createdAt DESC`;

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
  async saveResource(resource: StorageResourceType): Promise<void> {
    await this.db.db.exec(`INSERT OR REPLACE INTO resources (id, workingMemory, metadata, createdAt, updatedAt)
        VALUES (?, ?, ?, ?, ?)`, [
      resource.id,
      resource.workingMemory || "",
      JSON.stringify(resource.metadata || {}),
      resource.createdAt.toISOString(),
      resource.updatedAt.toISOString()
    ]);
  }

  async getResource(): Promise<StorageResourceType | null> {
    const results = await this.db.db.execO<Record<string, unknown>>(`SELECT * FROM resources WHERE id = ?`, [this.user_id]);

    if (!results || results.length === 0) {
      return null;
    }

    const row = results[0];
    return {
      id: row.id as string,
      workingMemory: (row.workingMemory as string) || undefined,
      metadata: row.metadata ? JSON.parse(row.metadata as string) : undefined,
      createdAt: new Date(row.createdAt as string),
      updatedAt: new Date(row.updatedAt as string),
    };
  }

  // Set resource (full replace of working memory content)
  async setResource(
    workingMemory: string,
    metadata?: Record<string, unknown>
  ): Promise<void> {
    const now = new Date();
    await this.db.db.exec(`INSERT OR REPLACE INTO resources (id, workingMemory, metadata, createdAt, updatedAt)
        VALUES (?, ?, ?, ?, ?)`, [
      this.user_id,
      workingMemory,
      JSON.stringify(metadata || {}),
      now.toISOString(),
      now.toISOString()
    ]);
  }
}
