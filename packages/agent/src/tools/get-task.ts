import { z } from "zod";
import { TaskStore } from "@app/db";

export function makeGetTaskTool(taskStore: TaskStore) {
  return {
    execute: async (id: string) => {
      const task = await taskStore.getTask(id);
      const state = await taskStore.getState(id);
      return {
        id: task.id,
        title: task.title,
        state: task.state,
        error: task.error,
        runTime: new Date(task.timestamp * 1000),
        goal: state?.goal || "",
        notes: state?.notes || "",
        plan: state?.plan || "",
        asks: state?.asks || "",
      };
    },
    description: "Get a background task",
    inputSchema: z.string().describe("Task id"),
    outputSchema: z.object({
      id: z.string(),
      title: z.string(),
      state: z.string(),
      error: z.string(),
      runTime: z
        .string()
        .describe("Date time when task is scheduled to run"),
      goal: z.string(),
      notes: z.string(),
      plan: z.string(),
      asks: z.string(),
    }),
  };
}