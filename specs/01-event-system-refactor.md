# Spec 01: Event System Refactor

## Overview

Update the agent/worker code to write to the new purpose-specific tables (`chat_messages`, `notifications`, `execution_logs`) instead of the deprecated `chat_events` table. This spec implements the write-side changes defined in Spec 12.

## Summary of Changes

| Old Pattern | New Pattern |
|-------------|-------------|
| `saveChatEvent(chatId, 'message', content)` | `saveChatMessage({chat_id, role, content, ...})` |
| `saveChatEvent(chatId, 'error', {...})` | `saveNotification({workflow_id, type: 'error', ...})` |
| `saveChatEvent(chatId, 'maintenance_escalated', {...})` | `saveNotification({workflow_id, type: 'escalated', ...})` |
| `saveChatEvent(chatId, 'maintenance_fixed', {...})` | Message with `script_id` + `failed_script_run_id` |
| `saveChatEvent(chatId, 'add_script', {...})` | Message with `script_id` |
| `context.createEvent(toolName, {...})` | `saveExecutionLog({run_id, tool_name, ...})` |

## Changes Required

### 1. Update workflow-worker.ts

**File:** `packages/agent/src/workflow-worker.ts`

#### A. Tool Event Creation → Execution Logs

```typescript
// FROM (in createSandbox):
await this.api.chatStore.saveChatEvent(generateId(), "main", type, content, tx);

// TO:
await this.api.executionLogStore.saveExecutionLog({
  id: generateId(),
  run_id: scriptRunId,
  run_type: 'script',
  event_type: 'tool_call',
  tool_name: type,
  input: JSON.stringify(content.input || {}),
  output: JSON.stringify(content.output || {}),
  error: content.error || '',
  timestamp: new Date().toISOString(),
  cost: content.usage?.cost || 0,
}, tx);
```

#### B. Error Events → Notifications

When a script run fails with a user-facing error:

```typescript
// FROM:
await this.api.chatStore.saveChatEvent(generateId(), task.chat_id, "error", {
  error_type, message, script_run_id, workflow_id, script_id
});

// TO:
await this.api.notificationStore.saveNotification({
  id: generateId(),
  workflow_id: workflow.id,
  type: 'error',
  payload: JSON.stringify({
    error_type: classifiedError.type,
    message: classifiedError.message,
    script_run_id: scriptRunId,
    script_id: script.id,
  }),
  timestamp: new Date().toISOString(),
  workflow_title: workflow.title,
});
```

#### C. Maintenance Escalation → Notification

```typescript
// FROM:
await this.api.chatStore.saveChatEvent(generateId(), task.chat_id, "maintenance_escalated", {...});

// TO:
await this.api.notificationStore.saveNotification({
  id: generateId(),
  workflow_id: workflow.id,
  type: 'escalated',
  payload: JSON.stringify({
    script_run_id: scriptRunId,
    error_message: error.message,
    fix_attempts: currentFixCount,
  }),
  timestamp: new Date().toISOString(),
  workflow_title: workflow.title,
});
```

#### D. Maintenance Started → No separate event

Previously created `maintenance_started` event. Now this is just internal state change (workflow.maintenance = true). No event needed.

### 2. Update task-worker.ts

**File:** `packages/agent/src/task-worker.ts`

#### A. Assistant Messages → Chat Messages with Metadata

```typescript
// FROM:
await this.api.chatStore.saveChatMessages(task.chat_id, [assistantMessage]);

// TO:
await this.api.chatStore.saveChatMessage({
  id: generateId(),
  chat_id: task.chat_id,
  role: 'assistant',
  content: JSON.stringify(assistantMessage),
  timestamp: new Date().toISOString(),
  task_run_id: taskRunId,
  script_id: result.savedScriptId || '',  // Set if save tool was called
  failed_script_run_id: '',  // Set by workflow-worker for maintenance responses
});
```

#### B. Task Run Events → Execution Logs

```typescript
// FROM:
await this.api.chatStore.saveChatEvent(generateId(), task.chat_id, "task_run", {...});
await this.api.chatStore.saveChatEvent(generateId(), task.chat_id, "task_run_end", {...});

// TO:
await this.api.executionLogStore.saveExecutionLog({
  id: generateId(),
  run_id: taskRunId,
  run_type: 'task',
  event_type: 'run_start',
  timestamp: new Date().toISOString(),
});

// ... at end:
await this.api.executionLogStore.saveExecutionLog({
  id: generateId(),
  run_id: taskRunId,
  run_type: 'task',
  event_type: 'run_end',
  timestamp: new Date().toISOString(),
});
```

