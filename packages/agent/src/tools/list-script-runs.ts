import { z } from "zod";
import { ScriptStore } from "@app/db";
import { EvalContext } from "../sandbox/sandbox";
import { defineReadOnlyTool, Tool } from "./types";

const inputSchema = z
  .object({
    task_id: z
      .string()
      .optional()
      .describe("Task ID (optional, defaults to current task)"),
  })
  .optional()
  .nullable();

const outputSchema = z.array(
  z.object({
    id: z.string(),
    script_id: z.string(),
    start_timestamp: z.string(),
    end_timestamp: z.string(),
    error: z.string(),
  })
);

type Input = z.infer<typeof inputSchema>;
type Output = z.infer<typeof outputSchema>;

/**
 * Create the Scripts.listRuns tool.
 * This is a read-only tool - can be used outside Items.withItem().
 * Only available during planning/maintenance.
 */
export function makeListScriptRunsTool(
  scriptStore: ScriptStore,
  getContext: () => EvalContext
): Tool<Input, Output> {
  return defineReadOnlyTool({
    namespace: "Scripts",
    name: "listRuns",
    description: `Get list of script runs for a task ID. If no task_id provided, uses current task. Returns all script run fields except result and logs.

⚠️ This tool is only available during planning/maintenance. Do not use in production scripts.
ℹ️ Not a mutation - can be used outside Items.withItem().`,
    inputSchema,
    outputSchema,
    execute: async (input) => {
      let task_id = input?.task_id;

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
  }) as Tool<Input, Output>;
}
