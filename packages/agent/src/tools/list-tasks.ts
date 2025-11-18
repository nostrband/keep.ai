import { z } from "zod";
import { TaskStore } from "@app/db";

export function makeListTasksTool(taskStore: TaskStore) {
  return {
    execute: async (opts?: { include_finished?: boolean; until?: string }) => {
      const tasks = await taskStore.listTasks(
        opts?.include_finished,
        "worker",
        opts?.until
          ? Math.floor(new Date(opts.until).getTime() / 1000)
          : undefined
      );
      return tasks.map((task) => ({
        id: task.id,
        title: task.title,
        state: task.state,
        error: task.error,
      }));
    },
    description: "List background tasks",
    inputSchema: z
      .object({
        include_finished: z
          .boolean()
          .optional()
          .nullable()
          .describe("Include finished tasks to the list"),
        until: z
          .string()
          .optional()
          .nullable()
          .describe(
            "Max runTime field of task, can be used for pagination through older tasks"
          ),
      })
      .optional()
      .nullable(),
    outputSchema: z.array(
      z.object({
        id: z.string(),
        title: z.string(),
        state: z.string(),
        error: z.string(),
        runTime: z.string().describe("Date time when task is scheduled to run"),
      })
    ),
  };
}
