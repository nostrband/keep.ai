import { z } from "zod";
import { tool } from "ai";
import { ScriptStore } from "@app/db";

export function makeGetScriptRunTool(scriptStore: ScriptStore) {
  return tool({
    description:
      "Get full script run info including result and logs by script_run_id",
    inputSchema: z.object({
      id: z.string().describe("Script run ID"),
    }),
    outputSchema: z
      .object({
        id: z.string(),
        script_id: z.string(),
        start_timestamp: z.string(),
        end_timestamp: z.string(),
        error: z.string(),
        result: z.string(),
        logs: z.string(),
      })
      .nullable(),
    execute: async (input) => {
      // Get script run by ID
      const scriptRun = await scriptStore.getScriptRun(input.id);
      if (!scriptRun) return null;

      return {
        id: scriptRun.id,
        script_id: scriptRun.script_id,
        start_timestamp: scriptRun.start_timestamp,
        end_timestamp: scriptRun.end_timestamp,
        error: scriptRun.error,
        result: scriptRun.result,
        logs: scriptRun.logs,
      };
    },
  });
}
