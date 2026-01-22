# Spec 12: Split chat_events into Purpose-Specific Tables

## Overview

Replace the monolithic `chat_events` table with three purpose-specific tables:
1. `chat_messages` - User-visible conversation
2. `notifications` - Actionable items during workflow running
3. `execution_logs` - Tool calls and debugging data

## Rationale

The current `chat_events` table mixes:
- Conversation messages (user/assistant)
- Maintenance events (started/fixed/escalated)
- Script save events
- Task run markers
- 20+ tool call events

This creates a cluttered chat feed and complex querying. The new structure:
- Chat shows clean conversation with rich links to related data
- Notifications are separate (running stage, not building stage)
- Execution details accessed via drill-down, not inline

## New Tables

### 1. chat_messages

Stores user-visible conversation with optional metadata links.

```sql
CREATE TABLE chat_messages (
  id TEXT PRIMARY KEY NOT NULL,
  chat_id TEXT NOT NULL,
  role TEXT NOT NULL,                    -- 'user', 'assistant'
  content TEXT NOT NULL,                 -- Message text/parts as JSON
  timestamp TEXT NOT NULL,

  -- Optional links (typically assistant messages only)
  task_run_id TEXT NOT NULL DEFAULT '',  -- Link to execution logs ("ℹ️" icon)
  script_id TEXT NOT NULL DEFAULT '',    -- Script saved by this message (summary box)
  failed_script_run_id TEXT NOT NULL DEFAULT ''  -- If maintenance: what broke
);

CREATE INDEX idx_chat_messages_chat_id ON chat_messages(chat_id);
CREATE INDEX idx_chat_messages_timestamp ON chat_messages(timestamp);

SELECT crsql_as_crr('chat_messages');
```

**UI Rendering:**
- `script_id` present → Show script summary box at bottom of message
- `task_run_id` present → Show "ℹ️" icon linking to execution detail
- `failed_script_run_id` present → Visual indicator this was auto-fix response

### 2. notifications

Actionable items requiring user attention during workflow running.

```sql
CREATE TABLE notifications (
  id TEXT PRIMARY KEY NOT NULL,
  workflow_id TEXT NOT NULL,
  type TEXT NOT NULL,                    -- 'error', 'escalated', 'script_message', 'script_ask'
  payload TEXT NOT NULL DEFAULT '',      -- JSON with type-specific data
  timestamp TEXT NOT NULL,
  acknowledged_at TEXT NOT NULL DEFAULT '',
  resolved_at TEXT NOT NULL DEFAULT '',

  -- Denormalized for efficient list queries
  workflow_title TEXT NOT NULL DEFAULT ''
);

CREATE INDEX idx_notifications_workflow_id ON notifications(workflow_id);
CREATE INDEX idx_notifications_timestamp ON notifications(timestamp);
CREATE INDEX idx_notifications_type ON notifications(type);

SELECT crsql_as_crr('notifications');
```

**Notification Types:**

| Type | When Created | Payload |
|------|--------------|---------|
| `error` | Auth/permission/network error during run | `{error_type, message, script_run_id}` |
| `escalated` | Auto-fix failed after 3 attempts | `{script_run_id, attempts}` |
| `script_message` | Script calls `user.send()` tool | `{message, script_run_id}` |
| `script_ask` | Script calls `user.ask()` tool (v2) | `{question, options, script_run_id}` |

**Navigation:** Notification action button leads to workflow's chat (`workflow_id` → `workflow.chat_id`).

### 3. execution_logs

Tool calls and operational data for debugging.

```sql
CREATE TABLE execution_logs (
  id TEXT PRIMARY KEY NOT NULL,
  run_id TEXT NOT NULL,                  -- script_run_id or task_run_id
  run_type TEXT NOT NULL,                -- 'script' or 'task'
  event_type TEXT NOT NULL,              -- 'tool_call', 'run_start', 'run_end', 'error'
  tool_name TEXT NOT NULL DEFAULT '',    -- For tool_call events
  input TEXT NOT NULL DEFAULT '',        -- Tool input (JSON)
  output TEXT NOT NULL DEFAULT '',       -- Tool output (JSON)
  error TEXT NOT NULL DEFAULT '',        -- Error message if failed
  timestamp TEXT NOT NULL,
  cost INTEGER NOT NULL DEFAULT 0        -- Microdollars for this operation
);

CREATE INDEX idx_execution_logs_run_id ON execution_logs(run_id);
CREATE INDEX idx_execution_logs_timestamp ON execution_logs(timestamp);
CREATE INDEX idx_execution_logs_run_type ON execution_logs(run_type);

SELECT crsql_as_crr('execution_logs');
```

**Event Types:**
- `run_start` - Task/script execution began
- `run_end` - Task/script execution completed
- `tool_call` - Individual tool invocation
- `error` - Error during execution

## Migration Path

### Database Migration (v30)

