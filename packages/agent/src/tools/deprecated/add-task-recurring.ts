/**
 * @deprecated Task tools are no longer part of the agent workflow.
 * This file is preserved for reference only.
 */
import { z } from "zod";
import { generateId } from "ai";
import { TaskStore } from "@app/db";
import { Cron } from "croner";
import { EvalContext } from "../../sandbox/sandbox";

export function makeAddTaskRecurringTool(
  taskStore: TaskStore,
  getContext: () => EvalContext
) {
  return {
    execute: async (opts: {
      title: string;
      goal?: string;
      notes?: string;
    }) => {
      if (!opts.title) throw new Error("Required 'title'");
      const id = generateId();
      // Spec 10: workflow_id and asks are now on tasks table
      // goal and notes are passed as initial inbox content instead
      await taskStore.addTask({
        id,
        timestamp: Math.floor(Date.now() / 1000), // Run planner immediately, next run will be scheduled after planner finishes
        reply: "",
        state: "",
        thread_id: "",
        error: "",
        type: "planner",
        title: opts.title,
        chat_id: "",
        workflow_id: "",  // Will be linked when workflow is created
        asks: "",
      });

      await getContext().createEvent("add_task_cron", {
        id,
        title: opts.title,
      });

      return id;
    },
    description:
      "You MUST check for existing tasks before creating new one! Creates a recurring background task. You don't have to call sendToTaskInbox after creating the task.",
    inputSchema: z.object({
      title: z.string().describe("Task title for task management and audit"),
      goal: z
        .string()
        .optional()
        .nullable()
        .describe("Task goal for each iteration of the recurring task"),
      notes: z
        .string()
        .optional()
        .nullable()
        .describe("Task notes for planner agent"),
    }),
    outputSchema: z.string().describe("Task id"),
  };
}
