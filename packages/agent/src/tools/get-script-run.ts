import { z } from "zod";
import { ScriptStore } from "@app/db";
import { defineReadOnlyTool, Tool } from "./types";

const inputSchema = z.object({
  id: z.string().describe("Script run ID"),
});

const outputSchema = z
  .object({
    id: z.string(),
    script_id: z.string(),
    start_timestamp: z.string(),
    end_timestamp: z.string(),
    error: z.string(),
    result: z.string(),
    logs: z.string(),
  })
  .nullable();

type Input = z.infer<typeof inputSchema>;
type Output = z.infer<typeof outputSchema>;

/**
 * Create the Scripts.getRun tool.
 * This is a read-only tool - can be used outside Items.withItem().
 * Only available during planning/maintenance.
 */
export function makeGetScriptRunTool(scriptStore: ScriptStore): Tool<Input, Output> {
  return defineReadOnlyTool({
    namespace: "Scripts",
    name: "getRun",
    description: `Get full script run info including result and logs by script_run_id.

⚠️ This tool is only available during planning/maintenance. Do not use in production scripts.
ℹ️ Not a mutation - can be used outside Items.withItem().`,
    inputSchema,
    outputSchema,
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
  }) as Tool<Input, Output>;
}
