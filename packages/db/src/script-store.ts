import { CRSqliteDB } from "./database";

export interface Script {
  id: string;
  task_id: string;
  version: number;
  timestamp: string;
  code: string;
  change_comment: string;
}

export interface ScriptRun {
  id: string;
  script_id: string;
  start_timestamp: string;
  end_timestamp: string;
  error: string;
  result: string;
  logs: string;
}

export class ScriptStore {
  private db: CRSqliteDB;

  constructor(db: CRSqliteDB) {
    this.db = db;
  }

  // Add a new script
  async addScript(script: Script): Promise<void> {
    await this.db.db.exec(
      `INSERT INTO scripts (id, task_id, version, timestamp, code, change_comment)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [script.id, script.task_id, script.version, script.timestamp, script.code, script.change_comment]
    );
  }

  // Get a script by ID
  async getScript(id: string): Promise<Script | null> {
    const results = await this.db.db.execO<Record<string, unknown>>(
      `SELECT id, task_id, version, timestamp, code, change_comment
       FROM scripts
       WHERE id = ?`,
      [id]
    );

    if (!results || results.length === 0) {
      return null;
    }

    const row = results[0];
    return {
      id: row.id as string,
      task_id: row.task_id as string,
      version: row.version as number,
      timestamp: row.timestamp as string,
      code: row.code as string,
      change_comment: row.change_comment as string,
    };
  }

  // List scripts with optional filtering
  async listScripts(
    task_id?: string,
    limit: number = 100,
    offset: number = 0
  ): Promise<Script[]> {
    let sql = `SELECT id, task_id, version, timestamp, code, change_comment
               FROM scripts`;
    const args: (string | number)[] = [];

    // Filter by task_id if provided
    if (task_id) {
      sql += ` WHERE task_id = ?`;
      args.push(task_id);
    }

    // Order by timestamp descending (most recent first) and apply pagination
    sql += ` ORDER BY timestamp DESC LIMIT ? OFFSET ?`;
    args.push(limit, offset);

    const results = await this.db.db.execO<Record<string, unknown>>(sql, args);

    if (!results) return [];

    return results.map((row) => ({
      id: row.id as string,
      task_id: row.task_id as string,
      version: row.version as number,
      timestamp: row.timestamp as string,
      code: row.code as string,
      change_comment: row.change_comment as string,
    }));
  }

  // Get the latest script version for each distinct task_id
  async listLatestScripts(
    limit: number = 100,
    offset: number = 0
  ): Promise<Script[]> {
    const results = await this.db.db.execO<Record<string, unknown>>(
      `SELECT s.id, s.task_id, s.version, s.timestamp, s.code, s.change_comment
       FROM scripts s
       INNER JOIN (
         SELECT task_id, MAX(version) as max_version
         FROM scripts
         GROUP BY task_id
       ) latest ON s.task_id = latest.task_id AND s.version = latest.max_version
       ORDER BY s.timestamp DESC
       LIMIT ? OFFSET ?`,
      [limit, offset]
    );

    if (!results) return [];

    return results.map((row) => ({
      id: row.id as string,
      task_id: row.task_id as string,
      version: row.version as number,
      timestamp: row.timestamp as string,
      code: row.code as string,
      change_comment: row.change_comment as string,
    }));
  }

  // Get scripts by task_id ordered by version
  async getScriptsByTaskId(task_id: string): Promise<Script[]> {
    const results = await this.db.db.execO<Record<string, unknown>>(
      `SELECT id, task_id, version, timestamp, code, change_comment
       FROM scripts
       WHERE task_id = ?
       ORDER BY version ASC`,
      [task_id]
    );

    if (!results) return [];

    return results.map((row) => ({
      id: row.id as string,
      task_id: row.task_id as string,
      version: row.version as number,
      timestamp: row.timestamp as string,
      code: row.code as string,
      change_comment: row.change_comment as string,
    }));
  }

  // Get the latest script version for a task
  async getLatestScriptByTaskId(task_id: string): Promise<Script | null> {
    const results = await this.db.db.execO<Record<string, unknown>>(
      `SELECT id, task_id, version, timestamp, code, change_comment
       FROM scripts
       WHERE task_id = ?
       ORDER BY version DESC
       LIMIT 1`,
      [task_id]
    );

    if (!results || results.length === 0) {
      return null;
    }

    const row = results[0];
    return {
      id: row.id as string,
      task_id: row.task_id as string,
      version: row.version as number,
      timestamp: row.timestamp as string,
      code: row.code as string,
      change_comment: row.change_comment as string,
    };
  }

  // Create a new script run
  async startScriptRun(id: string, script_id: string, start_timestamp: string): Promise<void> {
    await this.db.db.exec(
      `INSERT INTO script_runs (id, script_id, start_timestamp, end_timestamp, error, result, logs)
       VALUES (?, ?, ?, '', '', '', '')`,
      [id, script_id, start_timestamp]
    );
  }

  // Update a script run with end_timestamp, optional error, result, and logs
  async finishScriptRun(id: string, end_timestamp: string, result: string, error: string = '', logs: string = ''): Promise<void> {
    await this.db.db.exec(
      `UPDATE script_runs
       SET end_timestamp = ?, result = ?, error = ?, logs = ?
       WHERE id = ?`,
      [end_timestamp, result, error, logs, id]
    );
  }

  // Get a script run by ID
  async getScriptRun(id: string): Promise<ScriptRun | null> {
    const results = await this.db.db.execO<Record<string, unknown>>(
      `SELECT id, script_id, start_timestamp, end_timestamp, error, result, logs
       FROM script_runs
       WHERE id = ?`,
      [id]
    );

    if (!results || results.length === 0) {
      return null;
    }

    const row = results[0];
    return {
      id: row.id as string,
      script_id: row.script_id as string,
      start_timestamp: row.start_timestamp as string,
      end_timestamp: row.end_timestamp as string,
      error: row.error as string,
      result: row.result as string,
      logs: row.logs as string,
    };
  }

  // List script runs by script_id
  async listScriptRuns(
    script_id?: string,
    limit: number = 100,
    offset: number = 0
  ): Promise<ScriptRun[]> {
    let sql = `SELECT id, script_id, start_timestamp, end_timestamp, error, result, logs
               FROM script_runs`;
    const args: (string | number)[] = [];

    // Filter by script_id if provided
    if (script_id) {
      sql += ` WHERE script_id = ?`;
      args.push(script_id);
    }

    // Order by start_timestamp descending (most recent first) and apply pagination
    sql += ` ORDER BY start_timestamp DESC LIMIT ? OFFSET ?`;
    args.push(limit, offset);

    const results = await this.db.db.execO<Record<string, unknown>>(sql, args);

    if (!results) return [];

    return results.map((row) => ({
      id: row.id as string,
      script_id: row.script_id as string,
      start_timestamp: row.start_timestamp as string,
      end_timestamp: row.end_timestamp as string,
      error: row.error as string,
      result: row.result as string,
      logs: row.logs as string,
    }));
  }

  // Get script runs by script_id
  async getScriptRunsByScriptId(script_id: string): Promise<ScriptRun[]> {
    const results = await this.db.db.execO<Record<string, unknown>>(
      `SELECT id, script_id, start_timestamp, end_timestamp, error, result, logs
       FROM script_runs
       WHERE script_id = ?
       ORDER BY start_timestamp DESC`,
      [script_id]
    );

    if (!results) return [];

    return results.map((row) => ({
      id: row.id as string,
      script_id: row.script_id as string,
      start_timestamp: row.start_timestamp as string,
      end_timestamp: row.end_timestamp as string,
      error: row.error as string,
      result: row.result as string,
      logs: row.logs as string,
    }));
  }

  // Get script runs by task_id (through scripts table)
  async getScriptRunsByTaskId(task_id: string): Promise<ScriptRun[]> {
    const results = await this.db.db.execO<Record<string, unknown>>(
      `SELECT sr.id, sr.script_id, sr.start_timestamp, sr.end_timestamp, sr.error, sr.result, sr.logs
       FROM script_runs sr
       INNER JOIN scripts s ON sr.script_id = s.id
       WHERE s.task_id = ?
       ORDER BY sr.start_timestamp DESC`,
      [task_id]
    );

    if (!results) return [];

    return results.map((row) => ({
      id: row.id as string,
      script_id: row.script_id as string,
      start_timestamp: row.start_timestamp as string,
      end_timestamp: row.end_timestamp as string,
      error: row.error as string,
      result: row.result as string,
      logs: row.logs as string,
    }));
  }
}
