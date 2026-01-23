# Spec 09: Direct Chat-Workflow Linking

## Overview

Simplify the relationship between chats and workflows by adding direct links instead of navigating through tasks. Also clean up unused chat fields and the deprecated ChatSidebar component.

## Changes Summary

### Schema Changes

**Chats table:**
- **Remove:** `updated_at`, `read_at`, `first_message_content`, `first_message_time`
- **Add:** `workflow_id` (TEXT, indexed)

**Workflows table:**
- **Add:** `chat_id` (TEXT, indexed)

### Code Changes

- Remove `ChatSidebar` component (unused)
- Simplify workflow→chat navigation (direct instead of through task)
- Replace chat preview snippets with fetched oldest message
- Remove "last updated" displays

## Database Migration (v27)

```sql
-- Add workflow_id to chats
ALTER TABLE chats ADD COLUMN workflow_id TEXT NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS idx_chats_workflow_id ON chats(workflow_id);

-- Add chat_id to workflows
ALTER TABLE workflows ADD COLUMN chat_id TEXT NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS idx_workflows_chat_id ON workflows(chat_id);

-- Mark removed columns as deprecated (SQLite can't drop columns easily)
-- These columns remain but are no longer used:
-- chats.updated_at, chats.read_at, chats.first_message_content, chats.first_message_time
```

**File:** `packages/db/src/migrations/v27.ts`

## Files to Modify

### 1. Database Layer

#### `packages/db/src/migrations/v27.ts` (NEW)
Create migration to add new columns and indexes.

#### `packages/db/src/migrations/v1.ts`
Add deprecation comments to the removed fields:
```typescript
// DEPRECATED: updated_at, read_at, first_message_content, first_message_time
// These fields are no longer used. See Spec 09.
```

#### `packages/db/src/chat-store.ts`

**Modify `createChat()`:**
- Remove `first_message_content`, `first_message_time`, `updated_at`, `read_at` from INSERT
- Add `workflow_id` parameter
```typescript
async createChat(
  opts: {
    chatId: string;
    message: AssistantUIMessage;
    workflowId: string;  // NEW
  },
  tx?: DBInterface
): Promise<void>
```

**Modify `getAllChats()`:**
- Remove `first_message_content`, `first_message_time`, `updated_at`, `read_at` from SELECT
- Add `workflow_id` to SELECT

**Modify `getChat()`:**
- Same field changes as above

**Remove methods:**
- `updateChatTimestamps()` or similar if exists
- Any methods that update the deprecated fields

**Add new method:**
```typescript
async getChatByWorkflowId(workflowId: string): Promise<Chat | null>
```

**Add new method for preview:**
```typescript
async getChatFirstMessage(chatId: string): Promise<string | null> {
  // Query oldest chat_event of type 'message' for this chat
  const result = await this.db.db.execO<{ content: string }>(
    `SELECT content FROM chat_events
     WHERE chat_id = ? AND type = 'message'
     ORDER BY timestamp ASC LIMIT 1`,
    [chatId]
  );
  if (!result || result.length === 0) return null;
  // Parse content JSON and extract text
  const parsed = JSON.parse(result[0].content);
  // Extract text from message parts
  return extractTextFromMessage(parsed);
}
```

#### `packages/db/src/script-store.ts`

**Modify `addWorkflow()`:**
- Add `chat_id` to INSERT statement
- Update Workflow type to include `chat_id`

**Modify `getWorkflow()`, `listWorkflows()`, etc.:**
- Add `chat_id` to SELECT statements

**Add new method:**
```typescript
async getWorkflowByChatId(chatId: string): Promise<Workflow | null>
```

**Simplify `getAbandonedDrafts()` and `getDraftActivitySummary()`:**
- Change `LEFT JOIN chat_events ce ON ce.chat_id = w.task_id`
- To: `LEFT JOIN chat_events ce ON ce.chat_id = w.chat_id`

#### `packages/db/src/api.ts`

