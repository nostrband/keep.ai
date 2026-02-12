Fix Workflow Retry After Fix, Transient Errors, and Crashes

 Context

 Four interconnected issues prevent correct workflow retry:

 1. Post-mutation duplicate side effects: After maintainer calls fix, the fix tool releases reserved events (fix.ts:141) and the next session starts fresh — re-running the mutation (e.g. sending a duplicate email). The phase-reset logic in getStartPhaseForRetry/shouldCopyResults handles this correctly (skips mutation for post-mutation retries) but is only used by crash recovery via createRetryRun().
 2. Fix doesn't trigger immediate retry: updateProducerSchedules() preserves existing next_run_at when schedule is unchanged (producer-schedule-init.ts:119). The scheduler only creates sessions when producers are due. So after fix, the workflow waits for the next scheduled cycle.
 3. Transient errors pause instead of retrying: session-orchestration.ts routes paused:transient through suspendSession() → sets workflow.status = "paused". The existing exponential backoff code in handleWorkerSignal({ type: 'retry' }) is dead code — nothing emits the retry signal.
 4. Crash recovery creates retry runs in the same session: createRetryRun() (handler-state-machine.ts:308-368) creates the retry handler_run in the same script_run (session) as the crashed run. This is inconsistent with fix/transient recovery (which must use new sessions since the old one is closed) and produces worse UX — the user can't see a clear boundary between "workflow ran and crashed" vs "workflow recovered."

 Additionally, consumer-only work (pending events, due wakeAt) never triggers a session because the scheduler only checks for due producers.

 Approach

 Unify all automatic recovery (crash, transient, fix) through a single mechanism:

 1. Add a pending_retry_run_id field to workflows
 2. All recovery paths set this field (fix tool, transient error handling, crash recovery)
 3. The scheduler checks this field first and creates a targeted retry session via retryWorkflowSession() with correct phase-reset rules
 4. Every recovery produces a new, separate session — clean UX boundaries
 5. Also add consumer-only work detection to the scheduler

 Design rationale: unified recovery with new sessions

 Sessions (script_run) are a UX/observability grouping — they show the user "workflow ran at time T." No part of the execution model or implementation logic depends on session boundaries. The critical invariants (single-threaded execution, phase reset rules, retry_of chain) all operate at the handler_run level.

 All recovery paths share the same core logic:
 - Load the failed run
 - Compute phase reset (getStartPhaseForRetry, shouldCopyResults)
 - Create a new handler_run with retry_of pointing to the failed run
 - Execute it, then continue the consumer loop

 The only difference was that crash recovery created the retry in the same session (via createRetryRun), while fix/transient recovery must use new sessions (old session already closed). There's no reason for this split — all recovery should create new sessions:
 - Better UX: "workflow ran → crashed → ran again" is clearer than an invisible in-session recovery
 - One code path instead of two
 - Consistent observability: every recovery is a visible, separate session

 The existing createRetryRun() function remains available for indeterminate-resolution.ts (user-action flow, out of scope for this change).

 Files to modify
 ┌─────────────────────────────────────────────┬─────────────────────────────────────────────────────────────────────────────────────────────────┐
 │                    File                     │                                             Changes                                             │
 ├─────────────────────────────────────────────┼─────────────────────────────────────────────────────────────────────────────────────────────────┤
 │ packages/db/src/migrations/v46.ts           │ New migration: add pending_retry_run_id column                                                  │
 ├─────────────────────────────────────────────┼─────────────────────────────────────────────────────────────────────────────────────────────────┤
 │ packages/db/src/database.ts                 │ Register v46 migration                                                                          │
 ├─────────────────────────────────────────────┼─────────────────────────────────────────────────────────────────────────────────────────────────┤
 │ packages/db/src/script-store.ts             │ Add field to Workflow interface + updateWorkflowFields                                          │
 ├─────────────────────────────────────────────┼─────────────────────────────────────────────────────────────────────────────────────────────────┤
 │ packages/db/src/event-store.ts              │ Add hasAnyPendingForWorkflow(workflowId)                                                        │
 ├─────────────────────────────────────────────┼─────────────────────────────────────────────────────────────────────────────────────────────────┤
 │ packages/agent/src/session-orchestration.ts │ Add retryWorkflowSession(), finishSessionForTransient(), rewrite resumeIncompleteSessions(),    │
 │                                             │ export findConsumerWithPendingWork                                                               │
 ├─────────────────────────────────────────────┼─────────────────────────────────────────────────────────────────────────────────────────────────┤
 │ packages/agent/src/workflow-scheduler.ts    │ Priority check for pending_retry_run_id, transient signal routing, consumer-only work detection │
 ├─────────────────────────────────────────────┼─────────────────────────────────────────────────────────────────────────────────────────────────┤
 │ packages/agent/src/ai-tools/fix.ts          │ Set pending_retry_run_id instead of releasing events; reset producer schedules to now           │
 └─────────────────────────────────────────────┴─────────────────────────────────────────────────────────────────────────────────────────────────┘
 Implementation steps

 1. Migration v46: add pending_retry_run_id to workflows

 New file packages/db/src/migrations/v46.ts — add pending_retry_run_id TEXT NOT NULL DEFAULT '' to workflows using crsql_begin_alter/crsql_commit_alter pattern (same as v45).

 Register in packages/db/src/database.ts import list and migration array.

 2. Workflow type + store updates

 packages/db/src/script-store.ts:
 - Add pending_retry_run_id: string to Workflow interface (after intent_spec)
 - Add to updateWorkflowFields fields Partial<Pick<...>> union and the if-clause
 - Add to getWorkflow() and listWorkflows() result mapping (it uses SELECT *, so the SQL is fine — just map the column)
 - Add to addWorkflow() INSERT (with default '')

 3. retryWorkflowSession() — new function in session-orchestration.ts

 Core retry logic used by ALL recovery paths (crash, transient, fix). Atomically creates the retry run AND clears pending_retry_run_id in one transaction for crash safety.

 retryWorkflowSession(workflow, failedHandlerRunId, context):
   1. Load failed handler run; if not found → clear pending_retry_run_id, fallback to executeWorkflowSession("event")
   2. Check getRetriesOf(failedRunId); if already retried → clear pending_retry_run_id, fallback
   3. Compute: startPhase = getStartPhaseForRetry(failedRun.phase)
              copyResults = shouldCopyResults(failedRun.phase)
   4. Create new session (script_run) with trigger "retry"
   5. ATOMIC TRANSACTION:
      a. Create retry handler run via handlerRunStore.create({
           script_run_id: newSessionId,
           workflow_id, handler_type, handler_name from failedRun,
           retry_of: failedRun.id,
           phase: startPhase,
           prepare_result: copyResults ? failedRun.prepare_result : undefined
         })
      b. Clear pending_retry_run_id on workflow
      c. If startPhase === "preparing": release events from failedRun (pre-mutation reset)
   6. Execute the retry run via executeHandler()
   7. Handle result: failed:logic → maintenance, paused:transient → transient, paused:* → suspended
   8. If committed → continue consumer loop (same as executeWorkflowSession consumer loop)
   9. Complete session

 Crash safety: If crash before step 5 tx: pending_retry_run_id still set → scheduler retries on restart. If crash during step 6: retry handler run has status: 'active' → resumeIncompleteSessions() sets pending_retry_run_id → scheduler retries. If crash after step 6: normal session completion/recovery.

 Import getStartPhaseForRetry, shouldCopyResults from handler-state-machine.ts (already exported).

 4. finishSessionForTransient() — new helper in session-orchestration.ts

 Same as finishSessionForMaintenance() but for transient errors. Finishes the session as "failed" with error_type "network" but does NOT set workflow.status — keeps workflow active so the scheduler can retry.

 5. finishSessionForCrash() — new helper in session-orchestration.ts

 Finishes a session as "failed" with error_type "crash". Does NOT set workflow.status — keeps workflow active so the scheduler retries via pending_retry_run_id.

 6. Session orchestration: route paused:transient separately

 In executeWorkflowSession() at the three isPausedStatus checks (producer line ~386, consumer line ~452, and continueSession line ~565):

 Replace:
 if (isPausedStatus(result.status)) → suspendSession()
 With:
 if (result.status === "paused:transient") {
   finishSessionForTransient(...)
   return { status: "transient", handlerRunId, handlerName, ... }
 }
 if (isPausedStatus(result.status)) {
   suspendSession(...)
   return { status: "suspended", ... }
 }

 Add "transient" to the SessionResult.status union type.

 7. Rewrite resumeIncompleteSessions() — unified crash recovery

 The current implementation uses createRetryRun() to create retry runs in the same session. Replace with:

 resumeIncompleteSessions(context):
   1. Find workflows with incomplete handler runs (status = 'active')
   2. Skip paused/error workflows
   3. For each incomplete run:
      a. Check for in-flight mutation:
         - Mark mutation indeterminate
         - Mark run paused:reconciliation
         - Pause workflow (status = 'paused') — same as now, needs user verification
         - Skip this run (don't set pending_retry_run_id)
      b. For all other cases, ATOMIC TRANSACTION:
         - Mark run as crashed (status = 'crashed', end_timestamp = now)
         - Close the session via finishSessionForCrash()
         - Set pending_retry_run_id = run.id on workflow
   4. Return — scheduler handles the rest via retryWorkflowSession()

 The atomicity of step 3b is critical: if we crash between marking the run as crashed and setting pending_retry_run_id, the run would be lost. A single transaction ensures both happen or neither does.

 Remove the continueSession() call that currently follows crash recovery execution — retryWorkflowSession() handles the consumer loop when the scheduler picks up the pending_retry_run_id.

 Note: createRetryRun() is NOT removed — it's still used by indeterminate-resolution.ts for user-action mutation resolution (separate concern, out of scope).

 8. Fix tool changes (fix.ts)

 When shouldActivate is true:

 Remove the unconditional eventStore.releaseEvents(handlerRunId) (line 140-142).

 Add pending_retry_run_id: opts.handlerRunId || '' to the updateWorkflowFields call (line 112-117). This tells the scheduler to create a targeted retry.

 Add after updateProducerSchedules(): reset all producer schedules to next_run_at = Date.now() when they're in the future. This is belt-and-suspenders — ensures the workflow also works through normal scheduling if the retry path somehow fails. Use producerScheduleStore.getForWorkflow() + upsert() with next_run_at: Date.now() for each schedule where next_run_at > Date.now().

 9. Scheduler changes (workflow-scheduler.ts)

 9a. Priority 1: Check pending_retry_run_id

 At the top of processNextWorkflow(), before any producer/consumer checks:

 for (const workflow of activeWorkflows) {
   if (!workflow.pending_retry_run_id) continue;
   // Skip if in retry backoff (transient errors)
   const retryState = this.workflowRetryState.get(workflow.id);
   if (retryState && retryState.nextStart > currentTime) continue;
   // Execute retry — retryWorkflowSession handles clearing pending_retry_run_id atomically
   const context = this.createExecutionContext();
   const canStart = await canStartSession(this.api, workflow.id);
   if (!canStart) continue;
   const result = await retryWorkflowSession(workflow, workflow.pending_retry_run_id, context);
   if (result.status === 'maintenance') await this.enterMaintenanceModeForSession(workflow, result);
   this.handleSessionResult(workflow.id, result);
   return true;
 }

 Refactor executeNewFormatWorkflow → extract postSessionResult(workflow, result) helper to avoid duplicating the maintenance + signal routing logic.

 9b. Handle "transient" in handleSessionResult()

 New case:
 case 'transient':
   // Set pending_retry_run_id for retry after backoff
   this.api.scriptStore.updateWorkflowFields(workflowId, {
     pending_retry_run_id: result.handlerRunId || '',
   });
   // Use existing backoff mechanism
   this.handleWorkerSignal({
     type: 'retry', workflowId, timestamp: Date.now(),
     error: result.error, errorType: 'network', scriptRunId: result.sessionId
   });
   break;

 9c. Consumer-only work detection

 After checking due producers, for active workflows not already in dueWorkflows and not in retry backoff:
 - Call api.eventStore.hasAnyPendingForWorkflow(workflowId) (new efficient method — see step 10)
 - Call api.handlerStateStore.getConsumersWithDueWakeAt(workflowId) (existing, single indexed query)
 - If either finds work, add to due list

 These consumer-only workflows get trigger: "event" passed to executeWorkflowSessionIfIdle (skips producers per session-orchestration.ts:316). Add a trigger parameter to executeNewFormatWorkflow().

 // TODO: Optimize consumer-only detection for large numbers of workflows.
 // Currently does 2 queries per active workflow per tick. For 50+ workflows,
 // consider a batch query: SELECT DISTINCT workflow_id FROM events WHERE status='pending'
 // UNION SELECT workflow_id FROM handler_state WHERE wake_at > 0 AND wake_at <= ?

 10. Add hasAnyPendingForWorkflow() to EventStore

 packages/db/src/event-store.ts:

 Single efficient query that checks if ANY pending event exists for a workflow, without needing topic names:
 SELECT 1 FROM events WHERE workflow_id = ? AND status = 'pending' LIMIT 1

 This avoids the N-per-topic query explosion. The events table already has workflow_id as a direct column. With 50 workflows, that's 50 simple indexed queries per tick instead of 50x10x2 = 1000.

 11. Export changes in session-orchestration.ts

 Export findConsumerWithPendingWork (currently private) for potential reuse. Export retryWorkflowSession. The SessionResult type is already exported.

 Edge cases

 - pending_retry_run_id points to deleted/missing run: retryWorkflowSession clears it, falls back to executeWorkflowSession("event")
 - Run already retried (e.g. two recovery paths raced): checked via getRetriesOf(), clears pending_retry_run_id, falls back to normal session
 - Race: user manually restarts while pending_retry_run_id is set: canStartSession() check prevents concurrent execution; pending_retry_run_id cleared atomically with retry run creation
 - Crash before retry tx commits: pending_retry_run_id still set → scheduler retries on restart
 - Crash during retry run execution: retry handler run has status 'active' → resumeIncompleteSessions() marks crashed + sets pending_retry_run_id → scheduler retries
 - Restart during transient backoff: in-memory workflowRetryState lost, pending_retry_run_id persists → retries immediately (conservative/correct: time passed during restart)
 - Crash between step 3b operations in resumeIncompleteSessions: impossible — mark-crashed + close-session + set-pending are in one transaction
 - In-flight mutation at crash: same as current behavior — mark indeterminate, pause workflow for user reconciliation, don't set pending_retry_run_id

 Implementation order

 1. v46 migration + Workflow type/store updates (foundation)
 2. hasAnyPendingForWorkflow() in EventStore (foundation)
 3. finishSessionForTransient() + finishSessionForCrash() + SessionResult type update (small, self-contained)
 4. retryWorkflowSession() (core logic, depends on 1)
 5. Session orchestration paused:transient routing (depends on 3)
 6. Rewrite resumeIncompleteSessions() (depends on 1, 5)
 7. Fix tool changes (depends on 1)
 8. Scheduler: pending_retry_run_id priority check + transient handling + consumer-only detection (depends on 2-7)

 Verification

 - turbo run build — full typecheck
 - Manual test: create a workflow with a consumer that fails in next() after mutation. Apply fix. Verify the retry skips mutation and starts at "emitting" in a NEW session.
 - Manual test: simulate a network error. Verify the workflow stays active (not paused), backs off, and retries in a NEW session.
 - Manual test: kill the process mid-handler. Verify on restart: crashed run is finalized, old session is closed, pending_retry_run_id is set, and scheduler creates a NEW retry session.
 - Manual test: release events into topics with no due producer. Verify consumer-only session is created.
