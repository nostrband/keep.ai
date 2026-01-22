# Event System

## Overview

Events are records of significant occurrences within a workflow. They're stored in `chat_events` table and routed to the workflow's `chat_id`.

## Event Routing

All events route to the workflow's `chat_id`:

```typescript
await chatStore.saveChatEvent(
  generateId(),
  task.chat_id,    // Route to workflow's chat
  eventType,
  content
);
```

This enables:
- Per-workflow event queries
- Cross-workflow aggregation for notifications page
- Clear ownership of events

## Event Types

### Core Events

| Type | Source | Purpose | Shows In |
|------|--------|---------|----------|
| `message` | User/AI | Chat conversation | Chat page |
| `error` | System | User-facing errors | Notifications, Workflow error banner |
| `maintenance_started` | System | AI began auto-fix | (internal) |
| `maintenance_fixed` | System | AI successfully fixed | Chat (summary box) |
| `maintenance_escalated` | System | AI gave up | Notifications |
| `script_message` | Script | Script notifying user | Notifications |
| `script_ask` (future) | Script | Script requesting confirmation | Notifications |
| `add_script` | System | Script created/updated | (script history) |
| `task_run` | System | Task execution record | (internal) |

### Tool-Generated Events

Scripts running in sandbox can create events via `context.createEvent()`:
- `web-fetch`, `web-search`, `web-download`
- `gmail` operations
- `images-generate`, `text-generate`
- `save-file`, `read-file`
- And many others...

These route to the workflow's chat_id but are NOT shown in notifications (too noisy). They remain for debugging.

## Event Payloads

### error

```typescript
{
  error_type: 'auth' | 'permission' | 'network' | 'internal',
  message: string,
  script_run_id: string,
  workflow_id: string,
  script_id: string,
}
```

### maintenance_started

```typescript
{
  workflow_id: string,
  script_run_id: string,
  error_type: string,
  error_message: string,
}
```

### maintenance_fixed

```typescript
{
  script_id: string,
  change_comment: string,  // Summary of what was fixed
  workflow_id: string,
}
```

### maintenance_escalated

```typescript
{
  workflow_id: string,
  script_run_id: string,
  error_type: string,
  error_message: string,
  fix_attempts: number,  // How many times AI tried
}
```

### script_message

```typescript
{
  message: string,
  workflow_id: string,
}
```

### script_ask (future)

```typescript
{
  question: string,
  options?: string[],
  workflow_id: string,
}
```

## Event Visibility Matrix

| Event Type | Notifications Page | Chat Page | Workflow Page |
|------------|-------------------|-----------|---------------|
| `error` | Yes | - | Error banner |
| `maintenance_escalated` | Yes | - | - |
| `script_message` | Yes | - | - |
| `script_ask` (future) | Yes | - | - |
| `maintenance_fixed` | - | Summary box | - |
| `maintenance_started` | - | - | - |
| `add_script` | - | - | - |
| `message` | - | Conversation | - |
| Tool events | - | - | - |

## Querying Events

### All Notifications (across workflows)

```sql
SELECT * FROM chat_events
WHERE type IN ('error', 'maintenance_escalated', 'script_message', 'script_ask')
ORDER BY timestamp DESC
LIMIT ?
```

### Workflow Notifications

```sql
SELECT * FROM chat_events
WHERE chat_id = ?
  AND type IN ('error', 'maintenance_escalated', 'script_message', 'script_ask')
ORDER BY timestamp DESC
LIMIT ?
```

### Latest Error for Workflow

```sql
SELECT * FROM chat_events
WHERE chat_id = ?
  AND type = 'error'
  AND acknowledged_at IS NULL
ORDER BY timestamp DESC
LIMIT 1
```

### Auto-fix Summaries for Chat

```sql
SELECT * FROM chat_events
WHERE chat_id = ?
  AND type = 'maintenance_fixed'
ORDER BY timestamp DESC
```

## Key Files

- `packages/db/src/chat-store.ts` - Event persistence and queries
- `packages/agent/src/workflow-worker.ts` - Event creation
- `packages/agent/src/ai-tools/save.ts` - maintenance_fixed events
- `packages/agent/src/tools/user-send.ts` - script_message events
