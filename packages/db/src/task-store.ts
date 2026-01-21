import { CRSqliteDB } from "./database";
import { DBInterface, validateInClauseLength } from "./interfaces";

export type TaskType = "worker" | "planner";

export interface Task {
  id: string;
  timestamp: number;
  // task: string;
  reply: string;
  error: string;
  state: string;
  thread_id: string;
  type: string;
  title: string;
  // cron: string;
  chat_id: string;
}

export interface TaskState {
  id: string;
  goal: string;
  notes: string;
  plan: string;
  asks: string;
}

export interface TaskRun {
  id: string;
  task_id: string;
  type: string;
  start_timestamp: string;
  thread_id: string;
  reason: string; // "input" only left
  inbox: string;
  model: string;
  input_goal: string;
  input_notes: string;
  input_plan: string;
  input_asks: string;
  output_goal: string;
  output_notes: string;
  output_plan: string;
  output_asks: string;
  end_timestamp: string;
  state: string; // error | done | wait
  reply: string;
  error: string;
  steps: number;
  run_sec: number;
  input_tokens: number;
  output_tokens: number;
  cached_tokens: number;
  cost: number;
  logs: string;
}

export interface TaskRunStart {
  id: string;
  task_id: string;
  type: string;
  start_timestamp: string;
  thread_id: string;
  reason: string; // start | input | timer
  inbox: string;
  input_goal: string;
  input_notes: string;
  input_plan: string;
  input_asks: string;
  model: string;
}

export interface TaskRunEnd {
  id: string;
  end_timestamp: string;
  output_goal: string;
  output_notes: string;
  output_plan: string;
  output_asks: string;
  state: string; // done | wait
  reply: string;
  steps: number;
  run_sec: number;
  input_tokens: number;
  output_tokens: number;
  cached_tokens: number;
  cost: number;
  logs: string;
}

export class TaskStore {
  private db: CRSqliteDB;

  constructor(db: CRSqliteDB) {
    this.db = db;
  }

