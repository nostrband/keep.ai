import { z } from "zod";
import { ScriptStore } from "@app/db";

export function makeScriptHistoryTool(scriptStore: ScriptStore) {
  return {
    execute: async (task_id: string) => {
      const scripts = await scriptStore.getScriptsByTaskId(task_id);

      // Return all fields except 'code'
      return scripts.map((script) => ({
        id: script.id,
        task_id: script.task_id,
        version: script.version,
        timestamp: script.timestamp,
        change_comment: script.change_comment,
      }));
    },
    description:
      "Get all script versions for a given task_id (all fields except 'code')",
    inputSchema: z.string().describe("Task ID"),
    outputSchema: z.array(
      z.object({
        id: z.string(),
        task_id: z.string(),
        version: z.number(),
        timestamp: z.string(),
        change_comment: z.string(),
      })
    ),
  };
}
