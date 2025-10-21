// Database factory functions for createDB/closeDB pattern
import { DBInterface } from './interfaces';
import debug from "debug";

const debugDatabase = debug("db:database");

export interface CRSqliteDB {
  start(): Promise<void>;
  close(): Promise<void>;
  get db(): DBInterface;
}

export class KeepDB implements CRSqliteDB {
  readonly file: string;
  private db_instance?: DBInterface;

  constructor(file: string, dbInstance?: DBInterface) {
    this.file = file;
    this.db_instance = dbInstance;
  }

  get db(): DBInterface {
    if (!this.db_instance) throw new Error("DB not started");
    return this.db_instance;
  }

  async start(): Promise<void> {
    if (this.db_instance) {
      debugDatabase("Database already initialized");
      return;
    }
    throw new Error("DB instance not provided. Use platform-specific factory functions from @app/node or @app/browser packages.");
  }

  async close() {
    try {
      if (this.db_instance) {
        await this.db_instance.close();
        debugDatabase("Database closed successfully");
      }
    } catch (error) {
      debugDatabase("Failed to close database:", error);
      throw error;
    }
  }

  async initialize() {
    const db = this.db;

    // Create all tables with final schema (no migrations needed)
    await db.tx(async (tx) => {
      // Chats table with all final columns
      await tx.exec(`CREATE TABLE IF NOT EXISTS chats (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        created_at DATETIME DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        updated_at DATETIME DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        read_at DATETIME,
        first_message_content TEXT,
        first_message_time DATETIME
      )`);

      // Tasks table with all final columns
      await tx.exec(`CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        task TEXT NOT NULL,
        reply TEXT DEFAULT '',
        state TEXT DEFAULT '',
        thread_id TEXT DEFAULT '',
        error TEXT DEFAULT '',
        deleted BOOLEAN DEFAULT FALSE,
        type TEXT DEFAULT '',
        title TEXT NOT NULL DEFAULT '',
        cron TEXT NOT NULL DEFAULT ''
      )`);

      // Notes table
      await tx.exec(`CREATE TABLE IF NOT EXISTS notes (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        tags TEXT NOT NULL,
        priority TEXT DEFAULT 'low' CHECK (priority IN ('low', 'medium', 'high')),
        created DATETIME DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        updated DATETIME DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      )`);

      // Memory implementation tables
      await tx.exec(`CREATE TABLE IF NOT EXISTS threads (
        id TEXT NOT NULL PRIMARY KEY,
        title TEXT,
        resourceId TEXT NOT NULL,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL,
        metadata TEXT
      )`);

      await tx.exec(`CREATE TABLE IF NOT EXISTS messages (
        id TEXT NOT NULL PRIMARY KEY,
        threadId TEXT NOT NULL,
        resourceId TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        createdAt TEXT NOT NULL
      )`);

      await tx.exec(`CREATE TABLE IF NOT EXISTS resources (
        id TEXT NOT NULL PRIMARY KEY,
        workingMemory TEXT,
        metadata TEXT,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL
      )`);
    });

    // Create all indexes
    await db.tx(async (tx) => {
      // Chats indexes
      await tx.exec(`CREATE INDEX IF NOT EXISTS idx_chats_user_id ON chats(user_id)`);
      await tx.exec(`CREATE INDEX IF NOT EXISTS idx_chats_updated_at ON chats(updated_at)`);
      await tx.exec(`CREATE INDEX IF NOT EXISTS idx_chats_first_message_time ON chats(first_message_time)`);
      
      // Tasks indexes
      await tx.exec(`CREATE INDEX IF NOT EXISTS idx_tasks_user_id ON tasks(user_id)`);
      await tx.exec(`CREATE INDEX IF NOT EXISTS idx_tasks_timestamp ON tasks(timestamp)`);
      await tx.exec(`CREATE INDEX IF NOT EXISTS idx_tasks_reply ON tasks(reply)`);
      await tx.exec(`CREATE INDEX IF NOT EXISTS idx_tasks_state ON tasks(state)`);
      await tx.exec(`CREATE INDEX IF NOT EXISTS idx_tasks_user_reply_timestamp ON tasks(user_id, reply, timestamp)`);
      await tx.exec(`CREATE INDEX IF NOT EXISTS idx_tasks_user_state_timestamp ON tasks(user_id, state, timestamp)`);
      
      // Notes indexes
      await tx.exec(`CREATE INDEX IF NOT EXISTS idx_notes_user_id ON notes(user_id)`);
      await tx.exec(`CREATE INDEX IF NOT EXISTS idx_notes_updated ON notes(updated)`);
      await tx.exec(`CREATE INDEX IF NOT EXISTS idx_notes_priority ON notes(priority)`);
      await tx.exec(`CREATE INDEX IF NOT EXISTS idx_notes_user_updated ON notes(user_id, updated)`);
      
      // Memory tables indexes
      await tx.exec(`CREATE INDEX IF NOT EXISTS idx_threads_resourceId ON threads(resourceId)`);
      await tx.exec(`CREATE INDEX IF NOT EXISTS idx_threads_updatedAt ON threads(updatedAt)`);
      await tx.exec(`CREATE INDEX IF NOT EXISTS idx_messages_threadId ON messages(threadId)`);
      await tx.exec(`CREATE INDEX IF NOT EXISTS idx_messages_resourceId ON messages(resourceId)`);
      await tx.exec(`CREATE INDEX IF NOT EXISTS idx_messages_createdAt ON messages(createdAt)`);
      await tx.exec(`CREATE INDEX IF NOT EXISTS idx_resources_id ON resources(id)`);
    });

    debugDatabase("Database tables and indexes created successfully");
  }
}

