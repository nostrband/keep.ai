import { z } from "zod";
import { tool } from "ai";
import { ScriptStore } from "@app/db";

export function makeScriptHistoryTool(scriptStore: ScriptStore) {
  return tool({
    description:
      "Get all script versions for a given task_id (all fields except 'code')",
    inputSchema: z.object({
      task_id: z.string().describe("Task ID"),
    }),
    outputSchema: z.array(
      z.object({
        id: z.string(),
        task_id: z.string(),
        version: z.number(),
        timestamp: z.string(),
        change_comment: z.string(),
      })
    ),
    execute: async (input) => {
      const scripts = await scriptStore.getScriptsByTaskId(input.task_id);

      // Return all fields except 'code'
      return scripts.map((script) => ({
        id: script.id,
        task_id: script.task_id,
        version: script.version,
        timestamp: script.timestamp,
        change_comment: script.change_comment,
      }));
    },
  });
}