**Modify `createTask()`:**
```typescript
async createTask(opts: { content: string; files?: File[] }): Promise<{ chatId: string; taskId: string }> {
  return await this.db.db.tx(async (tx) => {
    const chatId = generateId();
    const taskId = generateId();
    const workflowId = generateId();

    // 1. Create chat with workflow_id
    await this.chatStore.createChat({
      chatId,
      message,
      workflowId,  // NEW: set at creation
    }, tx);

    // 2. Create task (unchanged)
    const task: Task = { id: taskId, chat_id: chatId, ... };
    await this.taskStore.addTask(task, tx);

    // 3. Create workflow with chat_id
    const workflow: Workflow = {
      id: workflowId,
      task_id: taskId,
      chat_id: chatId,  // NEW: set at creation
      ...
    };
    await this.scriptStore.addWorkflow(workflow, tx);

    return { chatId, taskId };
  });
}
```

### 2. Type Definitions

#### `packages/db/src/chat-store.ts` (Chat type)
```typescript
// Before
export type Chat = {
  id: string;
  created_at: string;
  updated_at: string;
  read_at: string | null;
  first_message_content: string;
  first_message_time: string;
};

// After
export type Chat = {
  id: string;
  created_at: string;
  workflow_id: string;
};
```

#### `packages/db/src/script-store.ts` (Workflow type)
```typescript
// Add to existing Workflow type
export type Workflow = {
  // ... existing fields
  chat_id: string;  // NEW
};
```

### 3. UI Components

#### `apps/web/src/components/ChatSidebar.tsx` - DELETE ENTIRELY
This component is unused. Remove the file completely.

#### `apps/web/src/components/WorkflowDetailPage.tsx`

**Remove:**
- `const { data: task } = useTask(workflow?.task_id || "");`
- `const { data: chat } = useChat(task?.chat_id || "");`
- "Last updated" display (Lines ~386-388)

**Replace with:**
```typescript
// Direct chat access via workflow.chat_id
const { data: chat } = useChat(workflow?.chat_id || "");
const { data: firstMessage } = useChatFirstMessage(workflow?.chat_id || "");
```

**Update navigation:**
```typescript
// Before
navigate(`/chats/${task.chat_id}`);

// After
navigate(`/chats/${workflow.chat_id}`);
```

**Update chat preview:**
```typescript
// Before
{chat.first_message && (
  <p className="text-sm text-gray-600 mb-2 line-clamp-2">
    {chat.first_message}
  </p>
)}

// After
{firstMessage && (
  <p className="text-sm text-gray-600 mb-2 line-clamp-2">
    {firstMessage}
  </p>
)}
```

#### `apps/web/src/components/TaskDetailPage.tsx`

**Remove:**
- `const { data: chat } = useChat(task?.chat_id || "");`
- "Last updated" display
- Chat preview section using `chat.first_message`

**Replace with:**
```typescript
const { data: workflow } = useWorkflowByTaskId(id!);
// Navigate to chat via workflow
navigate(`/chats/${workflow?.chat_id}`);
```

#### `apps/web/src/components/MainPage.tsx`

**Simplify workflow-to-chat navigation:**
```typescript
// Before
const task = taskMap[workflow.task_id];
// ... use task.chat_id

// After
// Direct: workflow.chat_id
```

### 4. React Hooks

#### `apps/web/src/hooks/dbChatReads.ts`

**Add new hook:**
```typescript
export function useChatFirstMessage(chatId: string) {
  const { api } = useDbQuery();
  return useQuery({
    queryKey: qk.chatFirstMessage(chatId),
    queryFn: async () => {
      if (!api || !chatId) return null;
      return api.chatStore.getChatFirstMessage(chatId);
    },
    meta: { tables: ["chat_events"] },
    enabled: !!api && !!chatId,
  });
}
```

**Add new hook:**
```typescript
export function useChatByWorkflowId(workflowId: string) {
  const { api } = useDbQuery();
  return useQuery({
    queryKey: qk.chatByWorkflowId(workflowId),
    queryFn: async () => {
      if (!api || !workflowId) return null;
      return api.chatStore.getChatByWorkflowId(workflowId);
    },
    meta: { tables: ["chats"] },
    enabled: !!api && !!workflowId,
  });
}
```

