import { JSONSchema } from "../json-schema";
import { ScriptStore } from "@app/db";
import { defineReadOnlyTool, Tool } from "./types";

const inputSchema: JSONSchema = {
  type: "object",
  properties: {
    task_id: { type: "string", description: "Task ID" },
  },
  required: ["task_id"],
};

const outputSchema: JSONSchema = {
  type: "array",
  items: {
    type: "object",
    properties: {
      id: { type: "string" },
      task_id: { type: "string" },
      version: { type: "string" },
      timestamp: { type: "string" },
      change_comment: { type: "string" },
    },
    required: ["id", "task_id", "version", "timestamp", "change_comment"],
  },
};

interface Input {
  task_id: string;
}

interface OutputItem {
  id: string;
  task_id: string;
  version: string;
  timestamp: string;
  change_comment: string;
}
type Output = OutputItem[];

/**
 * Create the Scripts.history tool.
 * Only available during planning/maintenance.
 */
export function makeScriptHistoryTool(scriptStore: ScriptStore): Tool<Input, Output> {
  return defineReadOnlyTool({
    namespace: "Scripts",
    name: "history",
    description: `Get all script versions for a given task_id (all fields except 'code').

\u26a0\ufe0f This tool is only available during planning/maintenance. Do not use in production scripts.`,
    inputSchema,
    outputSchema,
    execute: async (input) => {
      const scripts = await scriptStore.getScriptsByTaskId(input.task_id);

      // Return all fields except 'code'
      return scripts.map((script) => ({
        id: script.id,
        task_id: script.task_id,
        version: `${script.major_version}.${script.minor_version}`,
        timestamp: script.timestamp,
        change_comment: script.change_comment,
      }));
    },
  }) as Tool<Input, Output>;
}
