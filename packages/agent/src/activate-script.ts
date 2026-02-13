/**
 * Script Activation.
 *
 * Single function for activating a script version. Used by:
 * - handleMaintainerCompletion (after fix tool succeeds)
 * - Future: planner activation
 *
 * The UI "Activate" button calls api.activateScript() directly.
 *
 * Atomically (via api.activateScript):
 * 1. Reads handler_config from the script (single source of truth)
 * 2. Sets active_script_id, handler_config, clears maintenance
 * 3. Syncs producer schedules (add/remove/update)
 *
 * Then denormalizes cron to workflow for display.
 */

import debug from "debug";
import { KeepDbApi } from "@app/db";
import { WorkflowConfig } from "./workflow-validator";
import { getMostFrequentProducerCron } from "./schedule-utils";

const log = debug("activate-script");

export interface ActivateScriptParams {
  workflowId: string;
  scriptId: string;
  /** Extracted workflow config — used for cron denormalization (avoids re-parsing) */
  workflowConfig?: WorkflowConfig;
  /** Handler run ID for targeted retry */
  pendingRetryRunId?: string;
  /** Manual activation (UI) — also resets maintenance_fix_count */
  manual?: boolean;
}

/**
 * Activate a script version for a workflow.
 *
 * handler_config is always read from the script record by api.activateScript() —
 * it is never passed as a parameter to avoid consistency issues.
 */
export async function activateScript(
  api: KeepDbApi,
  params: ActivateScriptParams
): Promise<void> {
  const { workflowId, scriptId, workflowConfig, pendingRetryRunId, manual } = params;

  // Atomic DB operations: reads handler_config from script, sets active_script_id,
  // clears maintenance, syncs producer schedules
  await api.activateScript({
    workflowId,
    scriptId,
    pendingRetryRunId,
    manual,
  });

  log(`Activated script ${scriptId} for workflow ${workflowId}${manual ? ' (manual)' : ''}`);

  // Denormalize schedule info to workflow for display
  if (workflowConfig) {
    try {
      const cron = getMostFrequentProducerCron(workflowConfig.producers);
      const nextRunAt = await api.producerScheduleStore.getNextScheduledTime(workflowId);
      await api.scriptStore.updateWorkflowFields(workflowId, {
        cron,
        next_run_timestamp: nextRunAt ? new Date(nextRunAt).toISOString() : '',
      });
    } catch (error) {
      log(`Failed to denormalize cron for workflow ${workflowId}:`, error);
    }
  }
}
