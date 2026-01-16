import { CRSqliteDB } from "./database";
import { DBInterface } from "./interfaces";

export interface Script {
  id: string;
  task_id: string;
  version: number;
  timestamp: string;
  code: string;
  change_comment: string;
  workflow_id: string;
  type: string;
}

export interface ScriptRun {
  id: string;
  script_id: string;
  start_timestamp: string;
  end_timestamp: string;
  error: string;
  result: string;
  logs: string;
  workflow_id: string;
  type: string;
}

export interface Workflow {
  id: string;
  title: string;
  task_id: string;
  timestamp: string;
  cron: string;
  events: string;
  status: string;
  next_run_timestamp: string;
  maintenance: boolean;
}

export class ScriptStore {
  private db: CRSqliteDB;

  constructor(db: CRSqliteDB) {
    this.db = db;
  }

  // Add a new script
  async addScript(script: Script, tx?: DBInterface): Promise<void> {
    const db = tx || this.db.db;
    await db.exec(
      `INSERT INTO scripts (id, task_id, version, timestamp, code, change_comment, workflow_id, type)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [script.id, script.task_id, script.version, script.timestamp, script.code, script.change_comment, script.workflow_id, script.type]
    );
  }

  // Get a script by ID
  async getScript(id: string): Promise<Script | null> {
    const results = await this.db.db.execO<Record<string, unknown>>(
      `SELECT id, task_id, version, timestamp, code, change_comment, workflow_id, type
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
      workflow_id: row.workflow_id as string,
      type: row.type as string,
    };
  }

