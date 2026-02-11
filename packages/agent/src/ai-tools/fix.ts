import { JSONSchema } from "../json-schema";
import { AITool } from "./types";
import { Script, ScriptStore, ProducerScheduleStore, EventStore, TaskStore } from "@app/db";
import { validateWorkflowScript, isWorkflowFormatScript } from "../workflow-validator";
import { updateProducerSchedules } from "../producer-schedule-init";
import { getMostFrequentProducerCron } from "../schedule-utils";

export interface FixInfo {
  issue: string;
  code: string;
  comment: string;
}

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
  taskStore?: TaskStore;
  producerScheduleStore?: ProducerScheduleStore;  // For per-producer scheduling (exec-13)
  /** EventStore for releasing reserved events on fix activation */
  eventStore?: EventStore;
  /** Handler run ID whose reserved events should be released */
  handlerRunId?: string;
  /** Optional callback invoked when the fix tool is called */
  onCalled?: (result: FixResult) => void;
}) {
  return {
    execute: async (info: FixInfo): Promise<FixResult> => {
      // Validate workflow script structure if it uses the new workflow format (exec-05)
      // Old-format scripts (inline code) are not validated
      let workflowConfig;
      if (isWorkflowFormatScript(info.code)) {
        const validation = await validateWorkflowScript(info.code);
        if (!validation.valid) {
          throw new Error(`Script validation failed: ${validation.error}`);
        }
        workflowConfig = validation.config;
      }

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

      // Race condition check: only activate if planner hasn't updated
      // Compare active_script_id to know if planner changed it while we worked
      const shouldActivate = workflow.active_script_id === opts.expectedScriptId;

      if (shouldActivate) {
        // No race - make this fix the active script
        // Also save handler_config if validation extracted it (exec-05)
        const updates: { active_script_id: string; maintenance: boolean; maintenance_fix_count: number; next_run_timestamp: string; handler_config?: string } = {
          active_script_id: newScript.id,
          maintenance: false,
          maintenance_fix_count: 0,
          next_run_timestamp: new Date().toISOString(),
        };
        if (workflowConfig) {
          updates.handler_config = JSON.stringify(workflowConfig);
        }
        await opts.scriptStore.updateWorkflowFields(opts.workflowId, updates);

        // Update per-producer schedules (exec-13)
        if (workflowConfig && opts.producerScheduleStore) {
          try {
            await updateProducerSchedules(opts.workflowId, workflowConfig, opts.producerScheduleStore);
            // Denormalize schedule info to workflow for display
            const cron = getMostFrequentProducerCron(workflowConfig.producers);
            const nextRunAt = await opts.producerScheduleStore.getNextScheduledTime(opts.workflowId);
            await opts.scriptStore.updateWorkflowFields(opts.workflowId, {
              cron,
              next_run_timestamp: nextRunAt ? new Date(nextRunAt).toISOString() : '',
            });
          } catch (error) {
            // Don't fail the fix save if schedule update fails
          }
        }

        // Release events reserved by the failed handler run so the retry session can find them
        if (opts.eventStore && opts.handlerRunId) {
          await opts.eventStore.releaseEvents(opts.handlerRunId);
        }
      } else {
        // Race detected - planner updated the script
        // Fix is saved but not activated; clear maintenance so planner's version runs
        await opts.scriptStore.updateWorkflowFields(opts.workflowId, {
          maintenance: false,
          maintenance_fix_count: 0,
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
