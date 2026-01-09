import { z } from "zod";
import { ScriptStore } from "@app/db";

export function makeListScriptsTool(scriptStore: ScriptStore) {
  return {
    execute: async () => {
      const scripts = await scriptStore.listLatestScripts();

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
      "List the latest versions of scripts for distinct task_ids (all fields except 'code')",
    inputSchema: z.object({}),
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
