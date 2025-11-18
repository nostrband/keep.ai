import { z } from "zod";
import { generateId } from "ai";
import { TaskStore } from "@app/db";

export function makeAddTaskTool(taskStore: TaskStore) {
  return {
    execute: async (opts: {
      title: string;
      goal?: string;
      notes?: string;
      startAt?: string;
    }) => {
      if (!opts.title) throw new Error("Required 'title'");
      const id = generateId();
      const timestamp = Math.floor(
        (opts.startAt ? new Date(opts.startAt).getTime() : Date.now()) /
          1000
      );
      await taskStore.addTask(
        id,
        timestamp,
        "",
        "worker",
        "",
        opts.title
      );
      await taskStore.saveState({
        id,
        goal: opts.goal || "",
        notes: opts.notes || "",
        asks: "",
        plan: "",
      });
      return id;
    },
    description: "Create a background task",
    inputSchema: z.object({
      title: z
        .string()
        .describe("Task title for task management and audit"),
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