import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DBInterface, KeepDb, TaskStore, Task, TaskRun, TaskRunStart, TaskRunEnd } from "@app/db";
import { createDBNode } from "@app/node";

/**
 * Helper to create tasks and task_runs tables without full migration system.
 * This allows testing the store in isolation without CR-SQLite dependencies.
 */
async function createTaskTables(db: DBInterface): Promise<void> {
  // Create tasks table (matches production v1 + v15 + v31 migrations)
  await db.exec(`
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY NOT NULL,
      timestamp INTEGER NOT NULL DEFAULT 0,
      reply TEXT NOT NULL DEFAULT '',
      state TEXT NOT NULL DEFAULT '',
      thread_id TEXT NOT NULL DEFAULT '',
      error TEXT NOT NULL DEFAULT '',
      type TEXT NOT NULL DEFAULT '',
      title TEXT NOT NULL DEFAULT '',
      chat_id TEXT NOT NULL DEFAULT '',
      workflow_id TEXT NOT NULL DEFAULT '',
      asks TEXT NOT NULL DEFAULT '',
      deleted BOOLEAN DEFAULT FALSE
    )
  `);
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_tasks_chat_id ON tasks(chat_id)`);
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_tasks_workflow_id ON tasks(workflow_id)`);

  // Create task_runs table (matches production v6 + later migrations)
  await db.exec(`
    CREATE TABLE IF NOT EXISTS task_runs (
      id TEXT PRIMARY KEY NOT NULL,
      task_id TEXT NOT NULL DEFAULT '',
      type TEXT NOT NULL DEFAULT '',
      start_timestamp TEXT NOT NULL DEFAULT '',
      thread_id TEXT NOT NULL DEFAULT '',
      reason TEXT NOT NULL DEFAULT '',
      inbox TEXT NOT NULL DEFAULT '',
      model TEXT NOT NULL DEFAULT '',
      input_goal TEXT NOT NULL DEFAULT '',
      input_notes TEXT NOT NULL DEFAULT '',
      input_plan TEXT NOT NULL DEFAULT '',
      input_asks TEXT NOT NULL DEFAULT '',
      output_goal TEXT NOT NULL DEFAULT '',
      output_notes TEXT NOT NULL DEFAULT '',
      output_plan TEXT NOT NULL DEFAULT '',
      output_asks TEXT NOT NULL DEFAULT '',
      end_timestamp TEXT NOT NULL DEFAULT '',
      state TEXT NOT NULL DEFAULT '',
      reply TEXT NOT NULL DEFAULT '',
      error TEXT NOT NULL DEFAULT '',
      steps INTEGER NOT NULL DEFAULT 0,
      run_sec INTEGER NOT NULL DEFAULT 0,
      input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      cached_tokens INTEGER NOT NULL DEFAULT 0,
      cost INTEGER NOT NULL DEFAULT 0,
      logs TEXT NOT NULL DEFAULT ''
    )
  `);
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_task_runs_task_id ON task_runs(task_id)`);
}

describe("TaskStore", () => {
  let db: DBInterface;
  let keepDb: KeepDb;
  let taskStore: TaskStore;

  beforeEach(async () => {
    db = await createDBNode(":memory:");
    keepDb = new KeepDb(db);
    await createTaskTables(db);
    taskStore = new TaskStore(keepDb);
  });

  afterEach(async () => {
    if (db) {
      await db.close();
    }
  });

  describe("Task CRUD operations", () => {
    const createTask = (overrides: Partial<Task> = {}): Task => ({
      id: "task-1",
      timestamp: Date.now(),
      reply: "",
      error: "",
      state: "pending",
      thread_id: "",
      type: "worker",
      title: "Test Task",
      chat_id: "chat-1",
      workflow_id: "workflow-1",
      asks: "",
      ...overrides,
    });

    it("should add and retrieve a task", async () => {
      const task = createTask();
      await taskStore.addTask(task);

      const retrieved = await taskStore.getTask("task-1");
      expect(retrieved.id).toBe(task.id);
      expect(retrieved.title).toBe(task.title);
      expect(retrieved.chat_id).toBe(task.chat_id);
      expect(retrieved.workflow_id).toBe(task.workflow_id);
    });

    it("should throw for non-existent task", async () => {
      await expect(taskStore.getTask("non-existent")).rejects.toThrow("Task not found");
    });

    it("should get task by chat_id", async () => {
      await taskStore.addTask(createTask({ id: "task-1", chat_id: "chat-1" }));
      await taskStore.addTask(createTask({ id: "task-2", chat_id: "chat-2" }));

      const task = await taskStore.getTaskByChatId("chat-1");
      expect(task?.id).toBe("task-1");
    });

    it("should return null for non-existent chat_id", async () => {
      const task = await taskStore.getTaskByChatId("non-existent");
      expect(task).toBeNull();
    });

    it("should get task by workflow_id", async () => {
      await taskStore.addTask(createTask({ id: "task-1", workflow_id: "workflow-1" }));
      await taskStore.addTask(createTask({ id: "task-2", workflow_id: "workflow-2", chat_id: "chat-2" }));

      const task = await taskStore.getTaskByWorkflowId("workflow-1");
      expect(task?.id).toBe("task-1");
    });

    it("should update a task", async () => {
      const task = createTask();
      await taskStore.addTask(task);

      task.title = "Updated Title";
      task.state = "running";
      task.asks = JSON.stringify([{ question: "Test?" }]);
      await taskStore.updateTask(task);

      const updated = await taskStore.getTask("task-1");
      expect(updated.title).toBe("Updated Title");
      expect(updated.state).toBe("running");
      expect(updated.asks).toBe(JSON.stringify([{ question: "Test?" }]));
    });

    it("should update task asks only", async () => {
      const task = createTask({ title: "Original Title" });
      await taskStore.addTask(task);

      const asks = JSON.stringify([{ question: "What do you want?" }]);
      await taskStore.updateTaskAsks("task-1", asks);

      const updated = await taskStore.getTask("task-1");
      expect(updated.asks).toBe(asks);
      expect(updated.title).toBe("Original Title"); // Unchanged
    });

    it("should delete a task (soft delete)", async () => {
      await taskStore.addTask(createTask());
      await taskStore.deleteTask("task-1");

      // Task should no longer be retrievable
      await expect(taskStore.getTask("task-1")).rejects.toThrow("Task not found");
    });

    it("should not return deleted tasks in list", async () => {
      await taskStore.addTask(createTask({ id: "task-1" }));
      await taskStore.addTask(createTask({ id: "task-2", chat_id: "chat-2" }));
      await taskStore.deleteTask("task-1");

      const tasks = await taskStore.listTasks(true);
      expect(tasks).toHaveLength(1);
      expect(tasks[0].id).toBe("task-2");
    });

    it("should list tasks with filters", async () => {
      const now = Date.now();
      await taskStore.addTask(createTask({ id: "task-1", state: "pending", type: "worker", timestamp: now - 2000 }));
      await taskStore.addTask(createTask({ id: "task-2", state: "finished", type: "worker", timestamp: now - 1000, chat_id: "c2" }));
      await taskStore.addTask(createTask({ id: "task-3", state: "pending", type: "planner", timestamp: now, chat_id: "c3" }));

      // List all (including finished)
      const all = await taskStore.listTasks(true);
      expect(all).toHaveLength(3);
      // Should be ordered by timestamp DESC
      expect(all[0].id).toBe("task-3");

      // Exclude finished
      const notFinished = await taskStore.listTasks(false);
      expect(notFinished).toHaveLength(2);
      expect(notFinished.find(t => t.id === "task-2")).toBeUndefined();

      // Filter by type
      const workers = await taskStore.listTasks(true, "worker");
      expect(workers).toHaveLength(2);

      // Filter by until timestamp
      const older = await taskStore.listTasks(true, undefined, now - 500);
      expect(older).toHaveLength(2);
      expect(older.find(t => t.id === "task-3")).toBeUndefined();
    });

    it("should get multiple tasks by IDs", async () => {
      await taskStore.addTask(createTask({ id: "task-1" }));
      await taskStore.addTask(createTask({ id: "task-2", chat_id: "c2" }));
      await taskStore.addTask(createTask({ id: "task-3", chat_id: "c3" }));

      const tasks = await taskStore.getTasks(["task-1", "task-3"]);
      expect(tasks).toHaveLength(2);
      expect(tasks.find(t => t.id === "task-1")).toBeDefined();
      expect(tasks.find(t => t.id === "task-3")).toBeDefined();
    });

    it("should return empty array for empty IDs", async () => {
      const tasks = await taskStore.getTasks([]);
      expect(tasks).toHaveLength(0);
    });

    it("should finish a task", async () => {
      await taskStore.addTask(createTask({ state: "pending" }));
      await taskStore.finishTask("task-1", "thread-123", "Task completed successfully", "");

      const task = await taskStore.getTask("task-1");
      expect(task.state).toBe("finished");
      expect(task.reply).toBe("Task completed successfully");
      expect(task.thread_id).toBe("thread-123");
    });

    it("should finish task with error", async () => {
      await taskStore.addTask(createTask({ state: "pending" }));
      await taskStore.finishTask("task-1", "thread-123", "Error occurred", "Something went wrong");

      const task = await taskStore.getTask("task-1");
      expect(task.state).toBe("error");
      expect(task.reply).toBe("Error occurred");
      expect(task.error).toBe("Something went wrong");
    });

    it("should throw when finishing with empty reply", async () => {
      await taskStore.addTask(createTask());
      await expect(taskStore.finishTask("task-1", "thread-123", "", "")).rejects.toThrow("Reply cannot be empty");
    });
  });

  describe("TaskRun operations", () => {
    const createTaskRunStart = (overrides: Partial<TaskRunStart> = {}): TaskRunStart => ({
      id: "run-1",
      task_id: "task-1",
      type: "worker",
      start_timestamp: new Date().toISOString(),
      thread_id: "thread-1",
      reason: "input",
      inbox: "User message",
      input_goal: "Test goal",
      input_notes: "",
      input_plan: "",
      input_asks: "",
      model: "gpt-4",
      ...overrides,
    });

    const createTaskRunEnd = (overrides: Partial<TaskRunEnd> = {}): TaskRunEnd => ({
      id: "run-1",
      end_timestamp: new Date().toISOString(),
      output_goal: "Completed goal",
      output_notes: "",
      output_plan: "",
      output_asks: "",
      state: "done",
      reply: "Task completed",
      steps: 5,
      run_sec: 10,
      input_tokens: 100,
      output_tokens: 200,
      cached_tokens: 50,
      cost: 1000,
      logs: "Log entries",
      ...overrides,
    });

    it("should create and retrieve a task run", async () => {
      const runStart = createTaskRunStart();
      await taskStore.createTaskRun(runStart);

      const run = await taskStore.getTaskRun("run-1");
      expect(run.id).toBe("run-1");
      expect(run.task_id).toBe("task-1");
      expect(run.model).toBe("gpt-4");
      expect(run.inbox).toBe("User message");
      // End fields should be empty/zero
      expect(run.end_timestamp).toBe("");
      expect(run.state).toBe("");
    });

    it("should finish a task run", async () => {
      await taskStore.createTaskRun(createTaskRunStart());
      await taskStore.finishTaskRun(createTaskRunEnd());

      const run = await taskStore.getTaskRun("run-1");
      expect(run.state).toBe("done");
      expect(run.reply).toBe("Task completed");
      expect(run.steps).toBe(5);
      expect(run.run_sec).toBe(10);
      expect(run.cost).toBe(1000);
    });

    it("should error a task run", async () => {
      await taskStore.createTaskRun(createTaskRunStart());
      await taskStore.errorTaskRun("run-1", new Date().toISOString(), "Something went wrong");

      const run = await taskStore.getTaskRun("run-1");
      expect(run.state).toBe("error");
      expect(run.error).toBe("Something went wrong");
    });

    it("should throw for non-existent task run", async () => {
      await expect(taskStore.getTaskRun("non-existent")).rejects.toThrow("Task run not found");
    });

    it("should list task runs by task_id", async () => {
      const now = Date.now();
      await taskStore.createTaskRun(createTaskRunStart({
        id: "run-1",
        task_id: "task-1",
        start_timestamp: new Date(now - 2000).toISOString(),
      }));
      await taskStore.createTaskRun(createTaskRunStart({
        id: "run-2",
        task_id: "task-1",
        start_timestamp: new Date(now - 1000).toISOString(),
      }));
      await taskStore.createTaskRun(createTaskRunStart({
        id: "run-3",
        task_id: "task-2",
        start_timestamp: new Date(now).toISOString(),
      }));

      const runs = await taskStore.listTaskRuns("task-1");
      expect(runs).toHaveLength(2);
      // Should be ordered by start_timestamp DESC
      expect(runs[0].id).toBe("run-2");
      expect(runs[1].id).toBe("run-1");
    });

    it("should track token usage and cost", async () => {
      await taskStore.createTaskRun(createTaskRunStart());
      await taskStore.finishTaskRun(createTaskRunEnd({
        input_tokens: 500,
        output_tokens: 1000,
        cached_tokens: 200,
        cost: 5000, // microdollars
      }));

      const run = await taskStore.getTaskRun("run-1");
      expect(run.input_tokens).toBe(500);
      expect(run.output_tokens).toBe(1000);
      expect(run.cached_tokens).toBe(200);
      expect(run.cost).toBe(5000);
    });

    it("should store input and output state", async () => {
      await taskStore.createTaskRun(createTaskRunStart({
        input_goal: "Initial goal",
        input_notes: "Initial notes",
        input_plan: "Initial plan",
        input_asks: JSON.stringify([{ q: "Question 1" }]),
      }));
      await taskStore.finishTaskRun(createTaskRunEnd({
        output_goal: "Updated goal",
        output_notes: "Updated notes",
        output_plan: "Updated plan",
        output_asks: JSON.stringify([{ q: "Question 2" }]),
      }));

      const run = await taskStore.getTaskRun("run-1");
      expect(run.input_goal).toBe("Initial goal");
      expect(run.output_goal).toBe("Updated goal");
      expect(run.input_asks).toBe(JSON.stringify([{ q: "Question 1" }]));
      expect(run.output_asks).toBe(JSON.stringify([{ q: "Question 2" }]));
    });
  });
});
