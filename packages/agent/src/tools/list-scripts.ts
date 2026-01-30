import { z } from "zod";
import { tool } from "ai";
import { ScriptStore } from "@app/db";

export function makeListScriptsTool(scriptStore: ScriptStore) {
  return tool({
    description:
      "List the latest versions of scripts for distinct task_ids (all fields except 'code')",
    inputSchema: z.object({}).optional().nullable(),
    outputSchema: z.array(
      z.object({
        id: z.string(),
        task_id: z.string(),
        version: z.string(), // Format: "major.minor" e.g., "2.1"
        timestamp: z.string(),
        change_comment: z.string(),
      })
    ),
    execute: async () => {
      const scripts = await scriptStore.listLatestScripts();

      // Return all fields except 'code'
      return scripts.map((script) => ({
        id: script.id,
        task_id: script.task_id,
        version: `${script.major_version}.${script.minor_version}`,
        timestamp: script.timestamp,
        change_comment: script.change_comment,
      }));
    },
  });
}
