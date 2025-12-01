import { CRSqliteDB } from "./database";

export type InboxItemSource = "user" | "router" | "worker";
export type InboxItemTarget = "router" | "worker" | "replier";

export interface InboxItem {
  id: string; // idempotency key
  source: InboxItemSource;
  source_id: string; // message_id or task_thread_id+step
  target: InboxItemTarget;
  target_id: string; // optional, worker.task_id
  content: string; // payload
  timestamp: string; // created time
  handler_timestamp: string; // handling time
  handler_thread_id: string; // handling thread
}

interface InboxItemRow {
  id: string;
  source: string;
  source_id: string;
  target: string;
  target_id: string;
  content: string;
  timestamp: string;
  handler_timestamp: string;
  handler_thread_id: string;
}

function rowToInboxItem(row: InboxItemRow): InboxItem {
  return {
    id: row.id,
    source: row.source as InboxItemSource,
    source_id: row.source_id,
    target: row.target as InboxItemTarget,
    target_id: row.target_id,
    content: row.content,
    timestamp: row.timestamp,
    handler_timestamp: row.handler_timestamp,
    handler_thread_id: row.handler_thread_id,
  };
}

export class InboxStore {
  private db: CRSqliteDB;

  constructor(db: CRSqliteDB) {
    this.db = db;
  }

  async saveInbox(item: InboxItem): Promise<void> {
    await this.db.db.exec(
      `INSERT OR REPLACE INTO inbox (id, source, source_id, target, target_id, content, timestamp, handler_timestamp, handler_thread_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        item.id,
        item.source,
        item.source_id,
        item.target,
        item.target_id,
        item.content,
        item.timestamp,
        item.handler_timestamp,
        item.handler_thread_id,
      ]
    );
  }

  async handleInboxItem(
    id: string,
    timestamp: string,
    thread_id: string
  ): Promise<boolean> {
    const result = await this.db.db.exec(
      `UPDATE inbox SET handler_timestamp = ?, handler_thread_id = ? WHERE id = ?`,
      [timestamp, thread_id, id]
    );

    // Note: cr-sqlite exec doesn't return changes count like better-sqlite3
    // We'll assume the operation succeeded if no error was thrown
    return true;
  }

  async getInboxItem(id: string): Promise<InboxItem | null> {
    const results = await this.db.db.execO<InboxItemRow>(
      "SELECT * FROM inbox WHERE id = ?",
      [id]
    );

    if (!results || results.length === 0) {
      return null;
    }

    return rowToInboxItem(results[0]);
  }

  async listInboxItems(options?: {
    source?: InboxItemSource;
    target?: InboxItemTarget;
    limit?: number;
    offset?: number;
    handled?: boolean; // if true, only handled items; if false, only unhandled items
  }): Promise<InboxItem[]> {
    let sql = "SELECT * FROM inbox";
    const args: (string | number)[] = [];
    const conditions: string[] = [];

    // 'expired' items that should be consumed now
    conditions.push("timestamp <= ?");
    args.push(new Date().toISOString());

    if (options?.source) {
      conditions.push("source = ?");
      args.push(options.source);
    }

    if (options?.target) {
      conditions.push("target = ?");
      args.push(options.target);
    }

    if (options?.handled !== undefined) {
      if (options.handled) {
        conditions.push("handler_timestamp != ''");
      } else {
        conditions.push("handler_timestamp = ''");
      }
    }

    if (conditions.length > 0) {
      sql += " WHERE " + conditions.join(" AND ");
    }

    // Older to newer ones
    sql += " ORDER BY timestamp ASC";

    if (options?.limit) {
      sql += " LIMIT ?";
      args.push(options.limit);

      if (options?.offset) {
        sql += " OFFSET ?";
        args.push(options.offset);
      }
    }

    const results = await this.db.db.execO<InboxItemRow>(sql, args);

    if (!results) return [];

    return results.map(rowToInboxItem);
  }

  async deleteInboxItem(id: string): Promise<boolean> {
    await this.db.db.exec("DELETE FROM inbox WHERE id = ?", [id]);

    // Note: cr-sqlite exec doesn't return changes count like better-sqlite3
    // We'll assume the operation succeeded if no error was thrown
    return true;
  }

  async postponeItem(id: string, datetime: string): Promise<boolean> {
    await this.db.db.exec(
      `UPDATE inbox SET timestamp = ? WHERE id = ?`,
      [datetime, id]
    );

    // Note: cr-sqlite exec doesn't return changes count like better-sqlite3
    // We'll assume the operation succeeded if no error was thrown
    return true;
  }
}
