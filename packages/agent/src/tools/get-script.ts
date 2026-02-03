import { z } from "zod";
import { ScriptStore } from "@app/db";
import { EvalContext } from "../sandbox/sandbox";
import { defineReadOnlyTool, Tool } from "./types";

const inputSchema = z
  .object({
    id: z
      .string()
      .optional()
      .describe(
        "Script ID (optional, defaults to latest script version for current task)"
      ),
  })
  .optional()
  .nullable();

const outputSchema = z
  .object({
    id: z.string(),
    task_id: z.string(),
    version: z.string(), // Format: "major.minor" e.g., "2.1"
    timestamp: z.string(),
    code: z.string(),
    change_comment: z.string(),
  })
  .nullable();

type Input = z.infer<typeof inputSchema>;
type Output = z.infer<typeof outputSchema>;

/**
 * Create the Scripts.get tool.
 * This is a read-only tool - can be used outside Items.withItem().
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

⚠️ This tool is only available during planning/maintenance. Do not use in production scripts.
ℹ️ Not a mutation - can be used outside Items.withItem().`,
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
