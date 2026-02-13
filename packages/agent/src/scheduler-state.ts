/**
 * Scheduler State Manager (exec-11)
 *
 * Unified in-memory scheduler state for both consumers and producers.
 *
 * Consumer state:
 * - dirty flag: New events arrived since last run
 * - Used to quickly check if consumer needs to run (before DB query)
 *
 * Producer state:
 * - queued flag: Schedule fired while workflow was busy
 * - Used to ensure missed schedules are processed on next tick
 *
 * These flags are recovered from DB on restart - see recovery methods.
 *
 * Concurrency model: Single-threaded scheduler is the locking mechanism.
 * No explicit locks needed - scheduler checks hasActiveRun before starting.
 */

import debug from "debug";

const log = debug("scheduler-state");

// ============================================================================
// Types
// ============================================================================

/**
 * Consumer scheduler state.
 */
interface ConsumerSchedulerState {
  /** New events arrived since last run */
  dirty: boolean;
  /** Scheduled wake time: 0 = none, >0 = unix ms */
  wakeAt: number;
}

/**
 * Producer scheduler state.
 */
interface ProducerSchedulerState {
  /** Schedule fired while workflow was busy */
  queued: boolean;
}

/**
 * Workflow configuration with consumers and producers.
 * Simplified interface for type safety without circular import.
 */
export interface WorkflowConfigForScheduler {
  consumers: Record<string, { subscribe: string[] }>;
  producers?: Record<string, unknown>;
}

// ============================================================================
// Scheduler State Manager
// ============================================================================

/**
 * Manages in-memory scheduler state for consumers and producers.
 *
 * This class is designed to be:
 * - Fast: In-memory lookups avoid DB queries for common operations
 * - Safe: Single-threaded scheduler ensures no race conditions
 * - Recoverable: State can be rebuilt from DB on restart
 */
export class SchedulerStateManager {
  // Consumer states: workflowId -> consumerName -> state
  private consumerStates: Map<string, Map<string, ConsumerSchedulerState>> =
    new Map();

  // Producer states: workflowId -> producerName -> state
  private producerStates: Map<string, Map<string, ProducerSchedulerState>> =
    new Map();

  // ==================== Consumer Methods ====================

  /**
   * Called when event is published to a topic.
   * Sets dirty flag for all consumers subscribed to that topic.
   *
   * @param workflowId - Workflow ID
   * @param topicName - Topic that received the event
   * @param config - Workflow configuration with consumer subscriptions
   */
  onEventPublish(
    workflowId: string,
    topicName: string,
    config: WorkflowConfigForScheduler
  ): void {
    for (const [consumerName, consumer] of Object.entries(config.consumers)) {
      if (consumer.subscribe.includes(topicName)) {
        this.setConsumerDirty(workflowId, consumerName, true);
        log(
          `Consumer ${workflowId}/${consumerName} dirty=true (event on ${topicName})`
        );
      }
    }
  }

  /**
   * Called when consumer run commits.
   *
   * Only clears dirty when the consumer had no reservations (nothing to
   * consume).  When the consumer DID reserve events it means there may be
   * more pending work in the topic, so dirty stays true and the session's
   * consumer loop will re-enter prepare to check for the next event.
   *
   * @param workflowId - Workflow ID
   * @param consumerName - Consumer that committed
   * @param hadReservations - Whether the committed run reserved (consumed) events
   */
  onConsumerCommit(workflowId: string, consumerName: string, hadReservations: boolean): void {
    if (!hadReservations) {
      this.setConsumerDirty(workflowId, consumerName, false);
      log(`Consumer ${workflowId}/${consumerName} dirty=false (committed, no reservations)`);
    } else {
      log(`Consumer ${workflowId}/${consumerName} dirty kept (committed, had reservations)`);
    }
  }

  /**
   * Set wakeAt time for a consumer.
   *
   * @param workflowId - Workflow ID
   * @param consumerName - Consumer name
   * @param wakeAtMs - Wake time in unix ms (0 = clear)
   */
  setWakeAt(workflowId: string, consumerName: string, wakeAtMs: number): void {
    this.getConsumerState(workflowId, consumerName).wakeAt = wakeAtMs;
    log(`Consumer ${workflowId}/${consumerName} wakeAt=${wakeAtMs > 0 ? new Date(wakeAtMs).toISOString() : 'none'}`);
  }

  /**
   * Get consumers with due wakeAt times.
   *
   * @param workflowId - Workflow ID
   * @returns Consumer names where wakeAt > 0 && wakeAt <= now
   */
  getConsumersWithDueWakeAt(workflowId: string): string[] {
    const workflow = this.consumerStates.get(workflowId);
    if (!workflow) return [];

    const now = Date.now();
    const due: string[] = [];
    for (const [name, state] of workflow) {
      if (state.wakeAt > 0 && state.wakeAt <= now) {
        due.push(name);
      }
    }
    return due;
  }

  /**
   * Set consumer dirty flag.
   *
   * @param workflowId - Workflow ID
   * @param consumerName - Consumer name
   * @param dirty - Whether consumer has pending work
   */
  setConsumerDirty(
    workflowId: string,
    consumerName: string,
    dirty: boolean
  ): void {
    this.getConsumerState(workflowId, consumerName).dirty = dirty;
  }

