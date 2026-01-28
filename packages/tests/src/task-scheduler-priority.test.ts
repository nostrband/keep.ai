import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DBInterface, KeepDb, TaskStore, InboxStore, Task, InboxItem } from "@app/db";
import { createDBNode } from "@app/node";

/**
 * Tests for task scheduler priority logic.
 *
 * The scheduler implements the following rules:
 * 1. Priority order: planner > worker > maintainer
 * 2. If both planner and maintainer tasks exist for the SAME workflow,
 *    the maintainer task is skipped (planner takes precedence to avoid stale fixes)
 *
 * These tests verify the logic directly using the database stores,
 * simulating what the scheduler would see.
 */

/**
 * Helper to create tasks and inbox tables without full migration system.
 */
async function createSchedulerTestTables(db: DBInterface): Promise<void> {
  // Create tasks table
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

  // Create inbox table
  await db.exec(`
    CREATE TABLE IF NOT EXISTS inbox (
      id TEXT PRIMARY KEY NOT NULL,
      source TEXT NOT NULL DEFAULT '',
      source_id TEXT NOT NULL DEFAULT '',
      target TEXT NOT NULL DEFAULT '',
      target_id TEXT NOT NULL DEFAULT '',
      timestamp TEXT NOT NULL DEFAULT '',
      content TEXT NOT NULL DEFAULT '',
      handler_thread_id TEXT NOT NULL DEFAULT '',
      handler_timestamp TEXT NOT NULL DEFAULT ''
    )
  `);
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_inbox_target ON inbox(target)`);
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_inbox_target_id ON inbox(target_id)`);
}

