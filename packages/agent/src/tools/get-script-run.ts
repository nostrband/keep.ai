import { JSONSchema } from "../json-schema";
import { ScriptStore } from "@app/db";
import { defineReadOnlyTool, Tool } from "./types";

const inputSchema: JSONSchema = {
  type: "object",
  properties: {
    id: { type: "string", description: "Script run ID" },
  },
  required: ["id"],
};

const outputSchema: JSONSchema = {
  type: "object",
  properties: {
    id: { type: "string" },
    script_id: { type: "string" },
    start_timestamp: { type: "string" },
    end_timestamp: { type: "string" },
    error: { type: "string" },
    result: { type: "string" },
    logs: { type: "string" },
  },
  required: ["id", "script_id", "start_timestamp", "end_timestamp", "error", "result", "logs"],
  nullable: true,
};

interface Input {
  id: string;
}

type Output = {
  id: string;
  script_id: string;
  start_timestamp: string;
  end_timestamp: string;
  error: string;
  result: string;
  logs: string;
} | null;

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

\u26a0\ufe0f This tool is only available during planning/maintenance. Do not use in production scripts.
\u2139\ufe0f Not a mutation - can be used outside Items.withItem().`,
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
