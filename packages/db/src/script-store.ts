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
  summary: string;
  diagram: string;
}

export interface ScriptRun {
  id: string;
  script_id: string;
  start_timestamp: string;
  end_timestamp: string;
  error: string;
  error_type: string;   // Classified error type: 'auth', 'permission', 'network', 'logic', or '' (no error)
  result: string;
  logs: string;
  workflow_id: string;
  type: string;
  retry_of: string;     // ID of the original failed run (empty for non-retry runs)
  retry_count: number;  // Which retry attempt this is (0 for non-retry runs)
  cost: number;         // Total cost in microdollars (cost * 1,000,000) accumulated from tool calls
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
  maintenance_fix_count: number;  // Tracks consecutive fix attempts in maintenance mode
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
      `INSERT INTO scripts (id, task_id, version, timestamp, code, change_comment, workflow_id, type, summary, diagram)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [script.id, script.task_id, script.version, script.timestamp, script.code, script.change_comment, script.workflow_id, script.type, script.summary, script.diagram]
    );
  }

  // Get a script by ID
  async getScript(id: string): Promise<Script | null> {
    const results = await this.db.db.execO<Record<string, unknown>>(
      `SELECT id, task_id, version, timestamp, code, change_comment, workflow_id, type, summary, diagram
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
      summary: row.summary as string,
      diagram: row.diagram as string,
    };
  }

  // List scripts with optional filtering
  async listScripts(
    task_id?: string,
    limit: number = 100,
    offset: number = 0
  ): Promise<Script[]> {
    let sql = `SELECT id, task_id, version, timestamp, code, change_comment, workflow_id, type, summary, diagram
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
      summary: row.summary as string,
      diagram: row.diagram as string,
    }));
  }

  // Get the latest script version for each distinct task_id
  async listLatestScripts(
    limit: number = 100,
    offset: number = 0
  ): Promise<Script[]> {
    const results = await this.db.db.execO<Record<string, unknown>>(
      `SELECT s.id, s.task_id, s.version, s.timestamp, s.code, s.change_comment, s.workflow_id, s.type, s.summary, s.diagram
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
      summary: row.summary as string,
      diagram: row.diagram as string,
    }));
  }

  // Get scripts by task_id ordered by version
  async getScriptsByTaskId(task_id: string): Promise<Script[]> {
    const results = await this.db.db.execO<Record<string, unknown>>(
      `SELECT id, task_id, version, timestamp, code, change_comment, workflow_id, type, summary, diagram
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
      summary: row.summary as string,
      diagram: row.diagram as string,
    }));
  }

  // Get the latest script version for a task
  async getLatestScriptByTaskId(task_id: string): Promise<Script | null> {
    const results = await this.db.db.execO<Record<string, unknown>>(
      `SELECT id, task_id, version, timestamp, code, change_comment, workflow_id, type, summary, diagram
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
      summary: row.summary as string,
      diagram: row.diagram as string,
    };
  }

  // Get scripts by workflow_id
  async getScriptsByWorkflowId(workflow_id: string): Promise<Script[]> {
    const results = await this.db.db.execO<Record<string, unknown>>(
      `SELECT id, task_id, version, timestamp, code, change_comment, workflow_id, type, summary, diagram
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
      summary: row.summary as string,
      diagram: row.diagram as string,
    }));
  }

  // Create a new script run
  async startScriptRun(
    id: string,
    script_id: string,
    start_timestamp: string,
    workflow_id: string = '',
    type: string = '',
    retry_of: string = '',
    retry_count: number = 0,
    tx?: DBInterface
  ): Promise<void> {
    const db = tx || this.db.db;
    await db.exec(
      `INSERT INTO script_runs (id, script_id, start_timestamp, end_timestamp, error, result, logs, workflow_id, type, retry_of, retry_count)
       VALUES (?, ?, ?, '', '', '', '', ?, ?, ?, ?)`,
      [id, script_id, start_timestamp, workflow_id, type, retry_of, retry_count]
    );
  }

  // Update a script run with end_timestamp, optional error, result, logs, and cost
  async finishScriptRun(id: string, end_timestamp: string, result: string, error: string = '', logs: string = '', error_type: string = '', cost: number = 0, tx?: DBInterface): Promise<void> {
    const db = tx || this.db.db;
    await db.exec(
      `UPDATE script_runs
       SET end_timestamp = ?, result = ?, error = ?, logs = ?, error_type = ?, cost = ?
       WHERE id = ?`,
      [end_timestamp, result, error, logs, error_type, cost, id]
    );
  }

  // Get a script run by ID
  async getScriptRun(id: string): Promise<ScriptRun | null> {
    const results = await this.db.db.execO<Record<string, unknown>>(
      `SELECT id, script_id, start_timestamp, end_timestamp, error, error_type, result, logs, workflow_id, type, retry_of, retry_count, cost
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
      error_type: (row.error_type as string) || '',
      result: row.result as string,
      logs: row.logs as string,
      workflow_id: row.workflow_id as string,
      type: row.type as string,
      retry_of: (row.retry_of as string) || '',
      retry_count: (row.retry_count as number) || 0,
      cost: (row.cost as number) || 0,
    };
  }

  // List script runs by script_id
  async listScriptRuns(
    script_id?: string,
    limit: number = 100,
    offset: number = 0
  ): Promise<ScriptRun[]> {
    let sql = `SELECT id, script_id, start_timestamp, end_timestamp, error, error_type, result, logs, workflow_id, type, retry_of, retry_count, cost
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
      error_type: (row.error_type as string) || '',
      result: row.result as string,
      logs: row.logs as string,
      workflow_id: row.workflow_id as string,
      type: row.type as string,
      retry_of: (row.retry_of as string) || '',
      retry_count: (row.retry_count as number) || 0,
      cost: (row.cost as number) || 0,
    }));
  }

  // Get script runs by script_id
  async getScriptRunsByScriptId(script_id: string): Promise<ScriptRun[]> {
    const results = await this.db.db.execO<Record<string, unknown>>(
      `SELECT id, script_id, start_timestamp, end_timestamp, error, error_type, result, logs, workflow_id, type, retry_of, retry_count, cost
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
      error_type: (row.error_type as string) || '',
      result: row.result as string,
      logs: row.logs as string,
      workflow_id: row.workflow_id as string,
      type: row.type as string,
      retry_of: (row.retry_of as string) || '',
      retry_count: (row.retry_count as number) || 0,
      cost: (row.cost as number) || 0,
    }));
  }

  // Get script runs by task_id (through scripts table)
  async getScriptRunsByTaskId(task_id: string): Promise<ScriptRun[]> {
    const results = await this.db.db.execO<Record<string, unknown>>(
      `SELECT sr.id, sr.script_id, sr.start_timestamp, sr.end_timestamp, sr.error, sr.error_type, sr.result, sr.logs, sr.workflow_id, sr.type, sr.retry_of, sr.retry_count, sr.cost
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
      error_type: (row.error_type as string) || '',
      result: row.result as string,
      logs: row.logs as string,
      workflow_id: row.workflow_id as string,
      type: row.type as string,
      retry_of: (row.retry_of as string) || '',
      retry_count: (row.retry_count as number) || 0,
      cost: (row.cost as number) || 0,
    }));
  }

  // Get retries of a specific run (runs where retry_of equals this run's ID)
  async getRetriesOfRun(runId: string): Promise<ScriptRun[]> {
    const results = await this.db.db.execO<Record<string, unknown>>(
      `SELECT id, script_id, start_timestamp, end_timestamp, error, error_type, result, logs, workflow_id, type, retry_of, retry_count, cost
       FROM script_runs
       WHERE retry_of = ?
       ORDER BY retry_count ASC`,
      [runId]
    );

    if (!results) return [];

    return results.map((row) => ({
      id: row.id as string,
      script_id: row.script_id as string,
      start_timestamp: row.start_timestamp as string,
      end_timestamp: row.end_timestamp as string,
      error: row.error as string,
      error_type: (row.error_type as string) || '',
      result: row.result as string,
      logs: row.logs as string,
      workflow_id: row.workflow_id as string,
      type: row.type as string,
      retry_of: (row.retry_of as string) || '',
      retry_count: (row.retry_count as number) || 0,
      cost: (row.cost as number) || 0,
    }));
  }

  // Get script runs by workflow_id
  async getScriptRunsByWorkflowId(workflow_id: string): Promise<ScriptRun[]> {
    const results = await this.db.db.execO<Record<string, unknown>>(
      `SELECT id, script_id, start_timestamp, end_timestamp, error, error_type, result, logs, workflow_id, type, retry_of, retry_count, cost
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
      error_type: (row.error_type as string) || '',
      result: row.result as string,
      logs: row.logs as string,
      workflow_id: row.workflow_id as string,
      type: row.type as string,
      retry_of: (row.retry_of as string) || '',
      retry_count: (row.retry_count as number) || 0,
      cost: (row.cost as number) || 0,
    }));
  }

  // Get latest script run for each of multiple workflow IDs in a single query
  // Returns a Map from workflow_id to its latest ScriptRun (or undefined if no runs exist)
  async getLatestRunsByWorkflowIds(workflowIds: string[]): Promise<Map<string, ScriptRun>> {
    if (workflowIds.length === 0) {
      return new Map();
    }

    // Build placeholders for the IN clause
    const placeholders = workflowIds.map(() => '?').join(', ');

    // Use a subquery to find the latest run for each workflow_id
    // This performs a single database query instead of N queries
    const results = await this.db.db.execO<Record<string, unknown>>(
      `SELECT sr.id, sr.script_id, sr.start_timestamp, sr.end_timestamp, sr.error, sr.error_type, sr.result, sr.logs, sr.workflow_id, sr.type, sr.retry_of, sr.retry_count, sr.cost
       FROM script_runs sr
       INNER JOIN (
         SELECT workflow_id, MAX(start_timestamp) as max_start
         FROM script_runs
         WHERE workflow_id IN (${placeholders})
         GROUP BY workflow_id
       ) latest ON sr.workflow_id = latest.workflow_id AND sr.start_timestamp = latest.max_start
       WHERE sr.workflow_id IN (${placeholders})`,
      [...workflowIds, ...workflowIds]
    );

    const runMap = new Map<string, ScriptRun>();

    if (!results) return runMap;

    for (const row of results) {
      const run: ScriptRun = {
        id: row.id as string,
        script_id: row.script_id as string,
        start_timestamp: row.start_timestamp as string,
        end_timestamp: row.end_timestamp as string,
        error: row.error as string,
        error_type: (row.error_type as string) || '',
        result: row.result as string,
        logs: row.logs as string,
        workflow_id: row.workflow_id as string,
        type: row.type as string,
        retry_of: (row.retry_of as string) || '',
        retry_count: (row.retry_count as number) || 0,
        cost: (row.cost as number) || 0,
      };
      runMap.set(run.workflow_id, run);
    }

    return runMap;
  }

  // Get the latest script version for a workflow
  async getLatestScriptByWorkflowId(workflow_id: string): Promise<Script | null> {
    const results = await this.db.db.execO<Record<string, unknown>>(
      `SELECT id, task_id, version, timestamp, code, change_comment, workflow_id, type, summary, diagram
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
      summary: row.summary as string,
      diagram: row.diagram as string,
    };
  }

  // Add a new workflow
  async addWorkflow(workflow: Workflow, tx?: DBInterface): Promise<void> {
    const db = tx || this.db.db;
    await db.exec(
      `INSERT INTO workflows (id, title, task_id, timestamp, cron, events, status, next_run_timestamp, maintenance, maintenance_fix_count)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [workflow.id, workflow.title, workflow.task_id, workflow.timestamp, workflow.cron, workflow.events, workflow.status, workflow.next_run_timestamp, workflow.maintenance ? 1 : 0, workflow.maintenance_fix_count || 0]
    );
  }

  // Update a workflow
  async updateWorkflow(workflow: Workflow, tx?: DBInterface): Promise<void> {
    const db = tx || this.db.db;
    await db.exec(
      `UPDATE workflows
       SET title = ?, task_id = ?, timestamp = ?, cron = ?, events = ?, status = ?, next_run_timestamp = ?, maintenance = ?, maintenance_fix_count = ?
       WHERE id = ?`,
      [workflow.title, workflow.task_id, workflow.timestamp, workflow.cron, workflow.events, workflow.status, workflow.next_run_timestamp, workflow.maintenance ? 1 : 0, workflow.maintenance_fix_count || 0, workflow.id]
    );
  }

  // Get a workflow by ID
  async getWorkflow(id: string): Promise<Workflow | null> {
    const results = await this.db.db.execO<Record<string, unknown>>(
      `SELECT id, title, task_id, timestamp, cron, events, status, next_run_timestamp, maintenance, maintenance_fix_count
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
      maintenance_fix_count: (row.maintenance_fix_count as number) || 0,
    };
  }

  // Get workflow by task_id
  async getWorkflowByTaskId(task_id: string): Promise<Workflow | null> {
    const results = await this.db.db.execO<Record<string, unknown>>(
      `SELECT id, title, task_id, timestamp, cron, events, status, next_run_timestamp, maintenance, maintenance_fix_count
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
      maintenance_fix_count: (row.maintenance_fix_count as number) || 0,
    };
  }

  // List workflows with pagination
  async listWorkflows(
    limit: number = 100,
    offset: number = 0
  ): Promise<Workflow[]> {
    const results = await this.db.db.execO<Record<string, unknown>>(
      `SELECT id, title, task_id, timestamp, cron, events, status, next_run_timestamp, maintenance, maintenance_fix_count
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
      maintenance_fix_count: (row.maintenance_fix_count as number) || 0,
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

  // Increment the maintenance fix count for a workflow (when entering maintenance mode)
  async incrementMaintenanceFixCount(workflowId: string, tx?: DBInterface): Promise<number> {
    const db = tx || this.db.db;
    await db.exec(
      `UPDATE workflows SET maintenance_fix_count = maintenance_fix_count + 1 WHERE id = ?`,
      [workflowId]
    );
    // Return the new count
    const result = await (tx || this.db.db).execO<{ maintenance_fix_count: number }>(
      `SELECT maintenance_fix_count FROM workflows WHERE id = ?`,
      [workflowId]
    );
    return result && result.length > 0 ? result[0].maintenance_fix_count : 0;
  }

  // Reset the maintenance fix count (when a fix succeeds or workflow runs successfully)
  async resetMaintenanceFixCount(workflowId: string, tx?: DBInterface): Promise<void> {
    const db = tx || this.db.db;
    await db.exec(
      `UPDATE workflows SET maintenance_fix_count = 0 WHERE id = ?`,
      [workflowId]
    );
  }

  // Update only specific fields of a workflow atomically
  // This prevents concurrent update issues where stale workflow objects overwrite concurrent changes
  async updateWorkflowFields(
    workflowId: string,
    fields: Partial<Pick<Workflow, 'timestamp' | 'next_run_timestamp' | 'status' | 'cron' | 'maintenance' | 'maintenance_fix_count'>>,
    tx?: DBInterface
  ): Promise<void> {
    const db = tx || this.db.db;

    const setClauses: string[] = [];
    const values: (string | number)[] = [];

    if (fields.timestamp !== undefined) {
      setClauses.push('timestamp = ?');
      values.push(fields.timestamp);
    }
    if (fields.next_run_timestamp !== undefined) {
      setClauses.push('next_run_timestamp = ?');
      values.push(fields.next_run_timestamp);
    }
    if (fields.status !== undefined) {
      setClauses.push('status = ?');
      values.push(fields.status);
    }
    if (fields.cron !== undefined) {
      setClauses.push('cron = ?');
      values.push(fields.cron);
    }
    if (fields.maintenance !== undefined) {
      setClauses.push('maintenance = ?');
      values.push(fields.maintenance ? 1 : 0);
    }
    if (fields.maintenance_fix_count !== undefined) {
      setClauses.push('maintenance_fix_count = ?');
      values.push(fields.maintenance_fix_count);
    }

    if (setClauses.length === 0) return;

    values.push(workflowId);
    await db.exec(
      `UPDATE workflows SET ${setClauses.join(', ')} WHERE id = ?`,
      values
    );
  }
}
