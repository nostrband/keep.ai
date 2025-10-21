import { z } from "zod";
import { generateId, tool } from "ai";
import { Cron } from "croner";
import { TaskStore } from "@app/db";

export function makeAddTaskTool(taskStore: TaskStore) {
  return tool({
    description: `Add a task for yourself (the assistant) for background processing on a specific date-time or cron schedule.
On specified date-time (single-shot) or cron trigger (regular), you (the assistant) will be launched, with the task description as input.
This way you can schedule tasks for yourself to be executed in the background at an appropriate time, to call necessary
tools, do research, send messages to the user, etc. I.e. to set a task to remind user about something,
add a task on the proper date-time and set task description to be "use send-message tool to remind user to do X".
Either datetime OR cron must be specified, not both.
NOTE: Always check current time before adding a task, do not rely on timestamps mentioned in message history or documents.
`,
    inputSchema: z.object({
      title: z.string().describe("Title of the task (required)"),
      datetime: z
        .string()
        .optional()
        .describe(
          "Date and time when the task should be executed (e.g., '2025-10-06T14:30:00Z' or '2025-10-06 14:30'). Either datetime or cron must be specified, not both."
        ),
      cron: z
        .string()
        .optional()
        .describe(
          "Cron expression for recurring tasks (e.g., '0 9 * * 1' for every Monday at 9 AM). Either datetime or cron must be specified, not both."
        ),
      task: z.string().describe(
        `Instructions of the task, will be passed back to you (the assistant).
If the job is complex, provide step-by-step instructions as task.`
      ),
    }),
    execute: async (context) => {
      const { title, datetime, cron, task } = context;

      try {
        // Validate that either datetime or cron is specified, but not both
        if (!datetime && !cron) {
          throw new Error("Either datetime or cron must be specified");
        }
        if (datetime && cron) {
          throw new Error("Cannot specify both datetime and cron. Choose one.");
        }

        const id = generateId();
        let timestamp: number;

        if (datetime) {
          // Convert datetime string to timestamp
          const date = new Date(datetime);

          // Validate the date
          if (isNaN(date.getTime()))
            throw new Error(
              "Invalid datetime format. Please provide valid date (e.g., '2025-10-06T14:30:00Z' or '2025-10-06 14:30')"
            );

          timestamp = Math.floor(date.getTime() / 1000); // Convert to Unix timestamp
        } else if (cron) {
          // If cron is specified, calc next run timestamp
          const job = new Cron(cron);
          const nextRun = job.nextRun();
          if (!nextRun) throw new Error("Invalid cron schedule");

          timestamp = Math.floor(nextRun.getTime() / 1000);
        } else {
          throw new Error("Either datetime or cron must be specified");
        }

        // Add task directly to the database
        await taskStore.addTask(id, timestamp, task, "", "", title, cron || "");

        return {
          success: true,
          message: "Task set successfully",
          task: {
            id,
            title,
            datetime: datetime || "",
            cron: cron || "",
            timestamp,
            task,
          },
        };
      } catch (error) {
        console.error("Error setting task:", error);
        return {
          success: false,
          error:
            error instanceof Error ? error.message : "Unknown error occurred",
        };
      }
    },
  });
}