  /**
   * Check if consumer is dirty (has pending work).
   *
   * @param workflowId - Workflow ID
   * @param consumerName - Consumer name
   * @returns true if consumer has pending work
   */
  isConsumerDirty(workflowId: string, consumerName: string): boolean {
    return this.getConsumerState(workflowId, consumerName).dirty;
  }

  /**
   * Get or create consumer state.
   */
  private getConsumerState(
    workflowId: string,
    consumerName: string
  ): ConsumerSchedulerState {
    let workflow = this.consumerStates.get(workflowId);
    if (!workflow) {
      workflow = new Map();
      this.consumerStates.set(workflowId, workflow);
    }

    let consumer = workflow.get(consumerName);
    if (!consumer) {
      consumer = { dirty: false, wakeAt: 0 };
      workflow.set(consumerName, consumer);
    }

    return consumer;
  }

  // ==================== Producer Methods ====================

  /**
   * Called when producer schedule fires while workflow is busy.
   * Sets queued flag to run producer when workflow becomes idle.
   *
   * @param workflowId - Workflow ID
   * @param producerName - Producer whose schedule fired
   * @param queued - Whether producer should run on next tick
   */
  setProducerQueued(
    workflowId: string,
    producerName: string,
    queued: boolean
  ): void {
    this.getProducerState(workflowId, producerName).queued = queued;
    if (queued) {
      log(`Producer ${workflowId}/${producerName} queued=true (schedule fired while busy)`);
    }
  }

  /**
   * Check if producer is queued (missed schedule needs to run).
   *
   * @param workflowId - Workflow ID
   * @param producerName - Producer name
   * @returns true if producer has queued schedule
   */
  isProducerQueued(workflowId: string, producerName: string): boolean {
    return this.getProducerState(workflowId, producerName).queued;
  }

  /**
   * Called when producer run commits.
   * Clears the queued flag since producer ran.
   *
   * @param workflowId - Workflow ID
   * @param producerName - Producer that committed
   */
  onProducerCommit(workflowId: string, producerName: string): void {
    this.setProducerQueued(workflowId, producerName, false);
    log(`Producer ${workflowId}/${producerName} queued=false (committed)`);
  }

  /**
   * Get or create producer state.
   */
  private getProducerState(
    workflowId: string,
    producerName: string
  ): ProducerSchedulerState {
    let workflow = this.producerStates.get(workflowId);
    if (!workflow) {
      workflow = new Map();
      this.producerStates.set(workflowId, workflow);
    }

    let producer = workflow.get(producerName);
    if (!producer) {
      producer = { queued: false };
      workflow.set(producerName, producer);
    }

    return producer;
  }

  /**
   * Check if a workflow has been initialized in the scheduler state.
   */
  isWorkflowTracked(workflowId: string): boolean {
    return this.consumerStates.has(workflowId);
  }

  // ==================== Cleanup ====================

  /**
   * Clear all state for a workflow.
   * Called when workflow is deleted or disabled.
   *
   * @param workflowId - Workflow ID to clear
   */
  clearWorkflow(workflowId: string): void {
    this.consumerStates.delete(workflowId);
    this.producerStates.delete(workflowId);
    log(`Cleared all scheduler state for workflow ${workflowId}`);
  }

  /**
   * Clear all state.
   * Called on shutdown or reset.
   */
  clearAll(): void {
    this.consumerStates.clear();
    this.producerStates.clear();
    log("Cleared all scheduler state");
  }

  // ==================== Initialization ====================

  /**
   * Initialize state for a newly deployed workflow.
   *
   * Per exec-11 spec:
   * - Set all consumers dirty=true (runs prepare immediately)
   * - Producers are initialized separately via exec-13
   *
   * @param workflowId - Workflow ID
   * @param config - Workflow configuration
   */
  initializeForWorkflow(
    workflowId: string,
    config: WorkflowConfigForScheduler
  ): void {
    // Set all consumers dirty on deploy
    for (const consumerName of Object.keys(config.consumers)) {
      this.setConsumerDirty(workflowId, consumerName, true);
    }
    log(
      `Initialized scheduler state for workflow ${workflowId}: ` +
        `${Object.keys(config.consumers).length} consumers set dirty`
    );
  }

  // ==================== Debug ====================

  /**
   * Get all dirty consumers for a workflow (for debugging).
   */
  getDirtyConsumers(workflowId: string): string[] {
    const workflow = this.consumerStates.get(workflowId);
    if (!workflow) return [];

    const dirty: string[] = [];
    for (const [name, state] of workflow) {
      if (state.dirty) dirty.push(name);
    }
    return dirty;
  }

  /**
   * Get all queued producers for a workflow (for debugging).
   */
  getQueuedProducers(workflowId: string): string[] {
    const workflow = this.producerStates.get(workflowId);
    if (!workflow) return [];

    const queued: string[] = [];
    for (const [name, state] of workflow) {
      if (state.queued) queued.push(name);
    }
    return queued;
  }
}
