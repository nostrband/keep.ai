/**
 * @deprecated Task tools are no longer part of the agent workflow.
 * This file is preserved for reference only.
 */
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
      // Spec 10: asks is now directly on task, no need for separate getStates call
      return tasks.map((task) => ({
        id: task.id,
        title: task.title,
        state: task.state,
        asks: task.asks || "",
        error: task.error,
        runTime: new Date(task.timestamp * 1000).toISOString(),
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
        asks: z
          .string()
          .describe(
            "Questions that task asked to the user, if user replied - forward to task's inbox"
          ),
        error: z.string(),
        runTime: z.string().describe("Date time when task is scheduled to run"),
      })
    ),
  };
}
