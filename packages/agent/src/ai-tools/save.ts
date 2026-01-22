import { z } from "zod";
import { generateId, tool } from "ai";
import { Script, ScriptStore } from "@app/db";

const SaveInfoSchema = z.object({
  code: z.string().describe("Script code to save"),
  comments: z
    .string()
    .optional()
    .describe("Comment for the code or code changes"),
  summary: z
    .string()
    .optional()
    .describe("One-sentence description of what the automation does"),
  diagram: z
    .string()
    .optional()
    .describe("Mermaid diagram source showing the automation flow (flowchart)"),
});

export type SaveInfo = z.infer<typeof SaveInfoSchema>;

// Result type for save tool - includes script info and whether it was a maintenance fix
export interface SaveResult {
  script: Script;
  wasMaintenanceFix: boolean;
}

export function makeSaveTool(opts: {
  taskId: string;
  taskRunId: string;
  chatId: string;
  scriptStore: ScriptStore;
}) {
  return tool({
    execute: async (info: SaveInfo): Promise<SaveResult> => {
      const script = await opts.scriptStore.getLatestScriptByTaskId(
        opts.taskId
      );
      const version = script ? script.version + 1 : 1;

      // Get workflow by task_id to link the script
      const workflow = await opts.scriptStore.getWorkflowByTaskId(opts.taskId);
      if (!workflow) {
        throw new Error(`Workflow not found for task ${opts.taskId}`);
      }

      // Check if workflow was in maintenance mode (agent auto-fix)
      const wasInMaintenance = workflow.maintenance;

      const newScript: Script = {
        id: generateId(),
        code: info.code,
        change_comment: info.comments || "",
        task_id: opts.taskId,
        timestamp: new Date().toISOString(),
        version,
        workflow_id: workflow.id,
        type: "",
        summary: info.summary || "",
        diagram: info.diagram || "",
      };
      await opts.scriptStore.addScript(newScript);

      // Update workflow's active_script_id to point to the new script
      // New script versions automatically become active
      // If workflow was draft (no script yet), transition to 'ready' (Spec 11)
      if (workflow.status === 'draft') {
        await opts.scriptStore.updateWorkflowFields(workflow.id, {
          status: 'ready',
          active_script_id: newScript.id,
        });
      } else {
        await opts.scriptStore.updateWorkflowFields(workflow.id, {
          active_script_id: newScript.id,
        });
      }

      // Note: No separate add_script/maintenance_fixed events (Spec 01)
      // The script_id is returned and included in chat message metadata by task-worker

      // If workflow was in maintenance mode, clear it and trigger immediate re-run
      if (wasInMaintenance) {
        // Clear maintenance flag and set next_run_timestamp to now for immediate re-run
        // Use updateWorkflowFields for atomic partial update to avoid overwriting concurrent changes
        await opts.scriptStore.updateWorkflowFields(workflow.id, {
          maintenance: false,
          next_run_timestamp: new Date().toISOString(),
        });
      }

      // Return both the script and whether this was a maintenance fix
      // The task-worker will use this to set message metadata
      return {
        script: newScript,
        wasMaintenanceFix: wasInMaintenance,
      };
    },
    description: `Save the new/updated script code, along with commit-style comments.
`,
    inputSchema: SaveInfoSchema,
  });
}
