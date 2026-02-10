/**
 * Producer Schedule Initialization (exec-13).
 *
 * Initializes and updates producer schedules when workflows are deployed or updated.
 */

import debug from "debug";
import { ProducerScheduleStore, ScheduleType } from "@app/db";
import { extractSchedule } from "./schedule-utils";
import { WorkflowConfig } from "./workflow-validator";

const log = debug("producer-schedule-init");

/**
 * Initialize producer schedules for a workflow.
 *
 * Called when a workflow is deployed or activated. Creates schedule records
 * for all producers defined in the config.
 *
 * @param workflowId - Workflow ID
 * @param config - Workflow configuration with producers
 * @param store - Producer schedule store
 */
export async function initializeProducerSchedules(
  workflowId: string,
  config: WorkflowConfig,
  store: ProducerScheduleStore
): Promise<void> {
  const producers = config.producers || {};
  const producerNames = Object.keys(producers);

  if (producerNames.length === 0) {
    log(`No producers in workflow ${workflowId}`);
    return;
  }

  log(`Initializing ${producerNames.length} producer schedules for workflow ${workflowId}`);

  for (const [producerName, producer] of Object.entries(producers)) {
    const schedule = extractSchedule(producer.schedule);

    if (!schedule) {
      log(`Producer ${producerName} has no schedule, skipping`);
      continue;
    }

    // Run immediately on first initialization — don't wait a full interval
    const nextRunAt = Date.now();

    await store.upsert({
      workflow_id: workflowId,
      producer_name: producerName,
      schedule_type: schedule.type as ScheduleType,
      schedule_value: schedule.value,
      next_run_at: nextRunAt,
    });

    log(`Producer ${workflowId}/${producerName}: ${schedule.type}=${schedule.value}, next_run_at=${new Date(nextRunAt).toISOString()} (immediate)`);
  }
}

/**
 * Update producer schedules when workflow config changes.
 *
 * This handles:
 * - Adding schedules for new producers
 * - Updating schedules for existing producers with changed config
 * - Removing schedules for deleted producers
 *
 * @param workflowId - Workflow ID
 * @param config - New workflow configuration
 * @param store - Producer schedule store
 */
export async function updateProducerSchedules(
  workflowId: string,
  config: WorkflowConfig,
  store: ProducerScheduleStore
): Promise<void> {
  const newProducers = config.producers || {};
  const newProducerNames = new Set(Object.keys(newProducers));

  // Get existing schedules
  const existingSchedules = await store.getForWorkflow(workflowId);
  const existingNames = new Set(existingSchedules.map((s) => s.producer_name));

  log(`Updating producer schedules for workflow ${workflowId}: ${existingNames.size} existing, ${newProducerNames.size} in config`);

  // Update or add schedules for producers in new config
  for (const [producerName, producer] of Object.entries(newProducers)) {
    const schedule = extractSchedule(producer.schedule);

    if (!schedule) {
      // Producer has no schedule - remove if exists
      if (existingNames.has(producerName)) {
        await store.delete(workflowId, producerName);
        log(`Removed schedule for producer ${producerName} (no schedule in config)`);
      }
      continue;
    }

    const existing = existingSchedules.find((s) => s.producer_name === producerName);

    if (existing) {
      // Check if schedule changed
      if (
        existing.schedule_type !== schedule.type ||
        existing.schedule_value !== schedule.value
      ) {
        // Schedule changed - run immediately with new config
        await store.upsert({
          workflow_id: workflowId,
          producer_name: producerName,
          schedule_type: schedule.type as ScheduleType,
          schedule_value: schedule.value,
          next_run_at: Date.now(),
        });
        log(`Updated schedule for producer ${producerName}: ${schedule.type}=${schedule.value} (immediate)`);
      }
      // If schedule unchanged, keep existing next_run_at
    } else {
      // New producer - run immediately
      await store.upsert({
        workflow_id: workflowId,
        producer_name: producerName,
        schedule_type: schedule.type as ScheduleType,
        schedule_value: schedule.value,
        next_run_at: Date.now(),
      });
      log(`Added schedule for new producer ${producerName}: ${schedule.type}=${schedule.value} (immediate)`);
    }
  }

  // Remove schedules for producers no longer in config
  for (const existing of existingSchedules) {
    if (!newProducerNames.has(existing.producer_name)) {
      await store.delete(workflowId, existing.producer_name);
      log(`Removed schedule for deleted producer ${existing.producer_name}`);
    }
  }
}

/**
 * Remove all producer schedules for a workflow.
 *
 * Called when a workflow is deleted or disabled.
 *
 * @param workflowId - Workflow ID
 * @param store - Producer schedule store
 */
export async function removeProducerSchedules(
  workflowId: string,
  store: ProducerScheduleStore
): Promise<void> {
  await store.deleteByWorkflow(workflowId);
  log(`Removed all producer schedules for workflow ${workflowId}`);
}