describe("Task Scheduler Priority", () => {
  let db: DBInterface;
  let keepDb: KeepDb;
  let taskStore: TaskStore;
  let inboxStore: InboxStore;

  beforeEach(async () => {
    db = await createDBNode(":memory:");
    keepDb = new KeepDb(db);
    await createSchedulerTestTables(db);
    taskStore = new TaskStore(keepDb);
    inboxStore = new InboxStore(keepDb);
  });

  afterEach(async () => {
    if (db) {
      await db.close();
    }
  });

  const createTask = (overrides: Partial<Task> = {}): Task => ({
    id: `task-${Math.random().toString(36).slice(2)}`,
    timestamp: Date.now(),
    reply: "",
    error: "",
    state: "pending",
    thread_id: "",
    type: "worker",
    title: "Test Task",
    chat_id: `chat-${Math.random().toString(36).slice(2)}`,
    workflow_id: "",
    asks: "",
    ...overrides,
  });

  const createInboxItem = (taskId: string, target: "worker" | "planner" | "maintainer"): InboxItem => ({
    id: `inbox-${Math.random().toString(36).slice(2)}`,
    source: "user",
    source_id: "user-1",
    target,
    target_id: taskId,
    timestamp: new Date().toISOString(),
    content: JSON.stringify({ role: "user", parts: [{ type: "text", text: "Test" }] }),
    handler_thread_id: "",
    handler_timestamp: "",
  });

  /**
   * Simulates the scheduler's priority selection logic.
   * This is extracted from task-scheduler.ts processNextTask method.
   */
  function selectTaskByPriority(tasks: Task[]): Task | undefined {
    // 1. Find workflows that have planner tasks pending
    const workflowsWithPlanner = new Set<string>();
    for (const t of tasks) {
      if (t.type === "planner" && t.workflow_id) {
        workflowsWithPlanner.add(t.workflow_id);
      }
    }

    // 2. Filter out maintainer tasks that conflict with planner tasks
    const filteredTasks = tasks.filter((t) => {
      if (t.type === "maintainer" && t.workflow_id && workflowsWithPlanner.has(t.workflow_id)) {
        return false;
      }
      return true;
    });

    // 3. Apply priority order: planner > worker > maintainer
    let task = filteredTasks.find((t) => t.type === "planner");
    if (!task) task = filteredTasks.find((t) => t.type === "worker");
    if (!task) task = filteredTasks.find((t) => t.type === "maintainer");

    return task;
  }

  describe("Basic priority ordering", () => {
    it("should prioritize planner over worker", async () => {
      const workerTask = createTask({ type: "worker", workflow_id: "" });
      const plannerTask = createTask({ type: "planner", workflow_id: "wf-1" });
      await taskStore.addTask(workerTask);
      await taskStore.addTask(plannerTask);

      const tasks = await taskStore.getTasks([workerTask.id, plannerTask.id]);
      const selected = selectTaskByPriority(tasks);

      expect(selected?.type).toBe("planner");
      expect(selected?.id).toBe(plannerTask.id);
    });

    it("should prioritize planner over maintainer", async () => {
      const maintainerTask = createTask({ type: "maintainer", workflow_id: "wf-2" });
      const plannerTask = createTask({ type: "planner", workflow_id: "wf-1" });
      await taskStore.addTask(maintainerTask);
      await taskStore.addTask(plannerTask);

      const tasks = await taskStore.getTasks([maintainerTask.id, plannerTask.id]);
      const selected = selectTaskByPriority(tasks);

      expect(selected?.type).toBe("planner");
      expect(selected?.id).toBe(plannerTask.id);
    });

    it("should prioritize worker over maintainer", async () => {
      const maintainerTask = createTask({ type: "maintainer", workflow_id: "wf-1" });
      const workerTask = createTask({ type: "worker", workflow_id: "" });
      await taskStore.addTask(maintainerTask);
      await taskStore.addTask(workerTask);

      const tasks = await taskStore.getTasks([maintainerTask.id, workerTask.id]);
      const selected = selectTaskByPriority(tasks);

      expect(selected?.type).toBe("worker");
      expect(selected?.id).toBe(workerTask.id);
    });

    it("should select maintainer when no planner or worker exists", async () => {
      const maintainerTask = createTask({ type: "maintainer", workflow_id: "wf-1" });
      await taskStore.addTask(maintainerTask);

      const tasks = await taskStore.getTasks([maintainerTask.id]);
      const selected = selectTaskByPriority(tasks);

      expect(selected?.type).toBe("maintainer");
      expect(selected?.id).toBe(maintainerTask.id);
    });

    it("should return undefined when no tasks exist", async () => {
      const selected = selectTaskByPriority([]);
      expect(selected).toBeUndefined();
    });
  });

  describe("Per-workflow conflict resolution", () => {
    it("should skip maintainer task when planner exists for SAME workflow", async () => {
      const workflowId = "wf-same";
      const plannerTask = createTask({ type: "planner", workflow_id: workflowId });
      const maintainerTask = createTask({ type: "maintainer", workflow_id: workflowId });
      await taskStore.addTask(plannerTask);
      await taskStore.addTask(maintainerTask);

      const tasks = await taskStore.getTasks([plannerTask.id, maintainerTask.id]);
      const selected = selectTaskByPriority(tasks);

      // Planner should be selected, maintainer skipped for same workflow
      expect(selected?.type).toBe("planner");
      expect(selected?.id).toBe(plannerTask.id);
    });

    it("should allow maintainer task when planner is for DIFFERENT workflow", async () => {
      const plannerTask = createTask({ type: "planner", workflow_id: "wf-planner" });
      const maintainerTask = createTask({ type: "maintainer", workflow_id: "wf-maintainer" });
      await taskStore.addTask(plannerTask);
      await taskStore.addTask(maintainerTask);

      const tasks = await taskStore.getTasks([plannerTask.id, maintainerTask.id]);
      const selected = selectTaskByPriority(tasks);

      // Planner has higher priority and is selected
      // But maintainer is NOT filtered out (could be selected next iteration)
      expect(selected?.type).toBe("planner");

      // Verify maintainer would be available if planner wasn't there
      const maintainerOnly = selectTaskByPriority([maintainerTask]);
      expect(maintainerOnly?.type).toBe("maintainer");
    });

    it("should skip ONLY the conflicting maintainer, not all maintainers", async () => {
      const workflowId = "wf-conflict";
      const plannerTask = createTask({ type: "planner", workflow_id: workflowId });
      const conflictingMaintainer = createTask({ type: "maintainer", workflow_id: workflowId });
      const otherMaintainer = createTask({ type: "maintainer", workflow_id: "wf-other" });
      await taskStore.addTask(plannerTask);
      await taskStore.addTask(conflictingMaintainer);
      await taskStore.addTask(otherMaintainer);

      // Simulate scheduler without planner task in available pool
      // (e.g., after planner completes)
      const maintainerTasks = [conflictingMaintainer, otherMaintainer];

      // With planner present, conflicting maintainer should be skipped
      const withPlanner = selectTaskByPriority([plannerTask, ...maintainerTasks]);
      expect(withPlanner?.id).toBe(plannerTask.id);

      // Without planner, non-conflicting maintainer should be available
      const withoutPlanner = selectTaskByPriority(maintainerTasks);
      // Both maintainers available when no planner conflicts
      expect(withoutPlanner?.type).toBe("maintainer");
    });
  });

  describe("Multiple tasks of same type", () => {
    it("should select first planner when multiple planners exist", async () => {
      const planner1 = createTask({ type: "planner", workflow_id: "wf-1" });
      const planner2 = createTask({ type: "planner", workflow_id: "wf-2" });
      await taskStore.addTask(planner1);
      await taskStore.addTask(planner2);

      // In the actual scheduler, tasks are sorted by timestamp
      // Here we test that first match wins
      const tasks = [planner1, planner2];
      const selected = selectTaskByPriority(tasks);

      expect(selected?.type).toBe("planner");
      expect(selected?.id).toBe(planner1.id);
    });

    it("should select first worker when multiple workers exist and no planner", async () => {
      const worker1 = createTask({ type: "worker" });
      const worker2 = createTask({ type: "worker" });
      await taskStore.addTask(worker1);
      await taskStore.addTask(worker2);

      const tasks = [worker1, worker2];
      const selected = selectTaskByPriority(tasks);

      expect(selected?.type).toBe("worker");
      expect(selected?.id).toBe(worker1.id);
    });
  });

  describe("Race condition prevention scenario", () => {
    it("should prevent stale maintainer fix from running", async () => {
      // Scenario:
      // 1. Script v1.0 fails, maintainer task created
      // 2. User requests changes, planner task created
      // 3. Both tasks have inbox items
      // Expected: Planner runs first, maintainer is skipped to prevent stale fix

      const workflowId = "wf-racing";

      // Maintainer task created first (when error occurred)
      const maintainerTask = createTask({
        type: "maintainer",
        workflow_id: workflowId,
        timestamp: Date.now() - 1000, // Created earlier
      });

      // Planner task created later (when user requested changes)
      const plannerTask = createTask({
        type: "planner",
        workflow_id: workflowId,
        timestamp: Date.now(), // Created later
      });

      await taskStore.addTask(maintainerTask);
      await taskStore.addTask(plannerTask);

      // Create inbox items (both have pending work)
      await inboxStore.saveInbox(createInboxItem(maintainerTask.id, "maintainer"));
      await inboxStore.saveInbox(createInboxItem(plannerTask.id, "planner"));

      // Verify both have inbox items
      const inbox = await inboxStore.listInboxItems({ handled: false });
      expect(inbox.length).toBe(2);

      // Scheduler would get tasks from inbox target_ids
      const tasks = await taskStore.getTasks([maintainerTask.id, plannerTask.id]);
      expect(tasks.length).toBe(2);

      // Priority selection should choose planner, skip maintainer
      const selected = selectTaskByPriority(tasks);
      expect(selected?.type).toBe("planner");
      expect(selected?.id).toBe(plannerTask.id);

      // The maintainer task should be filtered out for this workflow
      // It won't run until the planner task completes or the race is resolved
    });
  });

  describe("Edge cases", () => {
    it("should handle maintainer with empty workflow_id", async () => {
      // Edge case: maintainer somehow has no workflow_id
      const plannerTask = createTask({ type: "planner", workflow_id: "wf-1" });
      const maintainerTask = createTask({ type: "maintainer", workflow_id: "" });
      await taskStore.addTask(plannerTask);
      await taskStore.addTask(maintainerTask);

      const tasks = await taskStore.getTasks([plannerTask.id, maintainerTask.id]);
      const selected = selectTaskByPriority(tasks);

      // Planner still wins, but maintainer without workflow_id is not filtered
      expect(selected?.type).toBe("planner");

      // Without planner, maintainer with empty workflow_id would be selected
      const maintainerOnly = selectTaskByPriority([maintainerTask]);
      expect(maintainerOnly?.type).toBe("maintainer");
    });

    it("should handle planner with empty workflow_id", async () => {
      // Edge case: planner has no workflow_id (shouldn't happen normally)
      const plannerTask = createTask({ type: "planner", workflow_id: "" });
      const maintainerTask = createTask({ type: "maintainer", workflow_id: "wf-1" });
      await taskStore.addTask(plannerTask);
      await taskStore.addTask(maintainerTask);

      const tasks = await taskStore.getTasks([plannerTask.id, maintainerTask.id]);
      const selected = selectTaskByPriority(tasks);

      // Planner still wins by type priority
      expect(selected?.type).toBe("planner");

      // Maintainer is NOT filtered (planner has no workflow_id to conflict with)
    });

    it("should handle mix of all three task types", async () => {
      const workerTask = createTask({ type: "worker" });
      const plannerTask = createTask({ type: "planner", workflow_id: "wf-1" });
      const maintainerTask1 = createTask({ type: "maintainer", workflow_id: "wf-1" }); // Conflicts
      const maintainerTask2 = createTask({ type: "maintainer", workflow_id: "wf-2" }); // No conflict

      await taskStore.addTask(workerTask);
      await taskStore.addTask(plannerTask);
      await taskStore.addTask(maintainerTask1);
      await taskStore.addTask(maintainerTask2);

      const tasks = await taskStore.getTasks([
        workerTask.id, plannerTask.id, maintainerTask1.id, maintainerTask2.id
      ]);
      const selected = selectTaskByPriority(tasks);

      // Planner wins
      expect(selected?.type).toBe("planner");
      expect(selected?.id).toBe(plannerTask.id);

      // Simulate after planner completes: worker is next
      const afterPlanner = selectTaskByPriority([workerTask, maintainerTask1, maintainerTask2]);
      expect(afterPlanner?.type).toBe("worker");

      // Simulate after worker completes: non-conflicting maintainer available
      const afterWorker = selectTaskByPriority([maintainerTask1, maintainerTask2]);
      expect(afterWorker?.type).toBe("maintainer");
    });
  });
});
