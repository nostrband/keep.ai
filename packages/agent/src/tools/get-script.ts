import { JSONSchema } from "../json-schema";
import { ScriptStore } from "@app/db";
import { EvalContext } from "../sandbox/sandbox";
import { defineReadOnlyTool, Tool } from "./types";

const inputSchema: JSONSchema = {
  type: "object",
  properties: {
    id: {
      type: "string",
      description:
        "Script ID (optional, defaults to latest script version for current task)",
    },
  },
};

const outputSchema: JSONSchema = {
  type: "object",
  properties: {
    id: { type: "string" },
    task_id: { type: "string" },
    version: { type: "string" },
    timestamp: { type: "string" },
    code: { type: "string" },
    change_comment: { type: "string" },
  },
  required: ["id", "task_id", "version", "timestamp", "code", "change_comment"],
  nullable: true,
};

type Input = {
  id?: string;
} | null | undefined;

type Output = {
  id: string;
  task_id: string;
  version: string;
  timestamp: string;
  code: string;
  change_comment: string;
} | null;

/**
 * Create the Scripts.get tool.
 * Only available during planning/maintenance.
 */
export function makeGetScriptTool(
  scriptStore: ScriptStore,
  getContext: () => EvalContext
): Tool<Input, Output> {
  return defineReadOnlyTool({
    namespace: "Scripts",
    name: "get",
    description: `Get a script by ID, or get the latest script for current task if no ID provided.

\u26a0\ufe0f This tool is only available during planning/maintenance. Do not use in production scripts.`,
    inputSchema,
    outputSchema,
    execute: async (input) => {
      const id = input?.id;

      // If no ID provided, get the latest script for the current task
      if (!id) {
        const context = getContext();
        if (!context) throw new Error("No eval context");
        if (context.type !== "worker" && context.type !== "planner")
          throw new Error("Only planner/worker tasks have scripts");

        const taskId = context.taskId;
        if (!taskId) throw new Error("No task ID in context");

        const script = await scriptStore.getLatestScriptByTaskId(taskId);
        if (!script) return null;

        return {
          id: script.id,
          task_id: script.task_id,
          version: `${script.major_version}.${script.minor_version}`,
          timestamp: script.timestamp,
          code: script.code,
          change_comment: script.change_comment,
        };
      }

      // Get script by ID
      const script = await scriptStore.getScript(id);
      if (!script) return null;

      return {
        id: script.id,
        task_id: script.task_id,
        version: `${script.major_version}.${script.minor_version}`,
        timestamp: script.timestamp,
        code: script.code,
        change_comment: script.change_comment,
      };
    },
  }) as Tool<Input, Output>;
}
