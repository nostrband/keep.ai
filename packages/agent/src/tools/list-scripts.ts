import { JSONSchema } from "../json-schema";
import { ScriptStore } from "@app/db";
import { defineReadOnlyTool, Tool } from "./types";

const inputSchema: JSONSchema = { type: "object" };

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

type Input = {} | null | undefined;

interface OutputItem {
  id: string;
  task_id: string;
  version: string;
  timestamp: string;
  change_comment: string;
}
type Output = OutputItem[];

/**
 * Create the Scripts.list tool.
 * Only available during planning/maintenance.
 */
export function makeListScriptsTool(scriptStore: ScriptStore): Tool<Input, Output> {
  return defineReadOnlyTool({
    namespace: "Scripts",
    name: "list",
    description: `List the latest versions of scripts for distinct task_ids (all fields except 'code').

\u26a0\ufe0f This tool is only available during planning/maintenance. Do not use in production scripts.`,
    inputSchema,
    outputSchema,
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
  }) as Tool<Input, Output>;
}
