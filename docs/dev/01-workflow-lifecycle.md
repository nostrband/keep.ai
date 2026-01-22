# Workflow Lifecycle

## Overview

A workflow represents a user's automation. It progresses through various states from creation to active execution, with the system handling errors automatically when possible.

## Core Entities

```
Workflow
    |
    +-- Task (planner task that created it)
    |     |
    |     +-- Chat (conversation for creating/editing)
    |
    +-- Script (generated code to execute)
          |
          +-- Script Runs (execution history)
```

## Workflow States

```
                 +----------+
                 |  Draft   |
                 +----+-----+
                      | script created
                      v
                 +----------+
                 |  Ready   |
                 +----+-----+
                      | activate
                      v
   +-----------  +----------+  -----------+
   |             |  Active  |
   |             +----+-----+
   |  pause           | error
   v                  v
+----------+    +-----+------+
|  Paused  |    |   Error    |
+----+-----+    +-----+------+
     |                |
     |                +--- (logic error) ---> +----------+
     |                |                       |  Fixing  |
     |                |                       +----+-----+
     |                |                            | fixed
     |                |                            v
     | resume         | user resolves        (back to Active)
     +----------------+
                      |
                      v
                +----------+
                |  Active  |
                +----------+
```

**Note on Error transitions:**
- **Logic errors** → AI enters Fixing mode automatically (see 04-auto-fix-mode.md)
- **User-facing errors** (auth/permission/network) → User must resolve, then retry

### State Definitions

| State | Condition | User Action Available |
|-------|-----------|----------------------|
| **Draft** | No script exists | Talk to AI |
| **Ready** | Has script, `status != 'active'` | Activate, Test, Talk to AI |
| **Active** | `status = 'active'`, no errors | Pause, Test, Talk to AI |
| **Paused** | `status = 'disabled'` | Resume, Talk to AI |
| **Error** | Has unresolved `type='error'` event | View error, Retry, Talk to AI |
| **Fixing** | `maintenance = true` | (wait for AI) |

### State Derivation Logic

```typescript
function getWorkflowStatus(workflow: Workflow, latestError: ChatEvent | null): Status {
  if (workflow.maintenance) return 'fixing';
  if (latestError && !latestError.acknowledged_at) return 'error';
  if (workflow.status === 'disabled') return 'paused';
  if (workflow.status === 'active') return 'active';
  if (hasScript(workflow)) return 'ready';
  return 'draft';
}
```

## Workflow Creation Flow

```
1. User submits message on home page
       |
       v
2. Create workflow record (status='draft')
       |
       v
3. Create task record (type='planner', links to workflow)
       |
       v
4. Create chat record (links to task)
       |
       v
5. Save user message to chat
       |
       v
6. AI responds, conversation continues
       |
       v
7. AI calls 'save' tool with generated script
       |
       v
8. Script record created
       |
       v
9. Workflow now in 'ready' state
```

## Activation and Scheduling

When user activates a workflow:

1. `workflow.status` set to `'active'`
2. `workflow.cron` contains schedule expression
3. Scheduler picks up and queues runs based on cron

## Script Execution Flow

```
1. Scheduler triggers or user clicks "Test Run"
       |
       v
2. Create script_run record (status='running')
       |
       v
3. Execute script in sandbox
       |
       +---> Success
       |         |
       |         v
       |     Update script_run (status='success')
       |
       +---> Failure
                 |
                 v
             Classify error (see 03-error-handling.md)
                 |
                 +---> User-facing error (auth/permission/network/internal)
                 |         |
                 |         v
                 |     Create type='error' event
                 |     User notified, workflow shows "Error" state
                 |
                 +---> Logic error
                           |
                           v
                       Enter maintenance mode (see 04-auto-fix-mode.md)
                       Workflow shows "Fixing" state
```

## Key Files

- `packages/agent/src/workflow-worker.ts` - Main execution logic
- `packages/db/src/script-store.ts` - Workflow/script persistence
- `packages/agent/src/ai-tools/save.ts` - Script saving tool