  // Set a new task - fails if task for this timestamp already exists for this user
  async addTask(task: Task, tx?: DBInterface): Promise<string> {
    // Insert new task
    const db = tx || this.db.db;
    await db.exec(
      `INSERT INTO tasks (id, timestamp, reply, state, thread_id, error, type, title, chat_id)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        task.id,
        task.timestamp,
        task.reply,
        task.state,
        task.thread_id,
        task.error,
        task.type,
        task.title,
        task.chat_id,
      ]
    );

    return task.id;
  }

  // List tasks - returns up to 100 most recent tasks
  async listTasks(
    include_finished: boolean = false,
    type?: string,
    until?: number
  ): Promise<Task[]> {
    let sql = `SELECT id, timestamp, reply, state, thread_id, error, type, title, chat_id
               FROM tasks`;
    const args: (string | number)[] = [];

    const conditions: string[] = [];

    // Filter by state if not including finished tasks
    if (!include_finished) {
      conditions.push("state != ? AND state != ?");
      args.push("finished");
      args.push("error");
    }

    // Always filter out deleted tasks
    conditions.push("(deleted IS NULL OR deleted = FALSE)");

    // Only show worker tasks
    if (type) {
      conditions.push("type = ?");
      args.push(type);
    }

    // Filter by until timestamp if provided
    if (until !== undefined) {
      conditions.push("timestamp <= ?");
      args.push(until);
    }

    // Add WHERE clause if we have conditions
    if (conditions.length > 0) {
      sql += ` WHERE ${conditions.join(" AND ")}`;
    }

    // Order by timestamp descending (most recent first) and limit to 100
    sql += ` ORDER BY timestamp DESC LIMIT 100`;

    const results = await this.db.db.execO<Record<string, unknown>>(sql, args);

    if (!results) return [];

    return results.map((row) => ({
      id: row.id as string,
      timestamp: row.timestamp as number,
      reply: row.reply as string,
      state: row.state as string,
      thread_id: row.thread_id as string,
      error: row.error as string,
      type: (row.type as string) || "",
      title: (row.title as string) || "",
      chat_id: (row.chat_id as string) || "",
    }));
  }

  // Delete task by ID - returns true if task was found and deleted, false if not found
  async deleteTask(id: string): Promise<void> {
    // Mark the task as deleted
    await this.db.db.exec(
      `UPDATE tasks SET deleted = TRUE WHERE id = ? AND (deleted IS NULL OR deleted = FALSE)`,
      [id]
    );

    // Note: cr-sqlite exec doesn't return changes count like better-sqlite3
    // We'll assume the operation succeeded if no error was thrown
  }

  // Get task by id
  async getTask(id: string): Promise<Task> {
    const results = await this.db.db.execO<Record<string, unknown>>(
      `SELECT id, timestamp, reply, state, thread_id, error, type, title, chat_id
          FROM tasks
          WHERE id = ? AND (deleted IS NULL OR deleted = FALSE)`,
      [id]
    );

    if (!results || results.length === 0) {
      throw new Error("Task not found");
    }

    const row = results[0];
    return {
      id: row.id as string,
      timestamp: row.timestamp as number,
      reply: row.reply as string,
      state: row.state as string,
      thread_id: row.thread_id as string,
      error: row.error as string,
      type: (row.type as string) || "",
      title: (row.title as string) || "",
      chat_id: (row.chat_id as string) || "",
    };
  }


  // Get task by chat_id
  async getTaskByChatId(chatId: string, tx?: DBInterface): Promise<Task | null> {
    const db = tx || this.db.db;
    const results = await db.execO<Record<string, unknown>>(
      `SELECT id, timestamp, reply, state, thread_id, error, type, title, chat_id
          FROM tasks
          WHERE chat_id = ? AND (deleted IS NULL OR deleted = FALSE)`,
      [chatId]
    );

    if (!results || results.length === 0) {
      return null;
    }

    const row = results[0];
    return {
      id: row.id as string,
      timestamp: row.timestamp as number,
      reply: row.reply as string,
      state: row.state as string,
      thread_id: row.thread_id as string,
      error: row.error as string,
      type: (row.type as string) || "",
      title: (row.title as string) || "",
      chat_id: (row.chat_id as string) || "",
    };
  }

  // Get tasks by IDs
  async getTasks(ids: string[]): Promise<Task[]> {
    if (ids.length === 0) {
      return [];
    }
    validateInClauseLength(ids, 'getTasks');

    // Create placeholders for the IN clause (?, ?, ?, ...)
    const placeholders = ids.map(() => "?").join(", ");

    const sql = `SELECT id, timestamp, reply, state, thread_id, error, type, title, chat_id
                 FROM tasks
                 WHERE id IN (${placeholders}) AND (deleted IS NULL OR deleted = FALSE)
                 ORDER BY timestamp DESC`;

    const results = await this.db.db.execO<Record<string, unknown>>(sql, ids);

    if (!results) return [];

    return results.map((row) => ({
      id: row.id as string,
      timestamp: row.timestamp as number,
      reply: row.reply as string,
      state: row.state as string,
      thread_id: row.thread_id as string,
      error: row.error as string,
      type: (row.type as string) || "",
      title: (row.title as string) || "",
      chat_id: (row.chat_id as string) || "",
    }));
  }

  // Finish task - error if id not found or already reply !== '', error if input reply === ''
  async finishTask(
    id: string,
    thread_id: string,
    reply: string,
    error: string
  ): Promise<void> {
    if (reply === "") throw new Error("Reply cannot be empty");

    // Determine state based on reply and error
    let state = "";
    if (error !== "") {
      state = "error";
    } else if (reply !== "") {
      state = "finished";
    }

    // Update the task
    await this.db.db.exec(
      `UPDATE tasks
          SET reply = ?, state = ?, thread_id = ?, error = ?
          WHERE id = ? AND (deleted IS NULL OR deleted = FALSE)`,
      [reply, state, thread_id, error, id]
    );

    // Note: cr-sqlite exec doesn't return changes count like better-sqlite3
    // We'll assume the operation succeeded if no error was thrown
  }

  // Update task - updates all fields of an existing task
  async updateTask(task: Task, tx?: DBInterface): Promise<void> {
    // Update the task with all provided values
    const db = tx || this.db.db;
    await db.exec(
      `UPDATE tasks
          SET timestamp = ?, reply = ?, state = ?, thread_id = ?, error = ?, type = ?, title = ?, chat_id = ?
          WHERE id = ? AND (deleted IS NULL OR deleted = FALSE)`,
      [
        task.timestamp,
        task.reply,
        task.state,
        task.thread_id,
        task.error,
        task.type,
        task.title,
        task.chat_id,
        task.id,
      ]
    );

    // Note: cr-sqlite exec doesn't return changes count like better-sqlite3
    // We'll assume the operation succeeded if no error was thrown
  }

  // Save task state - overwrites by id if it exists
  async saveState(taskState: TaskState): Promise<void> {
    await this.db.db.exec(
      `INSERT OR REPLACE INTO task_states (id, goal, notes, plan, asks)
          VALUES (?, ?, ?, ?, ?)`,
      [
        taskState.id,
        taskState.goal,
        taskState.notes,
        taskState.plan,
        taskState.asks,
      ]
    );
  }

  // Get task state by id
  async getState(id: string): Promise<TaskState | null> {
    const results = await this.db.db.execO<Record<string, unknown>>(
      `SELECT id, goal, notes, plan, asks
          FROM task_states
          WHERE id = ?`,
      [id]
    );

    if (!results || results.length === 0) {
      return null;
    }

    const row = results[0];
    return {
      id: row.id as string,
      goal: row.goal as string,
      notes: row.notes as string,
      plan: row.plan as string,
      asks: row.asks as string,
    };
  }

  // Get task states by IDs
  async getStates(ids: string[]): Promise<TaskState[]> {
    if (ids.length === 0) {
      return [];
    }
    validateInClauseLength(ids, 'getStates');

    // Create placeholders for the IN clause (?, ?, ?, ...)
    const placeholders = ids.map(() => "?").join(", ");

    const sql = `SELECT id, goal, notes, plan, asks
                 FROM task_states
                 WHERE id IN (${placeholders})`;

    const results = await this.db.db.execO<Record<string, unknown>>(sql, ids);

    if (!results) return [];

    return results.map((row) => ({
      id: row.id as string,
      goal: row.goal as string,
      notes: row.notes as string,
      plan: row.plan as string,
      asks: row.asks as string,
    }));
  }

  // Create a new task run
  async createTaskRun(runStart: TaskRunStart): Promise<void> {
    await this.db.db.exec(
      `INSERT INTO task_runs (
        id, task_id, type, start_timestamp, thread_id, reason, inbox, model,
        input_goal, input_notes, input_plan, input_asks,
        output_goal, output_notes, output_plan, output_asks,
        end_timestamp, state, reply, error, steps, run_sec,
        input_tokens, output_tokens, cached_tokens, cost, logs
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', '', '', '', '', '', '', '', 0, 0, 0, 0, 0, 0, '')`,
      [
        runStart.id,
        runStart.task_id,
        runStart.type,
        runStart.start_timestamp,
        runStart.thread_id,
        runStart.reason,
        runStart.inbox,
        runStart.model,
        runStart.input_goal,
        runStart.input_notes,
        runStart.input_plan,
        runStart.input_asks,
      ]
    );
  }

  // Finish a task run by updating it with end data
  async finishTaskRun(runEnd: TaskRunEnd): Promise<void> {
    await this.db.db.exec(
      `UPDATE task_runs SET
        end_timestamp = ?,
        output_goal = ?,
        output_notes = ?,
        output_plan = ?,
        output_asks = ?,
        state = ?,
        reply = ?,
        steps = ?,
        run_sec = ?,
        input_tokens = ?,
        output_tokens = ?,
        cached_tokens = ?,
        cost = ?,
        logs = ?
      WHERE id = ?`,
      [
        runEnd.end_timestamp,
        runEnd.output_goal,
        runEnd.output_notes,
        runEnd.output_plan,
        runEnd.output_asks,
        runEnd.state,
        runEnd.reply,
        runEnd.steps,
        runEnd.run_sec,
        runEnd.input_tokens,
        runEnd.output_tokens,
        runEnd.cached_tokens,
        runEnd.cost,
        runEnd.logs,
        runEnd.id,
      ]
    );
  }

  // Finish a task run by updating it with end data
  async errorTaskRun(
    id: string,
    end_timestamp: string,
    error: string
  ): Promise<void> {
    await this.db.db.exec(
      `UPDATE task_runs SET
        end_timestamp = ?,
        state = ?,
        error = ?
      WHERE id = ?`,
      [end_timestamp, "error", error, id]
    );
  }

  // List all task runs for a specific task
  async listTaskRuns(taskId: string): Promise<TaskRun[]> {
    const results = await this.db.db.execO<Record<string, unknown>>(
      `SELECT
        id, task_id, type, start_timestamp, thread_id, reason, inbox, model,
        input_goal, input_notes, input_plan, input_asks,
        output_goal, output_notes, output_plan, output_asks,
        end_timestamp, state, reply, error, steps, run_sec,
        input_tokens, output_tokens, cached_tokens, cost, logs
      FROM task_runs
      WHERE task_id = ?
      ORDER BY start_timestamp DESC`,
      [taskId]
    );

    if (!results) return [];

    return results.map((row) => ({
      id: row.id as string,
      task_id: row.task_id as string,
      type: row.type as string,
      start_timestamp: row.start_timestamp as string,
      thread_id: row.thread_id as string,
      reason: row.reason as string,
      inbox: row.inbox as string,
      model: row.model as string,
      input_goal: row.input_goal as string,
      input_notes: row.input_notes as string,
      input_plan: row.input_plan as string,
      input_asks: row.input_asks as string,
      output_goal: row.output_goal as string,
      output_notes: row.output_notes as string,
      output_plan: row.output_plan as string,
      output_asks: row.output_asks as string,
      end_timestamp: row.end_timestamp as string,
      state: row.state as string,
      reply: row.reply as string,
      error: row.error as string,
      steps: row.steps as number,
      run_sec: row.run_sec as number,
      input_tokens: row.input_tokens as number,
      output_tokens: row.output_tokens as number,
      cached_tokens: row.cached_tokens as number,
      cost: row.cost as number,
      logs: row.logs as string,
    }));
  }

  // Get a specific task run by ID
  async getTaskRun(runId: string): Promise<TaskRun> {
    const results = await this.db.db.execO<Record<string, unknown>>(
      `SELECT
        id, task_id, type, start_timestamp, thread_id, reason, inbox, model,
        input_goal, input_notes, input_plan, input_asks,
        output_goal, output_notes, output_plan, output_asks,
        end_timestamp, state, reply, error, steps, run_sec,
        input_tokens, output_tokens, cached_tokens, cost, logs
      FROM task_runs
      WHERE id = ?`,
      [runId]
    );

    if (!results || results.length === 0) {
      throw new Error("Task run not found");
    }

    const row = results[0];
    return {
      id: row.id as string,
      task_id: row.task_id as string,
      type: row.type as string,
      start_timestamp: row.start_timestamp as string,
      thread_id: row.thread_id as string,
      reason: row.reason as string,
      inbox: row.inbox as string,
      model: row.model as string,
      input_goal: row.input_goal as string,
      input_notes: row.input_notes as string,
      input_plan: row.input_plan as string,
      input_asks: row.input_asks as string,
      output_goal: row.output_goal as string,
      output_notes: row.output_notes as string,
      output_plan: row.output_plan as string,
      output_asks: row.output_asks as string,
      end_timestamp: row.end_timestamp as string,
      state: row.state as string,
      reply: row.reply as string,
      error: row.error as string,
      steps: row.steps as number,
      run_sec: row.run_sec as number,
      input_tokens: row.input_tokens as number,
      output_tokens: row.output_tokens as number,
      cached_tokens: row.cached_tokens as number,
      cost: row.cost as number,
      logs: row.logs as string,
    };
  }
}
