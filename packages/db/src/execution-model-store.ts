/**
 * ExecutionModelStore — facade that groups all store operations needed by
 * the ExecutionModelManager.
 *
 * This is the ONLY interface the execution model should use to reach the
 * underlying stores.  The individual store methods it delegates to are
 * marked `@internal` — direct callers risk bypassing the execution model's
 * transactional invariants.
 */

import { HandlerRunStore, HandlerRun, HandlerRunPhase, CreateHandlerRunInput, UpdateHandlerRunInput } from "./handler-run-store";
import { ScriptStore, Workflow, ScriptRun } from "./script-store";
import { EventStore, EventReservation } from "./event-store";
import { MutationStore, Mutation, UpdateMutationInput } from "./mutation-store";
import { HandlerStateStore } from "./handler-state-store";
import { ProducerScheduleStore } from "./producer-schedule-store";
import { DBInterface } from "./interfaces";

export class ExecutionModelStore {
  private handlerRunStore: HandlerRunStore;
  private scriptStore: ScriptStore;
  private eventStore: EventStore;
  private mutationStore: MutationStore;
  private handlerStateStore: HandlerStateStore;
  private producerScheduleStore: ProducerScheduleStore;

  constructor(
    handlerRunStore: HandlerRunStore,
    scriptStore: ScriptStore,
    eventStore: EventStore,
    mutationStore: MutationStore,
    handlerStateStore: HandlerStateStore,
    producerScheduleStore: ProducerScheduleStore,
  ) {
    this.handlerRunStore = handlerRunStore;
    this.scriptStore = scriptStore;
    this.eventStore = eventStore;
    this.mutationStore = mutationStore;
    this.handlerStateStore = handlerStateStore;
    this.producerScheduleStore = producerScheduleStore;
  }

  // ==========================================================================
  // Handler Run operations
  // ==========================================================================

  async getHandlerRun(id: string, tx?: DBInterface): Promise<HandlerRun | null> {
    return this.handlerRunStore.get(id, tx);
  }

  async updateHandlerRun(id: string, input: UpdateHandlerRunInput, tx?: DBInterface): Promise<void> {
    return this.handlerRunStore.update(id, input, tx);
  }

  async updateHandlerRunPhase(id: string, phase: HandlerRunPhase, tx?: DBInterface): Promise<void> {
    return this.handlerRunStore.updatePhase(id, phase, tx);
  }

  async createHandlerRun(input: CreateHandlerRunInput, tx?: DBInterface): Promise<HandlerRun> {
    return this.handlerRunStore.create(input, tx);
  }

  async getHandlerRunsBySession(sessionId: string, tx?: DBInterface): Promise<HandlerRun[]> {
    return this.handlerRunStore.getBySession(sessionId, tx);
  }

  async getIncompleteHandlerRuns(workflowId: string, tx?: DBInterface): Promise<HandlerRun[]> {
    return this.handlerRunStore.getIncomplete(workflowId, tx);
  }

  async getWorkflowsWithIncompleteRuns(tx?: DBInterface): Promise<string[]> {
    return this.handlerRunStore.getWorkflowsWithIncompleteRuns(tx);
  }

  // ==========================================================================
  // Workflow operations
  // ==========================================================================

  async updateWorkflowFields(
    workflowId: string,
    fields: Parameters<ScriptStore["updateWorkflowFields"]>[1],
    tx?: DBInterface,
  ): Promise<void> {
    return this.scriptStore.updateWorkflowFields(workflowId, fields, tx);
  }

  async listWorkflows(limit?: number, offset?: number): Promise<Workflow[]> {
    return this.scriptStore.listWorkflows(limit, offset);
  }

  // ==========================================================================
  // Session (ScriptRun) operations
  // ==========================================================================

  async finishSession(
    id: string,
    timestamp: string,
    result: string,
    error: string,
    logs: string,
    errorType: string,
    cost: number,
    tx?: DBInterface,
  ): Promise<void> {
    return this.scriptStore.finishScriptRun(id, timestamp, result, error, logs, errorType, cost, tx);
  }

  async incrementHandlerCount(sessionId: string, tx?: DBInterface): Promise<number> {
    return this.scriptStore.incrementHandlerCount(sessionId, tx);
  }

  async getActiveSessions(): Promise<ScriptRun[]> {
    return this.scriptStore.getActiveScriptRuns();
  }

  // ==========================================================================
  // Event operations
  // ==========================================================================

  async reserveEvents(runId: string, reservations: EventReservation[], tx?: DBInterface): Promise<void> {
    return this.eventStore.reserveEvents(runId, reservations, tx);
  }

  async consumeEvents(runId: string, tx?: DBInterface): Promise<void> {
    return this.eventStore.consumeEvents(runId, tx);
  }

  async releaseEvents(runId: string, tx?: DBInterface): Promise<void> {
    return this.eventStore.releaseEvents(runId, tx);
  }

  async skipEvents(runId: string, tx?: DBInterface): Promise<void> {
    return this.eventStore.skipEvents(runId, tx);
  }

  async transferReservations(fromRunId: string, toRunId: string, tx?: DBInterface): Promise<void> {
    return this.eventStore.transferReservations(fromRunId, toRunId, tx);
  }

  // ==========================================================================
  // Mutation operations
  // ==========================================================================

  async getMutation(id: string, tx?: DBInterface): Promise<Mutation | null> {
    return this.mutationStore.get(id, tx);
  }

  async getMutationByRunId(runId: string, tx?: DBInterface): Promise<Mutation | null> {
    return this.mutationStore.getByHandlerRunId(runId, tx);
  }

  async updateMutation(id: string, input: UpdateMutationInput, tx?: DBInterface): Promise<void> {
    return this.mutationStore.update(id, input, tx);
  }

  // ==========================================================================
  // Handler State operations
  // ==========================================================================

  async setHandlerState(
    workflowId: string,
    handlerName: string,
    state: unknown,
    runId: string,
    tx?: DBInterface,
  ): Promise<void> {
    return this.handlerStateStore.set(workflowId, handlerName, state, runId, tx);
  }

  async updateHandlerWakeAt(
    workflowId: string,
    handlerName: string,
    wakeAt: number,
    tx?: DBInterface,
  ): Promise<void> {
    return this.handlerStateStore.updateWakeAt(workflowId, handlerName, wakeAt, tx);
  }

  // ==========================================================================
  // Producer Schedule operations
  // ==========================================================================

  async updateProducerScheduleAfterRun(
    workflowId: string,
    producerName: string,
    nextRunAt: number,
    tx?: DBInterface,
  ): Promise<void> {
    return this.producerScheduleStore.updateAfterRun(workflowId, producerName, nextRunAt, tx);
  }
}
