import { z } from "zod";
import { generateId } from "ai";
import { TaskStore } from "@app/db";
import { EvalContext } from "../sandbox/sandbox";

export function makeAddTaskTool(
  taskStore: TaskStore,
  getContext: () => EvalContext
) {
  return {
    execute: async (opts: {
      title: string;
      goal?: string;
      notes?: string;
      startAt?: string;
    }) => {
      if (!opts.title) throw new Error("Required 'title'");
      const timestamp = Math.floor(
        (opts.startAt ? new Date(opts.startAt).getTime() : Date.now()) / 1000
      );
      const id = generateId();
      // Spec 10: workflow_id and asks are now on tasks table
      // goal and notes are passed as initial inbox content instead
      await taskStore.addTask({
        id,
        timestamp,
        reply: "",
        state: "",
        thread_id: "",
        error: "",
        type: "worker",
        title: opts.title,
        chat_id: "",
        workflow_id: "",  // Worker tasks don't have workflows
        asks: "",
      });

      await getContext().createEvent("add_task", {
        id,
        title: opts.title,
        startAt: opts.startAt
      });

      return id;
    },
    description:
      "You MUST check for existing tasks before creating new one! Creates a background task. You don't have to call sendToTaskInbox after creating the task.",
    inputSchema: z.object({
      title: z.string().describe("Task title for task management and audit"),
      goal: z
        .string()
        .optional()
        .nullable()
        .describe("Task goal for worker agent"),
      notes: z
        .string()
        .optional()
        .nullable()
        .describe("Task notes for worker agent"),
      startAt: z
        .string()
        .optional()
        .nullable()
        .describe("ISO date-time when task should be launched"),
    }),
    outputSchema: z.string().describe("Task id"),
  };
}