```sql
-- 1. Create new tables
CREATE TABLE chat_messages (...);
CREATE TABLE notifications (...);
CREATE TABLE execution_logs (...);

-- 2. Migrate messages from chat_events
INSERT INTO chat_messages (id, chat_id, role, content, timestamp)
SELECT
  id,
  chat_id,
  json_extract(content, '$.role') as role,
  content,
  timestamp
FROM chat_events
WHERE type = 'message';

-- 3. Migrate tool events to execution_logs
INSERT INTO execution_logs (id, run_id, run_type, event_type, tool_name, input, output, timestamp, cost)
SELECT
  id,
  json_extract(content, '$.task_run_id') as run_id,
  'task' as run_type,
  'tool_call' as event_type,
  type as tool_name,
  json_extract(content, '$.input') as input,
  json_extract(content, '$.output') as output,
  timestamp,
  COALESCE(json_extract(content, '$.usage.cost'), 0) as cost
FROM chat_events
WHERE type NOT IN ('message', 'task_run', 'task_run_end', 'add_script',
                   'maintenance_started', 'maintenance_fixed', 'maintenance_escalated');

-- 4. Migrate task_run markers to execution_logs
INSERT INTO execution_logs (id, run_id, run_type, event_type, timestamp)
SELECT
  id,
  json_extract(content, '$.task_run_id') as run_id,
  'task' as run_type,
  CASE type
    WHEN 'task_run' THEN 'run_start'
    WHEN 'task_run_end' THEN 'run_end'
  END as event_type,
  timestamp
FROM chat_events
WHERE type IN ('task_run', 'task_run_end');

-- 5. Mark chat_events as deprecated (keep data for history)
-- Add comment in migration file
```

**Note:** `add_script` and `maintenance_*` events don't need migration - their information is now captured via links on chat_messages (script_id, failed_script_run_id).

### Code Migration

#### Phase 1: Add new stores alongside old

Create new store methods that write to new tables while keeping old writes:

```typescript
// chat-store.ts
async saveChatMessage(message: ChatMessage): Promise<void>
async getChatMessages(chatId: string, opts?: {limit?, before?}): Promise<ChatMessage[]>

// notification-store.ts (NEW)
async saveNotification(notification: Notification): Promise<void>
async getNotifications(opts?: {workflowId?, limit?}): Promise<Notification[]>
async acknowledgeNotification(id: string): Promise<void>
async resolveNotification(id: string): Promise<void>

// execution-log-store.ts (NEW)
async saveExecutionLog(log: ExecutionLog): Promise<void>
async getExecutionLogs(runId: string, runType: 'script' | 'task'): Promise<ExecutionLog[]>
```

#### Phase 2: Update write paths

**Task Worker (`task-worker.ts`):**
```typescript
// Before: saveChatEvent(chatId, 'message', content)
// After:
await chatStore.saveChatMessage({
  id: generateId(),
  chat_id: chatId,
  role: 'assistant',
  content: messageContent,
  timestamp: new Date().toISOString(),
  task_run_id: taskRunId,
  script_id: savedScriptId || '',
  failed_script_run_id: '',
});
```

**Workflow Worker (`workflow-worker.ts`):**
```typescript
// For maintenance responses:
await chatStore.saveChatMessage({
  ...
  failed_script_run_id: failedScriptRunId,  // Links to what broke
  script_id: fixedScriptId,                  // Links to the fix
});

// For escalation notification:
await notificationStore.saveNotification({
  id: generateId(),
  workflow_id: workflow.id,
  type: 'escalated',
  payload: JSON.stringify({ script_run_id: scriptRunId, attempts: 3 }),
  timestamp: new Date().toISOString(),
  workflow_title: workflow.title,
});
```

**Sandbox Tools:**
```typescript
// Before: context.createEvent('web_search', {...})
// After:
await executionLogStore.saveExecutionLog({
  id: generateId(),
  run_id: scriptRunId,
  run_type: 'script',
  event_type: 'tool_call',
  tool_name: 'web_search',
  input: JSON.stringify(input),
  output: JSON.stringify(output),
  timestamp: new Date().toISOString(),
  cost: usage?.cost || 0,
});
```

**Save Tool (`save.ts`):**
```typescript
// After saving script, the chat message gets script_id:
// This happens in task-worker when it saves the assistant message
// The task_run result includes script_id for the message metadata
```

#### Phase 3: Update read paths

**Chat Page:**
```typescript
// Before: useChatEvents() with complex grouping
// After: useChatMessages() - clean message list

function useChatMessages(chatId: string) {
  return useQuery({
    queryKey: ['chatMessages', chatId],
    queryFn: () => api.chatStore.getChatMessages(chatId),
    meta: { tables: ['chat_messages'] },
  });
}
```

**Message Component:**
```typescript
// Render message with optional metadata:
<Message content={msg.content} role={msg.role}>
  {msg.script_id && <ScriptSummaryBox scriptId={msg.script_id} />}
  {msg.task_run_id && <ExecutionInfoIcon taskRunId={msg.task_run_id} />}
  {msg.failed_script_run_id && <MaintenanceBadge />}
</Message>
```

**Notifications Page:**
```typescript
function useNotifications(workflowId?: string) {
  return useQuery({
    queryKey: ['notifications', workflowId],
    queryFn: () => api.notificationStore.getNotifications({ workflowId }),
    meta: { tables: ['notifications'] },
  });
}
```

