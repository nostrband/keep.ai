import { z } from "zod";
import { tool } from "ai";
import { ScriptStore } from "@app/db";
import { EvalContext } from "../sandbox/sandbox";

export function makeGetScriptTool(
  scriptStore: ScriptStore,
  getContext: () => EvalContext
) {
  return tool({
    description:
      "Get a script by ID, or get the latest script for current task if no ID provided",
    inputSchema: z
      .object({
        id: z
          .string()
          .optional()
          .describe(
            "Script ID (optional, defaults to latest script version for current task)"
          ),
      })
      .optional()
      .nullable(),
    outputSchema: z
      .object({
        id: z.string(),
        task_id: z.string(),
        version: z.number(),
        timestamp: z.string(),
        code: z.string(),
        change_comment: z.string(),
      })
      .nullable(),
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
          version: script.version,
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
        version: script.version,
        timestamp: script.timestamp,
        code: script.code,
        change_comment: script.change_comment,
      };
    },
  });
}
