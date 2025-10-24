// Database factory functions for createDB/closeDB pattern
import { DBInterface } from "./interfaces";
import debug from "debug";

const debugDatabase = debug("db:database");

export interface CRSqliteDB {
  start(): Promise<void>;
  close(): Promise<void>;
  get db(): DBInterface;
}

export class KeepDb implements CRSqliteDB {
  private db_instance: DBInterface;
  private started: boolean = false;

  constructor(dbInstance: DBInterface) {
    this.db_instance = dbInstance;
  }

  get db(): DBInterface {
    return this.db_instance;
  }

  async start(): Promise<void> {
    if (this.started) {
      debugDatabase("Database already initialized");
      return;
    }

    await this.initialize();
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

  private async initialize() {
    const db = this.db;

    // Create all tables with final schema (no migrations needed)
    await db.tx(async (tx) => {
      // Chats table with all final columns
      await tx.exec(`CREATE TABLE IF NOT EXISTS chats (
        id TEXT PRIMARY KEY NOT NULL,
        user_id TEXT NOT NULL DEFAULT '',
        created_at DATETIME DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        updated_at DATETIME DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        read_at DATETIME,
        first_message_content TEXT,
        first_message_time DATETIME
      )`);

      // Tasks table with all final columns
      await tx.exec(`CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY NOT NULL,
        user_id TEXT NOT NULL DEFAULT '',
        timestamp INTEGER NOT NULL DEFAULT 0,
        task TEXT NOT NULL DEFAULT '',
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
        id TEXT PRIMARY KEY NOT NULL,
        user_id TEXT NOT NULL DEFAULT '',
        title TEXT NOT NULL DEFAULT '',
        content TEXT NOT NULL DEFAULT '',
        tags TEXT NOT NULL DEFAULT '',
        priority TEXT NOT NULL DEFAULT '',
        created DATETIME DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        updated DATETIME DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      )`);

      // Memory implementation tables
      await tx.exec(`CREATE TABLE IF NOT EXISTS threads (
        id TEXT NOT NULL PRIMARY KEY,
        title TEXT NOT NULL DEFAULT '',
        user_id TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT '',
        updated_at TEXT NOT NULL DEFAULT '',
        metadata TEXT NOT NULL DEFAULT ''
      )`);

      await tx.exec(`CREATE TABLE IF NOT EXISTS messages (
        id TEXT NOT NULL PRIMARY KEY,
        thread_id TEXT NOT NULL DEFAULT '',
        user_id TEXT NOT NULL DEFAULT '',
        role TEXT NOT NULL DEFAULT '',
        content TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT ''
      )`);

      await tx.exec(`CREATE TABLE IF NOT EXISTS resources (
        id TEXT NOT NULL PRIMARY KEY,
        workingMemory TEXT NOT NULL DEFAULT '',
        metadata TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT '',
        updated_at TEXT NOT NULL DEFAULT ''
      )`);
    });

    await db.exec("SELECT crsql_as_crr('chats')");
    await db.exec("SELECT crsql_as_crr('tasks')");
    await db.exec("SELECT crsql_as_crr('notes')");
    await db.exec("SELECT crsql_as_crr('threads')");
    await db.exec("SELECT crsql_as_crr('messages')");
    await db.exec("SELECT crsql_as_crr('resources')");

    // Create all indexes
    await db.tx(async (tx) => {
      // Chats indexes
      await tx.exec(
        `CREATE INDEX IF NOT EXISTS idx_chats_user_id ON chats(user_id)`
      );
      await tx.exec(
        `CREATE INDEX IF NOT EXISTS idx_chats_updated_at ON chats(updated_at)`
      );
      await tx.exec(
        `CREATE INDEX IF NOT EXISTS idx_chats_first_message_time ON chats(first_message_time)`
      );

      // Tasks indexes
      await tx.exec(
        `CREATE INDEX IF NOT EXISTS idx_tasks_user_id ON tasks(user_id)`
      );
      await tx.exec(
        `CREATE INDEX IF NOT EXISTS idx_tasks_timestamp ON tasks(timestamp)`
      );
      await tx.exec(
        `CREATE INDEX IF NOT EXISTS idx_tasks_reply ON tasks(reply)`
      );
      await tx.exec(
        `CREATE INDEX IF NOT EXISTS idx_tasks_state ON tasks(state)`
      );
      await tx.exec(
        `CREATE INDEX IF NOT EXISTS idx_tasks_user_reply_timestamp ON tasks(user_id, reply, timestamp)`
      );
      await tx.exec(
        `CREATE INDEX IF NOT EXISTS idx_tasks_user_state_timestamp ON tasks(user_id, state, timestamp)`
      );

      // Notes indexes
      await tx.exec(
        `CREATE INDEX IF NOT EXISTS idx_notes_user_id ON notes(user_id)`
      );
      await tx.exec(
        `CREATE INDEX IF NOT EXISTS idx_notes_updated ON notes(updated)`
      );
      await tx.exec(
        `CREATE INDEX IF NOT EXISTS idx_notes_priority ON notes(priority)`
      );
      await tx.exec(
        `CREATE INDEX IF NOT EXISTS idx_notes_user_updated ON notes(user_id, updated)`
      );

      // Memory tables indexes
      await tx.exec(
        `CREATE INDEX IF NOT EXISTS idx_threads_user_id ON threads(user_id)`
      );
      await tx.exec(
        `CREATE INDEX IF NOT EXISTS idx_threads_updated_at ON threads(updated_at)`
      );
      await tx.exec(
        `CREATE INDEX IF NOT EXISTS idx_messages_thread_id ON messages(thread_id)`
      );
      await tx.exec(
        `CREATE INDEX IF NOT EXISTS idx_messages_user_id ON messages(user_id)`
      );
      await tx.exec(
        `CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at)`
      );
      await tx.exec(
        `CREATE INDEX IF NOT EXISTS idx_resources_id ON resources(id)`
      );
    });

    debugDatabase("Database tables and indexes created successfully");
  }
}
