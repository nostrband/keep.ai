import { z } from "zod";
import { ScriptStore } from "@app/db";
import { defineReadOnlyTool, Tool } from "./types";

const inputSchema = z.object({
  task_id: z.string().describe("Task ID"),
});

const outputSchema = z.array(
  z.object({
    id: z.string(),
    task_id: z.string(),
    version: z.string(), // Format: "major.minor" e.g., "2.1"
    timestamp: z.string(),
    change_comment: z.string(),
  })
);

type Input = z.infer<typeof inputSchema>;
type Output = z.infer<typeof outputSchema>;

/**
 * Create the Scripts.history tool.
 * This is a read-only tool - can be used outside Items.withItem().
 * Only available during planning/maintenance.
 */
export function makeScriptHistoryTool(scriptStore: ScriptStore): Tool<Input, Output> {
  return defineReadOnlyTool({
    namespace: "Scripts",
    name: "history",
    description: `Get all script versions for a given task_id (all fields except 'code').

⚠️ This tool is only available during planning/maintenance. Do not use in production scripts.
ℹ️ Not a mutation - can be used outside Items.withItem().`,
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
