import { CRSqliteDB } from "./database";

export interface Task {
  id: string;
  user_id: string;
  timestamp: number;
  task: string;
  reply: string;
  state: string;
  thread_id: string;
  error: string;
  type: string;
  title: string;
  cron: string;
}

export class TaskStore {
  private db: CRSqliteDB;
  private user_id: string;

  constructor(db: CRSqliteDB, user_id: string) {
    this.db = db;
    this.user_id = user_id;
  }

  // Set a new task - fails if task for this timestamp already exists for this user
  async addTask(
    id: string,
    timestamp: number,
    task: string,
    type: string = "",
    thread_id: string = "",
    title: string = "",
    cron: string = ""
  ): Promise<string> {
    // Insert new task
    await this.db.db.exec(
      `INSERT INTO tasks (id, user_id, timestamp, task, reply, state, thread_id, error, type, title, cron)
          VALUES (?, ?, ?, ?, '', '', ?, '', ?, ?, ?)`,
      [id, this.user_id, timestamp, task, thread_id, type, title, cron]
    );

    return id;
  }

  // List tasks - returns up to 100 most recent tasks
  async listTasks(
    include_finished: boolean = false,
    until?: number
  ): Promise<Task[]> {
    let sql = `SELECT id, user_id, timestamp, task, reply, state, thread_id, error, type, title, cron
               FROM tasks`;
    const args: (string | number)[] = [];

    const conditions: string[] = [];

    // Filter by user_id
    conditions.push("user_id = ?");
    args.push(this.user_id);

    // Filter by state if not including finished tasks
    if (!include_finished) {
      conditions.push("state = ''");
    }

    // Always filter out deleted tasks
    conditions.push("(deleted IS NULL OR deleted = FALSE)");

    // Always filter out planner tasks (only show regular tasks to users)
    conditions.push("(type IS NULL OR type = '')");

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
      user_id: row.user_id as string,
      timestamp: row.timestamp as number,
      task: row.task as string,
      reply: row.reply as string,
      state: row.state as string,
      thread_id: row.thread_id as string,
      error: row.error as string,
      type: (row.type as string) || "",
      title: (row.title as string) || "",
      cron: (row.cron as string) || "",
    }));
  }

  // Delete task by ID - returns true if task was found and deleted, false if not found
  async deleteTask(id: string): Promise<void> {
    // Mark the task as deleted
    await this.db.db.exec(
      `UPDATE tasks SET deleted = TRUE WHERE id = ? AND user_id = ? AND (deleted IS NULL OR deleted = FALSE)`,
      [id, this.user_id]
    );

    // Note: cr-sqlite exec doesn't return changes count like better-sqlite3
    // We'll assume the operation succeeded if no error was thrown
  }

  // Get task with oldest timestamp with reply '' for this user that is ready to trigger (timestamp <= now)
  // Prioritizes tasks with 'message' type over other types
  async getNextTask(): Promise<Task | null> {
    const currentTimeSeconds = Math.floor(Date.now() / 1000); // Convert milliseconds to seconds

    // Fetch all pending tasks (no LIMIT 1)
    const results = await this.db.db.execO<Record<string, unknown>>(
      `SELECT id, user_id, timestamp, task, reply, state, thread_id, error, type, title, cron
          FROM tasks
          WHERE user_id = ? AND state = '' AND timestamp <= ? AND (deleted IS NULL OR deleted = FALSE)
          ORDER BY timestamp ASC`,
      [this.user_id, currentTimeSeconds]
    );

    if (!results || results.length === 0) {
      return null;
    }

    // Convert results to Task objects
    const tasks: Task[] = results.map((row) => ({
      id: row.id as string,
      user_id: row.user_id as string,
      timestamp: row.timestamp as number,
      task: row.task as string,
      reply: row.reply as string,
      state: row.state as string,
      thread_id: row.thread_id as string,
      error: row.error as string,
      type: (row.type as string) || "",
      title: (row.title as string) || "",
      cron: (row.cron as string) || "",
    }));

    // First, look for tasks with 'message' type
    const messageTask = tasks.find(task => task.type === 'message');
    if (messageTask) {
      return messageTask;
    }

    // If no 'message' type task found, return the oldest task (first in the ordered list)
    return tasks[0];
  }

  // Get task by user_id and id
  async getTask(id: string): Promise<Task> {
    const results = await this.db.db.execO<Record<string, unknown>>(
      `SELECT id, user_id, timestamp, task, reply, state, thread_id, error, type, title, cron
          FROM tasks
          WHERE user_id = ? AND id = ? AND (deleted IS NULL OR deleted = FALSE)`,
      [this.user_id, id]
    );

    if (!results || results.length === 0) {
      throw new Error("Task not found");
    }

    const row = results[0];
    return {
      id: row.id as string,
      user_id: row.user_id as string,
      timestamp: row.timestamp as number,
      task: row.task as string,
      reply: row.reply as string,
      state: row.state as string,
      thread_id: row.thread_id as string,
      error: row.error as string,
      type: (row.type as string) || "",
      title: (row.title as string) || "",
      cron: (row.cron as string) || "",
    };
  }

  // Finish task - error if user_id+timestamp not found or already reply !== '', error if input reply === ''
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
          WHERE user_id = ? AND id = ? AND (deleted IS NULL OR deleted = FALSE) AND reply = ''`,
      [reply, state, thread_id, error, this.user_id, id]
    );

    // Note: cr-sqlite exec doesn't return changes count like better-sqlite3
    // We'll assume the operation succeeded if no error was thrown
  }

  // Update task - updates all fields of an existing task
  async updateTask(task: Task): Promise<void> {
    // Update the task with all provided values
    await this.db.db.exec(
      `UPDATE tasks
          SET user_id = ?, timestamp = ?, task = ?, reply = ?, state = ?, thread_id = ?, error = ?, type = ?, title = ?, cron = ?
          WHERE id = ? AND (deleted IS NULL OR deleted = FALSE)`,
      [
        task.user_id,
        task.timestamp,
        task.task,
        task.reply,
        task.state,
        task.thread_id,
        task.error,
        task.type,
        task.title,
        task.cron,
        task.id,
      ]
    );

    // Note: cr-sqlite exec doesn't return changes count like better-sqlite3
    // We'll assume the operation succeeded if no error was thrown
  }

  // Check if there's a cron task of a specific type
  async hasCronTaskOfType(taskType: string): Promise<boolean> {
    const results = await this.db.db.execO<{ count: number }>(
      `SELECT COUNT(*) as count
          FROM tasks
          WHERE user_id = ? AND type = ? AND cron != '' AND (deleted IS NULL OR deleted = FALSE)`,
      [this.user_id, taskType]
    );

    const count = results?.[0]?.count || 0;
    return count > 0;
  }

  // Get the next midnight timestamp in local time
  // FIXME: This assumes the server's timezone is the user's local timezone.
  // In a multi-user system, this should be configurable per user or use a specific timezone.
  getNextMidnightTimestamp(): number {
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 1, 0, 0); // 00:01 to make sure "today" means today
    return Math.floor(tomorrow.getTime() / 1000);
  }
}
