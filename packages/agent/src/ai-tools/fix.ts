import { z } from "zod";
import { generateId, tool } from "ai";
import { Script, ScriptStore } from "@app/db";

const FixInfoSchema = z.object({
  code: z.string().describe("The complete fixed script code"),
  comment: z.string().describe("Brief description of what was fixed"),
});

export type FixInfo = z.infer<typeof FixInfoSchema>;

/**
 * Result of the fix tool.
 * applied = true means the fix was saved as a new minor version.
 * applied = false means the planner updated the script while maintainer was running (race condition),
 * so the fix was discarded.
 */
export interface FixResult {
  script: Script;
  applied: boolean;
}

/**
 * Create a fix tool for the maintainer agent.
 * The fix tool only increments minor_version (not major_version),
 * preserving the script's major version from when the maintainer started.
 *
 * Race condition handling:
 * If the planner has updated the script (new major_version) while the maintainer
 * was running, the fix is discarded and applied = false is returned.
 */
export function makeFixTool(opts: {
  maintainerTaskId: string;
  workflowId: string;
  expectedMajorVersion: number;
  scriptStore: ScriptStore;
}) {
  return tool({
    execute: async (info: FixInfo): Promise<FixResult> => {
      // Get workflow to find current active script
      const workflow = await opts.scriptStore.getWorkflow(opts.workflowId);
      if (!workflow) {
        throw new Error(`Workflow not found: ${opts.workflowId}`);
      }

      if (!workflow.active_script_id) {
        throw new Error(`Workflow ${opts.workflowId} has no active script`);
      }

      // Get the current active script
      const currentScript = await opts.scriptStore.getScript(workflow.active_script_id);
      if (!currentScript) {
        throw new Error(`Script not found: ${workflow.active_script_id}`);
      }

      // Race condition check: only apply fix if planner hasn't updated
      // Maintainer was working on major version X, if current is still X, we can proceed
      if (currentScript.major_version !== opts.expectedMajorVersion) {
        // Planner updated the script while maintainer was running
        // Our fix is stale - don't apply it
        // Clear maintenance mode since the planner's new version should be tried
        await opts.scriptStore.updateWorkflowFields(opts.workflowId, {
          maintenance: false,
        });

        return {
          script: currentScript,
          applied: false,
        };
      }

      // Create new script with same major_version, incremented minor_version
      const newScript: Script = {
        id: generateId(),
        code: info.code,
        change_comment: info.comment,
        task_id: opts.maintainerTaskId,
        timestamp: new Date().toISOString(),
        major_version: currentScript.major_version,
        minor_version: currentScript.minor_version + 1,
        workflow_id: opts.workflowId,
        // Preserve existing metadata - maintainer cannot change these
        type: currentScript.type,
        summary: currentScript.summary,
        diagram: currentScript.diagram,
      };

      await opts.scriptStore.addScript(newScript);

      // Update workflow atomically:
      // - Set active_script_id to the new fixed script
      // - Clear maintenance flag
      // - Set next_run_timestamp to now for immediate re-run to verify the fix
      await opts.scriptStore.updateWorkflowFields(opts.workflowId, {
        active_script_id: newScript.id,
        maintenance: false,
        next_run_timestamp: new Date().toISOString(),
      });

      return {
        script: newScript,
        applied: true,
      };
    },
    description: `Propose a fix for the script error.
This tool can ONLY modify the script code - it cannot change title, summary, schedule, or other metadata.
Call this tool when you have identified and fixed the bug in the script.
If you cannot fix the issue, do NOT call this tool - provide an explanation instead.

The fix will be saved as a new minor version (e.g., 1.0 → 1.1) and the workflow will immediately re-run to verify it works.

Returns:
- applied: true if the fix was saved and workflow will re-run
- applied: false if the planner updated the script while you were working (your fix was discarded)
`,
    inputSchema: FixInfoSchema,
  });
}
