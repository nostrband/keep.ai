import { JSONSchema } from "../json-schema";
import { AITool } from "./types";
import { ScriptStore } from "@app/db";
import { Cron } from "croner";

export interface ScheduleInfo {
  cron: string;
}

export function makeScheduleTool(opts: {
  taskId: string;
  scriptStore: ScriptStore;
}) {
  return {
    execute: async (info: ScheduleInfo): Promise<{ cron: string }> => {
      // Validate cron expression and calculate next run time
      let nextRunTimestamp = '';
      try {
        const cronJob = new Cron(info.cron);
        const nextRun = cronJob.nextRun();
        if (nextRun) {
          nextRunTimestamp = nextRun.toISOString();
        }
      } catch (error) {
        throw new Error(`Invalid cron expression '${info.cron}': ${error}`);
      }

      // Get workflow by task_id
      const workflow = await opts.scriptStore.getWorkflowByTaskId(opts.taskId);
      if (!workflow) {
        throw new Error(`Workflow not found for task ${opts.taskId}`);
      }

      // Update workflow cron field and next_run_timestamp atomically
      await opts.scriptStore.updateWorkflowFields(workflow.id, {
        cron: info.cron,
        next_run_timestamp: nextRunTimestamp,
      });

      return { cron: info.cron };
    },
    description: `Set the cron schedule for automated script execution.
Required when script should run automatically (e.g., daily, hourly, every N minutes).
Examples: '0 9 * * *' (daily 9am), '*/30 * * * *' (every 30min).
`,
    inputSchema: {
      type: "object",
      properties: {
        cron: { type: "string", description: "Cron expression for script execution schedule" },
      },
      required: ["cron"],
    } as JSONSchema,
  } satisfies AITool;
}
