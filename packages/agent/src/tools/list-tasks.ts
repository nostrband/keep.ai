import { z } from "zod";
import { tool } from "ai";
import { TaskStore } from "@app/db";
import debug from "debug";

const debugListTasks = debug("agent:list-tasks");

export function makeListTasksTool(taskStore: TaskStore) {
  return tool({
    description: `List up to 100 most recent tasks. By default, returns only active tasks (reply === '').
Use this tool to see what tasks are scheduled or have been completed. Tasks are sorted by time DESC (furthest-first).
Note that scheduled time is returned in LOCAL timezone, which might differ from UTC time you used for addTask - that's ok.`,
    inputSchema: z.object({
      include_finished: z
        .boolean()
        .nullable()
        .optional()
        .describe(
          "If true, include all tasks regardless of reply. If false or omitted, only return active tasks (reply === '')"
        ),
      until: z
        .string()
        .nullable()
        .optional()
        .describe(
          "Maximum datetime of tasks to return (e.g., '2025-10-06T14:30:00Z'). Useful for paginating back in time through tasks"
        ),
    }),
    execute: async (context) => {
      const { include_finished = false, until } = context;

      try {
        // Convert ISO string to Unix timestamp if until is provided
        let untilTimestamp: number | undefined;
        if (until) {
          const date = new Date(until);
          if (isNaN(date.getTime())) {
            return {
              success: false,
              error:
                "Invalid datetime format for 'until' parameter. Please use ISO 8601 format (e.g., '2025-10-06T14:30:00Z')",
              tasks: [],
              total_count: 0,
            };
          }
          untilTimestamp = Math.floor(date.getTime() / 1000);
        }

        const tasks = await taskStore.listTasks(
          !!include_finished,
          untilTimestamp
        );

        // Format tasks for response
        const formattedTasks = tasks.map((task) => ({
          id: task.id,
          user_id: task.user_id,
          title: task.title,
          timestamp: task.timestamp,
          datetime:
            task.timestamp > 0
              ? new Date(task.timestamp * 1000).toString()
              : "",
          cron: task.cron,
          task: task.task,
          reply: task.reply,
          state: task.state,
          thread_id: task.thread_id,
          error: task.error,
        }));

        debugListTasks("list tasks", formattedTasks);

        return {
          success: true,
          tasks: formattedTasks,
          total_count: formattedTasks.length,
          filters: {
            include_finished,
            until,
          },
        };
      } catch (error) {
        console.error("Error listing tasks:", error);
        return {
          success: false,
          error:
            error instanceof Error ? error.message : "Unknown error occurred",
          tasks: [],
          total_count: 0,
        };
      }
    },
  });
}
