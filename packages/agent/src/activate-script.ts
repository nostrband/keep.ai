/**
 * Script Activation.
 *
 * Single function for activating a script version. Used by:
 * - handleMaintainerCompletion (after fix tool succeeds)
 * - UI "Activate" button (manual=true)
 * - Future: planner activation
 *
 * Atomically:
 * 1. Sets active_script_id, clears maintenance, resets producer schedules to now
 * 2. Updates producer schedule configs (add/remove/update) if workflowConfig provided
 * 3. Denormalizes cron to workflow for display
 */

import debug from "debug";
import { KeepDbApi } from "@app/db";
import { WorkflowConfig } from "./workflow-validator";
import { updateProducerSchedules } from "./producer-schedule-init";
import { getMostFrequentProducerCron } from "./schedule-utils";

const log = debug("activate-script");

export interface ActivateScriptParams {
  workflowId: string;
  scriptId: string;
  /** Extracted workflow config — when provided, schedule configs are synced */
  workflowConfig?: WorkflowConfig;
  /** Handler config JSON to store on workflow */
  handlerConfig?: string;
  /** Handler run ID for targeted retry */
  pendingRetryRunId?: string;
  /** Manual activation (UI) — also resets maintenance_fix_count */
  manual?: boolean;
}

/**
 * Activate a script version for a workflow.
 *
 * This is the SINGLE entry point for all script activations.
 * It handles both the atomic DB operations and the schedule config sync.
 */
export async function activateScript(
  api: KeepDbApi,
  params: ActivateScriptParams
): Promise<void> {
  const { workflowId, scriptId, workflowConfig, handlerConfig, pendingRetryRunId, manual } = params;

  // 1. Atomic DB operations: set active_script_id, clear maintenance,
  //    set handler_config/pending_retry_run_id, reset producer schedules to now
  await api.activateScript({
    workflowId,
    scriptId,
    handlerConfig,
    pendingRetryRunId,
    manual,
  });

  log(`Activated script ${scriptId} for workflow ${workflowId}${manual ? ' (manual)' : ''}`);

  // 2. Sync producer schedule configs if workflowConfig is available
  //    This handles adding/removing/updating schedule types based on the new script
  if (workflowConfig) {
    try {
      await updateProducerSchedules(workflowId, workflowConfig, api.producerScheduleStore);

      // 3. Denormalize schedule info to workflow for display
      const cron = getMostFrequentProducerCron(workflowConfig.producers);
      const nextRunAt = await api.producerScheduleStore.getNextScheduledTime(workflowId);
      await api.scriptStore.updateWorkflowFields(workflowId, {
        cron,
        next_run_timestamp: nextRunAt ? new Date(nextRunAt).toISOString() : '',
      });
    } catch (error) {
      log(`Failed to update producer schedules for workflow ${workflowId}:`, error);
    }
  }
}
