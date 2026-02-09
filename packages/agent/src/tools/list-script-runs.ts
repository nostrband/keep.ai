import { JSONSchema } from "../json-schema";
import { ScriptStore } from "@app/db";
import { EvalContext } from "../sandbox/sandbox";
import { defineReadOnlyTool, Tool } from "./types";

const inputSchema: JSONSchema = {
  type: "object",
  properties: {
    task_id: {
      type: "string",
      description: "Task ID (optional, defaults to current task)",
    },
  },
};

const outputSchema: JSONSchema = {
  type: "array",
  items: {
    type: "object",
    properties: {
      id: { type: "string" },
      script_id: { type: "string" },
      start_timestamp: { type: "string" },
      end_timestamp: { type: "string" },
      error: { type: "string" },
    },
    required: ["id", "script_id", "start_timestamp", "end_timestamp", "error"],
  },
};

type Input = {
  task_id?: string;
} | null | undefined;

interface OutputItem {
  id: string;
  script_id: string;
  start_timestamp: string;
  end_timestamp: string;
  error: string;
}
type Output = OutputItem[];

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

\u26a0\ufe0f This tool is only available during planning/maintenance. Do not use in production scripts.
\u2139\ufe0f Not a mutation - can be used outside Items.withItem().`,
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
