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
 * The fix is always saved as a new minor version.
 * activated = true means the fix became the active script.
 * activated = false means the planner updated the script while maintainer was running,
 * so the fix was saved but not activated.
 */
export interface FixResult {
  script: Script;
  /** Whether the fix became the active script (false if race condition detected) */
  activated: boolean;
}

/**
 * Create a fix tool for the maintainer agent.
 * The fix tool only increments minor_version (not major_version),
 * preserving the script's major version from when the maintainer started.
 *
 * Race condition handling:
 * If the planner has updated the script (new active_script_id) while the maintainer
 * was running, the fix is still saved but not activated. The maintainer's work is
 * never discarded.
 */
export function makeFixTool(opts: {
  maintainerTaskId: string;
  workflowId: string;
  /** The script ID that the maintainer is fixing */
  expectedScriptId: string;
  scriptStore: ScriptStore;
  /** Optional callback invoked when the fix tool is called */
  onCalled?: (result: FixResult) => void;
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

      // Get the script the maintainer was working on
      const originalScript = await opts.scriptStore.getScript(opts.expectedScriptId);
      if (!originalScript) {
        throw new Error(`Original script not found: ${opts.expectedScriptId}`);
      }

      // Create new script with same major_version, incremented minor_version
      // Fix is ALWAYS saved - maintainer's work is never discarded
      const newScript: Script = {
        id: generateId(),
        code: info.code,
        change_comment: info.comment,
        task_id: opts.maintainerTaskId,
        timestamp: new Date().toISOString(),
        major_version: originalScript.major_version,
        minor_version: originalScript.minor_version + 1,
        workflow_id: opts.workflowId,
        // Preserve existing metadata - maintainer cannot change these
        type: originalScript.type,
        summary: originalScript.summary,
        diagram: originalScript.diagram,
      };

      await opts.scriptStore.addScript(newScript);

      // Race condition check: only activate if planner hasn't updated
      // Compare active_script_id to know if planner changed it while we worked
      const shouldActivate = workflow.active_script_id === opts.expectedScriptId;

      if (shouldActivate) {
        // No race - make this fix the active script
        await opts.scriptStore.updateWorkflowFields(opts.workflowId, {
          active_script_id: newScript.id,
          maintenance: false,
          next_run_timestamp: new Date().toISOString(),
        });
      } else {
        // Race detected - planner updated the script
        // Fix is saved but not activated; clear maintenance so planner's version runs
        await opts.scriptStore.updateWorkflowFields(opts.workflowId, {
          maintenance: false,
        });
      }

      const result: FixResult = {
        script: newScript,
        activated: shouldActivate,
      };

      // Invoke callback if provided
      if (opts.onCalled) {
        opts.onCalled(result);
      }

      return result;
    },
    description: `Propose a fix for the script error.
This tool can ONLY modify the script code - it cannot change title, summary, schedule, or other metadata.
Call this tool when you have identified and fixed the bug in the script.
If you cannot fix the issue, do NOT call this tool - provide an explanation instead.

The fix will be saved as a new minor version (e.g., 1.0 → 1.1).
If no other changes occurred, the workflow will immediately re-run to verify it works.

Returns:
- activated: true if the fix became active and workflow will re-run
- activated: false if the planner updated the script while you were working (your fix was saved but not activated)
`,
    inputSchema: FixInfoSchema,
  });
}
