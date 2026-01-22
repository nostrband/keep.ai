# Auto-Fix Mode (Maintenance)

## Overview

When a script fails with a logic error (bug in code), AI automatically attempts to fix it without user intervention. This is called "maintenance mode."

## When Maintenance Mode Activates

```
Script execution fails
        |
        v
Error classified as 'logic'
        |
        v
workflow.maintenance = true
        |
        v
AI analyzes error + logs
        |
        v
AI modifies script
        |
        v
Script re-runs automatically
```

## Maintenance Flow

```
                    +------------------+
                    | Script Run Fails |
                    |  (logic error)   |
                    +--------+---------+
                             |
                             v
                    +------------------+
                    | Check fix count  |
                    | < MAX_ATTEMPTS?  |
                    +--------+---------+
                             |
            +----------------+----------------+
            | Yes                            | No (>= 3)
            v                                v
    +------------------+            +------------------+
    | maintenance_     |            | Escalate to user |
    | started event    |            | (see below)      |
    +--------+---------+            +------------------+
             |
             v
    +------------------+
    | AI analyzes:     |
    | - Error message  |
    | - Script code    |
    | - Execution logs |
    +--------+---------+
             |
             v
    +------------------+
    | AI decides:      |
    +--------+---------+
             |
    +--------+--------------------+
    |                            |
    v                            v
+--------+                  +----------+
| Save   |                  | Neither  |
| (fix)  |                  | (fail)   |
+---+----+                  +-----+----+
    |                             |
    v                             v
maintenance_                 Escalate
fixed event                  to user
    |
    v
Re-run script
    |
    +---> Success: Done!
    |
    +---> Fail: Increment count, loop back
```

## Max Fix Attempts

```typescript
const MAX_FIX_ATTEMPTS = 3;
```

After 3 consecutive failed fix attempts, AI gives up and escalates to user.

The counter (`maintenance_fix_count`) resets when:
- A fix succeeds and script runs successfully
- User manually intervenes

## Maintenance Events

### maintenance_started

Created when AI begins analyzing the error:

```typescript
await chatStore.saveChatEvent(generateId(), task.chat_id, "maintenance_started", {
  workflow_id: workflow.id,
  script_run_id: scriptRunId,
  error_type: error.type,
  error_message: error.message,
});
```

### maintenance_fixed

Created when AI successfully saves a fixed script (via save tool):

```typescript
await chatStore.saveChatEvent(generateId(), chatId, "maintenance_fixed", {
  script_id: script.id,
  change_comment: info.comment,  // AI's summary of the fix
  workflow_id: workflow.id,
});
```

### maintenance_escalated

Created when AI gives up after max attempts:

```typescript
await chatStore.saveChatEvent(generateId(), task.chat_id, "maintenance_escalated", {
  workflow_id: workflow.id,
  script_run_id: scriptRunId,
  error_type: error.type,
  error_message: error.message,
  fix_attempts: currentFixCount,
});
```

## Edge Case: Save Not Called

After maintenance AI completes, check what it did:

```typescript
const savedScript = checkIfSaveToolCalled();
const askedQuestion = checkIfAskToolCalled();

if (savedScript) {
  // Normal case: AI fixed it
  // maintenance_fixed event already created
  // Script will re-run

} else if (askedQuestion) {
  // FUTURE: AI needs user input to proceed
  // ask tool would create script_ask event
  // Keep maintenance mode active, wait for response
  // (Not yet implemented - currently this path escalates)

} else {
  // AI couldn't fix and didn't ask for help
  // Escalate to user
  await escalateToUser(workflow, error, fixCount);
}
```

## UI Representation

### During Fixing

- Workflow status shows "Fixing" (orange)
- No notification sent (AI is handling it)

### After Success

- Chat shows collapsed auto-fix summary box
- User can expand to see what changed
- Workflow status returns to "Active"

### After Escalation

- Notification sent: "Automation paused - needs your help"
- Workflow status shows "Error" (red)
- User must intervene via chat

## Key Files

- `packages/agent/src/workflow-worker.ts` - Lines ~500-700 contain maintenance logic
- `packages/agent/src/ai-tools/save.ts` - Clears maintenance mode on save
- `packages/agent/src/ai-tools/ask.ts` - Handles AI asking user questions

## Configuration

```typescript
// workflow-worker.ts
const MAX_FIX_ATTEMPTS = 3;  // Attempts before escalation
```

## Testing Maintenance Mode

1. Create a workflow with a script that has a deliberate bug
2. Trigger a run
3. Observe:
   - `maintenance_started` event created
   - Workflow status changes to "Fixing"
   - AI analyzes and attempts fix
   - If successful: `maintenance_fixed` event, re-run
   - If failed 3x: `maintenance_escalated` event, notification