  // List scripts with optional filtering
  async listScripts(
    task_id?: string,
    limit: number = 100,
    offset: number = 0
  ): Promise<Script[]> {
    let sql = `SELECT id, task_id, version, timestamp, code, change_comment, workflow_id, type
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
      workflow_id: row.workflow_id as string,
      type: row.type as string,
    }));
  }

  // Get the latest script version for each distinct task_id
  async listLatestScripts(
    limit: number = 100,
    offset: number = 0
  ): Promise<Script[]> {
    const results = await this.db.db.execO<Record<string, unknown>>(
      `SELECT s.id, s.task_id, s.version, s.timestamp, s.code, s.change_comment, s.workflow_id, s.type
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
      workflow_id: row.workflow_id as string,
      type: row.type as string,
    }));
  }

  // Get scripts by task_id ordered by version
  async getScriptsByTaskId(task_id: string): Promise<Script[]> {
    const results = await this.db.db.execO<Record<string, unknown>>(
      `SELECT id, task_id, version, timestamp, code, change_comment, workflow_id, type
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
      workflow_id: row.workflow_id as string,
      type: row.type as string,
    }));
  }

  // Get the latest script version for a task
  async getLatestScriptByTaskId(task_id: string): Promise<Script | null> {
    const results = await this.db.db.execO<Record<string, unknown>>(
      `SELECT id, task_id, version, timestamp, code, change_comment, workflow_id, type
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
      workflow_id: row.workflow_id as string,
      type: row.type as string,
    };
  }

  // Get scripts by workflow_id
  async getScriptsByWorkflowId(workflow_id: string): Promise<Script[]> {
    const results = await this.db.db.execO<Record<string, unknown>>(
      `SELECT id, task_id, version, timestamp, code, change_comment, workflow_id, type
       FROM scripts
       WHERE workflow_id = ?
       ORDER BY version DESC`,
      [workflow_id]
    );

    if (!results) return [];

    return results.map((row) => ({
      id: row.id as string,
      task_id: row.task_id as string,
      version: row.version as number,
      timestamp: row.timestamp as string,
      code: row.code as string,
      change_comment: row.change_comment as string,
      workflow_id: row.workflow_id as string,
      type: row.type as string,
    }));
  }

  // Create a new script run
  async startScriptRun(id: string, script_id: string, start_timestamp: string, workflow_id: string = '', type: string = '', tx?: DBInterface): Promise<void> {
    const db = tx || this.db.db;
    await db.exec(
      `INSERT INTO script_runs (id, script_id, start_timestamp, end_timestamp, error, result, logs, workflow_id, type)
       VALUES (?, ?, ?, '', '', '', '', ?, ?)`,
      [id, script_id, start_timestamp, workflow_id, type]
    );
  }

  // Update a script run with end_timestamp, optional error, result, and logs
  async finishScriptRun(id: string, end_timestamp: string, result: string, error: string = '', logs: string = '', tx?: DBInterface): Promise<void> {
    const db = tx || this.db.db;
    await db.exec(
      `UPDATE script_runs
       SET end_timestamp = ?, result = ?, error = ?, logs = ?
       WHERE id = ?`,
      [end_timestamp, result, error, logs, id]
    );
  }

  // Get a script run by ID
  async getScriptRun(id: string): Promise<ScriptRun | null> {
    const results = await this.db.db.execO<Record<string, unknown>>(
      `SELECT id, script_id, start_timestamp, end_timestamp, error, result, logs, workflow_id, type
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
      workflow_id: row.workflow_id as string,
      type: row.type as string,
    };
  }

  // List script runs by script_id
  async listScriptRuns(
    script_id?: string,
    limit: number = 100,
    offset: number = 0
  ): Promise<ScriptRun[]> {
    let sql = `SELECT id, script_id, start_timestamp, end_timestamp, error, result, logs, workflow_id, type
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
      workflow_id: row.workflow_id as string,
      type: row.type as string,
    }));
  }

  // Get script runs by script_id
  async getScriptRunsByScriptId(script_id: string): Promise<ScriptRun[]> {
    const results = await this.db.db.execO<Record<string, unknown>>(
      `SELECT id, script_id, start_timestamp, end_timestamp, error, result, logs, workflow_id, type
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
      workflow_id: row.workflow_id as string,
      type: row.type as string,
    }));
  }

  // Get script runs by task_id (through scripts table)
  async getScriptRunsByTaskId(task_id: string): Promise<ScriptRun[]> {
    const results = await this.db.db.execO<Record<string, unknown>>(
      `SELECT sr.id, sr.script_id, sr.start_timestamp, sr.end_timestamp, sr.error, sr.result, sr.logs, sr.workflow_id, sr.type
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
      workflow_id: row.workflow_id as string,
      type: row.type as string,
    }));
  }

  // Get script runs by workflow_id
  async getScriptRunsByWorkflowId(workflow_id: string): Promise<ScriptRun[]> {
    const results = await this.db.db.execO<Record<string, unknown>>(
      `SELECT id, script_id, start_timestamp, end_timestamp, error, result, logs, workflow_id, type
       FROM script_runs
       WHERE workflow_id = ?
       ORDER BY start_timestamp DESC`,
      [workflow_id]
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
      workflow_id: row.workflow_id as string,
      type: row.type as string,
    }));
  }

  // Get the latest script version for a workflow
  async getLatestScriptByWorkflowId(workflow_id: string): Promise<Script | null> {
    const results = await this.db.db.execO<Record<string, unknown>>(
      `SELECT id, task_id, version, timestamp, code, change_comment, workflow_id, type
       FROM scripts
       WHERE workflow_id = ?
       ORDER BY version DESC
       LIMIT 1`,
      [workflow_id]
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
      workflow_id: row.workflow_id as string,
      type: row.type as string,
    };
  }

  // Add a new workflow
  async addWorkflow(workflow: Workflow, tx?: DBInterface): Promise<void> {
    const db = tx || this.db.db;
    await db.exec(
      `INSERT INTO workflows (id, title, task_id, timestamp, cron, events, status, next_run_timestamp, maintenance)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [workflow.id, workflow.title, workflow.task_id, workflow.timestamp, workflow.cron, workflow.events, workflow.status, workflow.next_run_timestamp, workflow.maintenance ? 1 : 0]
    );
  }

  // Update a workflow
  async updateWorkflow(workflow: Workflow, tx?: DBInterface): Promise<void> {
    const db = tx || this.db.db;
    await db.exec(
      `UPDATE workflows
       SET title = ?, task_id = ?, timestamp = ?, cron = ?, events = ?, status = ?, next_run_timestamp = ?, maintenance = ?
       WHERE id = ?`,
      [workflow.title, workflow.task_id, workflow.timestamp, workflow.cron, workflow.events, workflow.status, workflow.next_run_timestamp, workflow.maintenance ? 1 : 0, workflow.id]
    );
  }

  // Get a workflow by ID
  async getWorkflow(id: string): Promise<Workflow | null> {
    const results = await this.db.db.execO<Record<string, unknown>>(
      `SELECT id, title, task_id, timestamp, cron, events, status, next_run_timestamp, maintenance
       FROM workflows
       WHERE id = ?`,
      [id]
    );

    if (!results || results.length === 0) {
      return null;
    }

    const row = results[0];
    return {
      id: row.id as string,
      title: row.title as string,
      task_id: row.task_id as string,
      timestamp: row.timestamp as string,
      cron: row.cron as string,
      events: row.events as string,
      status: row.status as string,
      next_run_timestamp: row.next_run_timestamp as string,
      maintenance: Boolean(row.maintenance),
    };
  }

  // Get workflow by task_id
  async getWorkflowByTaskId(task_id: string): Promise<Workflow | null> {
    const results = await this.db.db.execO<Record<string, unknown>>(
      `SELECT id, title, task_id, timestamp, cron, events, status, next_run_timestamp, maintenance
       FROM workflows
       WHERE task_id = ?
       LIMIT 1`,
      [task_id]
    );

    if (!results || results.length === 0) {
      return null;
    }

    const row = results[0];
    return {
      id: row.id as string,
      title: row.title as string,
      task_id: row.task_id as string,
      timestamp: row.timestamp as string,
      cron: row.cron as string,
      events: row.events as string,
      status: row.status as string,
      next_run_timestamp: row.next_run_timestamp as string,
      maintenance: Boolean(row.maintenance),
    };
  }

  // List workflows with pagination
  async listWorkflows(
    limit: number = 100,
    offset: number = 0
  ): Promise<Workflow[]> {
    const results = await this.db.db.execO<Record<string, unknown>>(
      `SELECT id, title, task_id, timestamp, cron, events, status, next_run_timestamp, maintenance
       FROM workflows
       ORDER BY timestamp DESC
       LIMIT ? OFFSET ?`,
      [limit, offset]
    );

    if (!results) return [];

    return results.map((row) => ({
      id: row.id as string,
      title: row.title as string,
      task_id: row.task_id as string,
      timestamp: row.timestamp as string,
      cron: row.cron as string,
      events: row.events as string,
      status: row.status as string,
      next_run_timestamp: row.next_run_timestamp as string,
      maintenance: Boolean(row.maintenance),
    }));
  }

  // Set maintenance mode for a workflow
  async setWorkflowMaintenance(workflowId: string, maintenance: boolean, tx?: DBInterface): Promise<void> {
    const db = tx || this.db.db;
    await db.exec(
      `UPDATE workflows SET maintenance = ? WHERE id = ?`,
      [maintenance ? 1 : 0, workflowId]
    );
  }
}