### 3. Update ai-tools/save.ts

**File:** `packages/agent/src/ai-tools/save.ts`

The save tool no longer creates separate events. Instead, it returns `script_id` which the task-worker includes in the chat message metadata.

```typescript
// FROM:
await opts.chatStore.saveChatEvent(generateId(), opts.chatId, "add_script", {
  task_id: opts.taskId,
  script_id: newScript.id,
  version,
});

if (wasInMaintenance) {
  await opts.chatStore.saveChatEvent(generateId(), opts.chatId, "maintenance_fixed", {
    script_id: newScript.id,
    change_comment: info.comments,
    workflow_id: workflow.id,
  });
}

// TO:
// Return script_id for task-worker to include in message metadata
return {
  success: true,
  script_id: newScript.id,
  was_maintenance_fix: wasInMaintenance,
};
```

The task-worker then sets:
- `script_id` on the assistant message (for script summary box)
- `failed_script_run_id` if this was a maintenance fix (passed from workflow-worker)

### 4. Update user-send tool

**File:** `packages/agent/src/tools/user-send.ts`

Script messages become notifications:

```typescript
// FROM:
await api.chatStore.saveChatMessages(task.chat_id, [message]);

// TO:
await api.notificationStore.saveNotification({
  id: generateId(),
  workflow_id: workflow.id,
  type: 'script_message',
  payload: JSON.stringify({
    message: messageContent,
    script_run_id: scriptRunId,
  }),
  timestamp: new Date().toISOString(),
  workflow_title: workflow.title,
});
```

### 5. Remove list-events tool

**File:** `packages/agent/src/tools/list-events.ts`

**Action:** Remove this tool from agent-env. It read from "main" chat which no longer exists and isn't relevant to the new data model.

## New Store Methods Required

### notification-store.ts (NEW)

```typescript
export interface Notification {
  id: string;
  workflow_id: string;
  type: string;  // 'error', 'escalated', 'script_message', 'script_ask'
  payload: string;
  timestamp: string;
  acknowledged_at: string;
  resolved_at: string;
  workflow_title: string;
}

async saveNotification(notification: Notification): Promise<void>
async getNotifications(opts?: { workflowId?: string, limit?: number }): Promise<Notification[]>
async acknowledgeNotification(id: string): Promise<void>
async resolveNotification(id: string): Promise<void>
async getUnresolvedError(workflowId: string): Promise<Notification | null>
```

### execution-log-store.ts (NEW)

```typescript
export interface ExecutionLog {
  id: string;
  run_id: string;
  run_type: string;  // 'script', 'task'
  event_type: string;  // 'run_start', 'run_end', 'tool_call', 'error'
  tool_name: string;
  input: string;
  output: string;
  error: string;
  timestamp: string;
  cost: number;
}

async saveExecutionLog(log: ExecutionLog): Promise<void>
async getExecutionLogs(runId: string, runType: string): Promise<ExecutionLog[]>
```

### chat-store.ts (Updated)

```typescript
export interface ChatMessage {
  id: string;
  chat_id: string;
  role: string;  // 'user', 'assistant'
  content: string;
  timestamp: string;
  task_run_id: string;
  script_id: string;
  failed_script_run_id: string;
}

async saveChatMessage(message: ChatMessage): Promise<void>
async getChatMessages(chatId: string, opts?: { limit?: number, before?: string }): Promise<ChatMessage[]>
```

## Testing

1. Create workflow, verify messages go to `chat_messages` table
2. Trigger auth error, verify notification created in `notifications` table
3. Trigger logic error + auto-fix, verify:
   - No separate maintenance events
   - Assistant message has `script_id` and `failed_script_run_id`
4. Run script with tool calls, verify `execution_logs` populated
5. Use `user-send` in script, verify `script_message` notification created
6. Verify `chat_events` table no longer receives writes

## Dependencies

- Spec 12 (chat_events split) - defines the new tables
- Spec 09 (chats-workflows direct link) - for workflow.chat_id

## Blocked By

- Spec 12 (tables must exist first)

## Blocks

- Spec 03 (Notifications Page) - reads from notifications table
- Spec 04 (Workflow Hub) - reads notifications for error banner
- Spec 05 (Chat Page) - reads chat_messages with metadata
