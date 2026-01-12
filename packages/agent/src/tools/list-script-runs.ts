import { z } from "zod";
import { ScriptStore } from "@app/db";
import { EvalContext } from "../sandbox/sandbox";

export function makeListScriptRunsTool(
  scriptStore: ScriptStore,
  getContext: () => EvalContext
) {
  return {
    execute: async (task_id?: string) => {
      // If no task_id provided, get it from context
      if (!task_id) {
        const context = getContext();
        if (!context) throw new Error("No eval context");
        if (context.type !== "worker" && context.type !== "planner")
          throw new Error("Only planner/worker tasks have scripts");

        task_id = context.taskId;
        if (!task_id) throw new Error("No task ID in context");
      }

      // Get all script runs by task ID
      const scriptRuns = await scriptStore.getScriptRunsByTaskId(task_id);

      // Return all fields except result and logs
      return scriptRuns.map((run) => ({
        id: run.id,
        script_id: run.script_id,
        start_timestamp: run.start_timestamp,
        end_timestamp: run.end_timestamp,
        error: run.error,
      }));
    },
    description:
      "Get list of script runs for a task ID. If no task_id provided, uses current task. Returns all script run fields except result and logs.",
    inputSchema: z
      .string()
      .optional()
      .describe("Task ID (optional, defaults to current task)"),
    outputSchema: z.array(
      z.object({
        id: z.string(),
        script_id: z.string(),
        start_timestamp: z.string(),
        end_timestamp: z.string(),
        error: z.string(),
      })
    ),
  };
}
