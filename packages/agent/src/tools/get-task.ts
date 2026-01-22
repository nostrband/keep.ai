import { z } from "zod";
import { TaskStore } from "@app/db";

export function makeGetTaskTool(taskStore: TaskStore) {
  return {
    execute: async (id: string) => {
      const task = await taskStore.getTask(id);
      // Spec 10: asks is now directly on task, goal/notes/plan removed
      return {
        id: task.id,
        title: task.title,
        state: task.state,
        error: task.error,
        runTime: new Date(task.timestamp * 1000).toISOString(),
        asks: task.asks || "",
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
      asks: z.string(),
    }),
  };
}