**Execution Detail View:**
```typescript
function useExecutionLogs(runId: string, runType: 'script' | 'task') {
  return useQuery({
    queryKey: ['executionLogs', runId, runType],
    queryFn: () => api.executionLogStore.getExecutionLogs(runId, runType),
    meta: { tables: ['execution_logs'] },
  });
}
```

#### Phase 4: Remove old code

- Remove `saveChatEvent()` calls
- Remove `getChatEvents()` method
- Remove `useChatEvents()` hook
- Remove `useChatRows()` grouping logic
- Remove event type configs (`EVENT_CONFIGS`)
- Remove `EventItem.tsx` component
- Deprecate `chat_events` table in migration comments

## Files to Modify

### New Files
- `packages/db/src/notification-store.ts`
- `packages/db/src/execution-log-store.ts`
- `packages/db/src/migrations/v30.ts`

### Database Layer
- `packages/db/src/chat-store.ts` - Add `saveChatMessage()`, `getChatMessages()`, remove event methods
- `packages/db/src/api.ts` - Expose new stores
- `packages/db/src/index.ts` - Export new types

### Agent Layer
- `packages/agent/src/task-worker.ts` - Write to `chat_messages` with metadata
- `packages/agent/src/workflow-worker.ts` - Write maintenance messages and notifications
- `packages/agent/src/ai-tools/save.ts` - Return script_id for message metadata
- `packages/agent/src/sandbox/api.ts` - Write to `execution_logs` instead of events

### UI Layer
- `apps/web/src/hooks/dbChatReads.ts` - Replace with `useChatMessages()`
- `apps/web/src/hooks/useChatRows.ts` - DELETE (no longer needed)
- `apps/web/src/components/ChatPage.tsx` - Simplify to render messages
- `apps/web/src/components/EventItem.tsx` - DELETE
- `apps/web/src/types/events.ts` - DELETE (EVENT_CONFIGS)
- `apps/web/src/components/NotificationsPage.tsx` - Use new `notifications` table
- NEW: `apps/web/src/components/MessageItem.tsx` - Render message with metadata
- NEW: `apps/web/src/components/ScriptSummaryBox.tsx` - Inline script summary
- NEW: `apps/web/src/components/ExecutionDetailModal.tsx` - Show execution logs

## Implementation Checklist

### Database
- [ ] Create `v30.ts` migration with new tables
- [ ] Migrate existing messages to `chat_messages`
- [ ] Migrate tool events to `execution_logs`
- [ ] Add deprecation comment to `chat_events` in v9.ts
- [ ] Create `notification-store.ts`
- [ ] Create `execution-log-store.ts`
- [ ] Add `ChatMessage` type to `chat-store.ts`
- [ ] Add `saveChatMessage()` method
- [ ] Add `getChatMessages()` method

### Agent
- [ ] Update `task-worker.ts` to save messages with task_run_id, script_id
- [ ] Update `workflow-worker.ts` to save maintenance messages with failed_script_run_id
- [ ] Update `workflow-worker.ts` to create notifications on escalation
- [ ] Update `workflow-worker.ts` to create notifications on user-attention errors
- [ ] Update sandbox to write to `execution_logs`
- [ ] Update `save.ts` to return script_id for message metadata

### UI
- [ ] Create `useChatMessages()` hook
- [ ] Create `useNotifications()` hook
- [ ] Create `useExecutionLogs()` hook
- [ ] Create `MessageItem.tsx` component
- [ ] Create `ScriptSummaryBox.tsx` component
- [ ] Update `ChatPage.tsx` to use new message rendering
- [ ] Update `NotificationsPage.tsx` to use new table
- [ ] Create execution detail view/modal
- [ ] Delete `useChatRows.ts`
- [ ] Delete `EventItem.tsx`
- [ ] Delete `events.ts` (EVENT_CONFIGS)

### Cleanup
- [ ] Remove `saveChatEvent()` method
- [ ] Remove `getChatEvents()` method
- [ ] Remove `useChatEvents()` hook
- [ ] Search for remaining `chat_events` references

## Testing

1. Fresh install: new tables created correctly
2. Migration: existing messages appear in new `chat_messages` table
3. Migration: tool events appear in `execution_logs`
4. New message: saved to `chat_messages` with correct metadata
5. Script save: message has `script_id`, shows summary box
6. Maintenance fix: message has `failed_script_run_id` and `script_id`
7. Error during run: notification created with correct type
8. Escalation: notification created, last auto-fix message in chat
9. Notification action: navigates to workflow's chat
10. Execution logs: accessible via task_run detail
11. Chat feed: clean conversation without tool clutter
12. No TypeScript errors
13. No console errors at runtime

## Notes

- `chat_events` table kept for historical data, no new writes
- `ask` tool structured questions deferred to v2
- Notifications use `workflow_id` for navigation (→ `workflow.chat_id`)
- Script summary fetched via `script_id` link, not denormalized
- Execution logs accessed via drill-down, not shown in chat feed