#### `apps/web/src/hooks/dbScriptReads.ts`

**Add new hook:**
```typescript
export function useWorkflowByChatId(chatId: string) {
  const { api } = useDbQuery();
  return useQuery({
    queryKey: qk.workflowByChatId(chatId),
    queryFn: async () => {
      if (!api || !chatId) return null;
      return api.scriptStore.getWorkflowByChatId(chatId);
    },
    meta: { tables: ["workflows"] },
    enabled: !!api && !!chatId,
  });
}
```

### 5. Agent Code

#### `packages/agent/src/workflow-worker.ts`

**Simplify chat access:**
```typescript
// Before
const task = await this.api.taskStore.getTask(workflow.task_id);
if (!task || !task.chat_id) { ... }
const chatId = task.chat_id;

// After
if (!workflow.chat_id) { ... }
const chatId = workflow.chat_id;
```

#### `packages/agent/src/ai-tools/save.ts`

**May already have workflow, can use workflow.chat_id directly if available.**

### 6. Query Keys

#### `apps/web/src/hooks/queryKeys.ts`

Add new query keys:
```typescript
chatFirstMessage: (chatId: string) => ["chatFirstMessage", chatId],
chatByWorkflowId: (workflowId: string) => ["chatByWorkflowId", workflowId],
workflowByChatId: (chatId: string) => ["workflowByChatId", chatId],
```

## Data Migration

For existing data, populate the new fields:

```sql
-- Populate workflow.chat_id from task.chat_id
UPDATE workflows
SET chat_id = (
  SELECT t.chat_id
  FROM tasks t
  WHERE t.id = workflows.task_id
)
WHERE chat_id = '';

-- Populate chats.workflow_id from workflows.chat_id
UPDATE chats
SET workflow_id = (
  SELECT w.id
  FROM workflows w
  WHERE w.chat_id = chats.id
)
WHERE workflow_id = '';
```

Include this in the v27 migration after adding columns.

## Implementation Checklist

### Database
- [ ] Create `v27.ts` migration with new columns, indexes, and data migration
- [ ] Add deprecation comments to `v1.ts` for removed fields
- [ ] Update `Chat` type in `chat-store.ts`
- [ ] Update `Workflow` type in `script-store.ts`
- [ ] Modify `createChat()` to accept and store `workflow_id`
- [ ] Modify `addWorkflow()` to store `chat_id`
- [ ] Add `getChatByWorkflowId()` method
- [ ] Add `getWorkflowByChatId()` method
- [ ] Add `getChatFirstMessage()` method
- [ ] Update all SELECT queries to use new fields
- [ ] Simplify `getAbandonedDrafts()` join condition

### API
- [ ] Update `createTask()` to set both `workflow_id` and `chat_id`

### UI
- [ ] Delete `ChatSidebar.tsx` component
- [ ] Update `WorkflowDetailPage.tsx` - direct chat access, remove last updated
- [ ] Update `TaskDetailPage.tsx` - remove chat section or use workflow.chat_id
- [ ] Update `MainPage.tsx` - simplify workflow-to-chat navigation

### Hooks
- [ ] Add `useChatFirstMessage()` hook
- [ ] Add `useChatByWorkflowId()` hook
- [ ] Add `useWorkflowByChatId()` hook
- [ ] Add query keys

### Agent
- [ ] Update `workflow-worker.ts` to use `workflow.chat_id` directly

### Cleanup
- [ ] Remove any imports of deleted `ChatSidebar`
- [ ] Remove unused `useChat` calls that went through task

## Testing

1. Fresh install: verify migration creates columns correctly
2. Existing data: verify data migration populates fields
3. Create new workflow: verify both `chat_id` and `workflow_id` are set
4. Navigate workflow → chat: verify direct link works
5. Navigate chat → workflow: verify reverse link works
6. Chat preview: verify first message is fetched correctly
7. No TypeScript errors
8. No console errors at runtime

## Notes

- SQLite cannot drop columns, so deprecated fields remain in schema but are unused
- The task.chat_id field remains for backwards compatibility and other uses
- No foreign keys added per requirements (just indexes)
- Both links set at creation time, never updated after
