import { JSONSchema } from "../json-schema";
import { AITool } from "./types";
import { Script, ScriptStore, TaskStore } from "@app/db";
import { validateWorkflowScript, isWorkflowFormatScript, WorkflowConfig } from "../workflow-validator";

export interface FixInfo {
  issue: string;
  code: string;
  comment: string;
}

/**
 * Result of the fix tool.
 * The fix is always saved as a new minor version.
 * Activation is NOT done here — it's handled by handleMaintainerCompletion
 * after the maintainer session completes.
 */
export interface FixResult {
  script: Script;
  /** Extracted workflow config from validation (if applicable) */
  workflowConfig?: WorkflowConfig;
}

/**
 * Create a fix tool for the maintainer agent.
 * The fix tool only increments minor_version (not major_version),
 * preserving the script's major version from when the maintainer started.
 *
 * The fix tool ONLY saves a new script version and updates the task title.
 * Activation (setting active_script_id, clearing maintenance, resetting schedules)
 * is handled by handleMaintainerCompletion after the maintainer session completes.
 * This prevents race conditions where mid-session activation allows the scheduler
 * to run the workflow while the maintainer is still working.
 */
export function makeFixTool(opts: {
  maintainerTaskId: string;
  workflowId: string;
  /** The script ID that the maintainer is fixing */
  expectedScriptId: string;
  scriptStore: ScriptStore;
  taskStore?: TaskStore;
  /** Optional callback invoked when the fix tool is called */
  onCalled?: (result: FixResult) => void;
}) {
  return {
    execute: async (info: FixInfo): Promise<FixResult> => {
      // Validate workflow script structure if it uses the new workflow format (exec-05)
      // Old-format scripts (inline code) are not validated
      let workflowConfig: WorkflowConfig | undefined;
      if (isWorkflowFormatScript(info.code)) {
        const validation = await validateWorkflowScript(info.code);
        if (!validation.valid) {
          throw new Error(`Script validation failed: ${validation.error}`);
        }
        workflowConfig = validation.config;
      }

      // Get the script the maintainer was working on
      const originalScript = await opts.scriptStore.getScript(opts.expectedScriptId);
      if (!originalScript) {
        throw new Error(`Original script not found: ${opts.expectedScriptId}`);
      }

      // Create new script with same major_version, incremented minor_version
      // Fix is ALWAYS saved - maintainer's work is never discarded
      const newScript: Script = {
        id: crypto.randomUUID(),
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

      // Update the maintainer task title with the issue description
      if (opts.taskStore && info.issue) {
        await opts.taskStore.updateTaskTitle(opts.maintainerTaskId, info.issue);
      }

      const result: FixResult = {
        script: newScript,
        workflowConfig,
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
After you finish, the workflow will automatically re-run to verify it works.
`,
    inputSchema: {
      type: "object",
      properties: {
        issue: { type: "string", description: "Short title of the issue found (e.g. 'API response parsing fails on empty arrays')" },
        code: { type: "string", description: "The complete fixed script code" },
        comment: { type: "string", description: "Explanation of what was fixed and why" },
      },
      required: ["issue", "code", "comment"],
    } as JSONSchema,
  } satisfies AITool;
}
