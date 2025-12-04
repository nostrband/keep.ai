import { z } from "zod";
import { generateId } from "ai";
import { TaskStore } from "@app/db";
import { Cron } from "croner";
import { EvalContext } from "../sandbox/sandbox";

export function makeAddTaskRecurringTool(
  taskStore: TaskStore,
  getContext: () => EvalContext
) {
  return {
    execute: async (opts: {
      title: string;
      goal?: string;
      notes?: string;
      cron: string;
    }) => {
      if (!opts.title) throw new Error("Required 'title'");
      if (!opts.cron) throw new Error("Required 'cron'");

      const nextRunDate = new Cron(opts.cron).nextRun();
      if (!nextRunDate) throw new Error("Invalid cron schedule");
      const timestamp = Math.floor(nextRunDate.getTime() / 1000);
      const id = generateId();
      await taskStore.addTask(
        id,
        timestamp,
        "",
        "worker",
        "",
        opts.title,
        opts.cron
      );
      await taskStore.saveState({
        id,
        goal: opts.goal || "",
        notes: opts.notes || "",
        asks: "",
        plan: "",
      });

      await getContext().createEvent("add_task_cron", {
        id,
        title: opts.title,
        cron: opts.cron
      });

      return id;
    },
    description:
      "You MUST check for existing tasks before creating new one! Creates a recurring background task using cron schedule. You don't have to call sendToTaskInbox after creating the task.",
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
        .describe("Task notes for worker agent"),
      cron: z
        .string()
        .describe(
          "Cron expression for recurring task schedule (e.g., '0 9 * * MON' for every Monday at 9 AM)"
        ),
    }),
    outputSchema: z.string().describe("Task id"),
  };
}
