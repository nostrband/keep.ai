import { z } from "zod";
import { generateId, tool } from "ai";
import { ChatStore, Script, ScriptStore } from "@app/db";

const SaveInfoSchema = z.object({
  code: z.string().describe("Script code to save"),
  comments: z
    .string()
    .optional()
    .describe("Comment for the code or code changes"),
});

export type SaveInfo = z.infer<typeof SaveInfoSchema>;

export function makeSaveTool(opts: {
  taskId: string;
  taskRunId: string;
  scriptStore: ScriptStore;
  chatStore: ChatStore;
}) {
  return tool({
    execute: async (info: SaveInfo): Promise<Script> => {
      const script = await opts.scriptStore.getLatestScriptByTaskId(
        opts.taskId
      );
      const version = script ? script.version + 1 : 1;
      
      // Get workflow by task_id to link the script
      const workflow = await opts.scriptStore.getWorkflowByTaskId(opts.taskId);
      if (!workflow) {
        throw new Error(`Workflow not found for task ${opts.taskId}`);
      }
      
      const newScript: Script = {
        id: generateId(),
        code: info.code,
        change_comment: info.comments || "",
        task_id: opts.taskId,
        timestamp: new Date().toISOString(),
        version,
        workflow_id: workflow.id,
        type: "",
      };
      await opts.scriptStore.addScript(newScript);

      await opts.chatStore.saveChatEvent(generateId(), "main", "add_script", {
        task_id: opts.taskId,
        task_run_id: opts.taskRunId,
        script_id: newScript.id,
        version
      });

      return newScript;
    },
    description: `Save the new/updated script code, along with commit-style comments.
`,
    inputSchema: SaveInfoSchema,
  });
}
