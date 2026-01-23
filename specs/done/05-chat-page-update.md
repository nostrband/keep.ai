# Spec 05: Chat Page Update

## Overview

Update the chat page (`/chats/{id}`) to include:
1. A tappable workflow info box below the header
2. Auto-fix summary boxes when AI automatically repairs the script

The chat serves as the **workflow edit history** - showing user/AI conversations that modify the workflow, plus summaries of any automatic fixes.

## Current State

The chat page has:
- Header: Back button, "Chat" title, menu
- Conversation messages
- Input box at bottom

No clear indication of which workflow this chat belongs to.

## Target State

```
┌──────────────────────────────────────────────────────┐
│ ← Back                         Chat        🔔   [≡]  │
├──────────────────────────────────────────────────────┤
│ ┌──────────────────────────────────────────────────┐ │
│ │ 📋 Check Gmail for newsletters                   │ │
│ │    Active · Every day at 9:00 AM                 │ │
│ └──────────────────────────────────────────────────┘ │
│         ↑ Tappable - navigates to workflow hub       │
├──────────────────────────────────────────────────────┤
│                                                      │
│  [Conversation messages + auto-fix summaries...]    │
│                                                      │
│  ┌─────────────────────────────────────────┐        │
│  │ User: Can you check my gmail inbox...   │        │
│  └─────────────────────────────────────────┘        │
│                                                      │
│  ┌─────────────────────────────────────────┐        │
│  │ AI: I'll help you set up an automation  │        │
│  │ to check your Gmail inbox...            │        │
│  └─────────────────────────────────────────┘        │
│                                                      │
│  ┌─────────────────────────────────────────┐        │
│  │ 🔧 Auto-fix applied                  [▼]│        │
│  │    Fixed date parsing error             │        │
│  └─────────────────────────────────────────┘        │
│                                                      │
├──────────────────────────────────────────────────────┤
│  ┌────────────────────────────────────────────────┐ │
│  │ How can I help?                       [+] [→] │ │
│  └────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────┘
```

## Workflow Info Box

### Design

```
┌──────────────────────────────────────────────────────┐
│ 📋 {workflow_title}                                  │
│    {status} · {schedule}                             │
└──────────────────────────────────────────────────────┘
```

### Visual Styling

- Light background (slightly different from page background)
- Rounded corners
- Subtle shadow or border
- Hover state indicating it's clickable
- Cursor: pointer

### Content

| Field | Source | Fallback |
|-------|--------|----------|
| Icon | 📋 (or workflow-specific if available) | 📋 |
| Title | `workflow.title` | Truncated workflow ID |
| Status | Derived from workflow state | "Draft" |
| Schedule | `workflow.cron` parsed to human-readable | "Not scheduled" |

### Status Colors (from Spec 11)

| Status | Badge Color |
|--------|-------------|
| `draft` | Gray |
| `ready` | Blue |
| `active` | Green |
| `paused` | Yellow |
| `error` | Red |
| Fixing (`maintenance=true`) | Orange |

### Tap Behavior

Click/tap → Navigate to `/workflows/{workflowId}`

## Message Metadata Rendering

Messages now have optional metadata links (from Spec 12) that affect rendering:

### Message Fields

```typescript
interface ChatMessage {
  id: string;
  chat_id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  task_run_id: string;      // Link to execution logs
  script_id: string;        // Script saved by this message
  failed_script_run_id: string;  // If this was an auto-fix response
}
```

### Rendering Rules

1. **`script_id` present** → Show Script Summary Box at bottom of message
2. **`task_run_id` present** → Show "ℹ️" icon linking to execution detail
3. **`failed_script_run_id` present** → Show "🔧 Auto-fix" badge on message

### Script Summary Box

When assistant message has `script_id`:

```
┌─────────────────────────────────────────┐
│ I've updated the script to fix the      │
│ date parsing issue...                   │
│                                         │
│ ┌─────────────────────────────────────┐ │
│ │ 📜 Script v3                        │ │
│ │    Fetches weather and sends email  │ │
│ └─────────────────────────────────────┘ │
│                                    [ℹ️] │
└─────────────────────────────────────────┘
```

### Auto-fix Badge

When assistant message has `failed_script_run_id`:

```
┌─────────────────────────────────────────┐
│ 🔧 Auto-fix                             │
│ I noticed the script was failing due    │
│ to an API change. I've updated...       │
│                                         │
│ ┌─────────────────────────────────────┐ │
│ │ 📜 Script v4                        │ │
│ │    Updated API endpoint handling    │ │
│ └─────────────────────────────────────┘ │
│                                    [ℹ️] │
└─────────────────────────────────────────┘
```

### Implementation

```typescript
function MessageItem({ message }: { message: ChatMessage }) {
  const { data: script } = useScript(message.script_id);

  return (
    <div className={cn(
      "message",
      message.failed_script_run_id && "border-l-4 border-orange-400"
    )}>
      {message.failed_script_run_id && (
        <div className="text-orange-600 text-sm font-medium mb-1">
          🔧 Auto-fix
        </div>
      )}

      <MessageContent content={message.content} role={message.role} />

      {message.script_id && script && (
        <ScriptSummaryBox script={script} />
      )}

      {message.task_run_id && (
        <ExecutionInfoIcon taskRunId={message.task_run_id} />
      )}
    </div>
  );
}
```

## Back Button Behavior

The back button should intelligently navigate:

1. **If came from workflow page:** Go back to workflow (`/workflows/{id}`)
2. **If came from elsewhere:** Go to workflow page (not browser back)

Implementation:
```typescript
const handleBack = () => {
  // Always go to workflow hub, not browser history
  navigate(`/workflows/${workflowId}`);
};
```

## Data Requirements

### Get Workflow from Chat ID

With Spec 09, chats now have a direct `workflow_id` field:

```sql
SELECT * FROM workflows WHERE id = (SELECT workflow_id FROM chats WHERE id = ?)
```

Or use the reverse: workflows now have `chat_id`:

```sql
SELECT * FROM workflows WHERE chat_id = ?
```

### Hook: useWorkflowForChat

```typescript
function useWorkflowForChat(chatId: string) {
  const { api } = useDbQuery();

  return useQuery({
    queryKey: ['workflow-for-chat', chatId],
    queryFn: async () => {
      if (!api) return null;
      // Direct lookup via workflow.chat_id (from Spec 09)
      return api.scriptStore.getWorkflowByChatId(chatId);
    },
    meta: { tables: ['workflows'] },
  });
}
```

### Query Method

**File:** `packages/db/src/script-store.ts`

```typescript
async getWorkflowByChatId(chatId: string): Promise<Workflow | null> {
  const results = await this.db.db.execO<Workflow>(
    `SELECT * FROM workflows WHERE chat_id = ? LIMIT 1`,
    [chatId]
  );
  return results[0] || null;
}
```

### Get Chat Messages

Uses new `chat_messages` table (from Spec 12):

```typescript
function useChatMessages(chatId: string) {
  const { api } = useDbQuery();

  return useQuery({
    queryKey: ['chatMessages', chatId],
    queryFn: async () => {
      if (!api) return [];
      return api.chatStore.getChatMessages(chatId);
    },
    meta: { tables: ['chat_messages'] },
  });
}
```

## Implementation

### 1. Create WorkflowInfoBox Component

**File:** `apps/web/src/components/WorkflowInfoBox.tsx`

```tsx
interface WorkflowInfoBoxProps {
  workflow: Workflow;
  onClick?: () => void;
}

export function WorkflowInfoBox({ workflow, onClick }: WorkflowInfoBoxProps) {
  const status = getWorkflowStatus(workflow);
  const schedule = formatCronSchedule(workflow.cron);

  return (
    <button
      onClick={onClick}
      className="w-full p-3 bg-muted rounded-lg hover:bg-muted/80 transition-colors text-left"
    >
      <div className="flex items-center gap-2">
        <span>📋</span>
        <span className="font-medium truncate">
          {workflow.title || `Workflow ${workflow.id.slice(0, 8)}`}
        </span>
      </div>
      <div className="flex items-center gap-2 text-sm text-muted-foreground mt-1">
        <StatusBadge status={status} size="sm" />
        <span>·</span>
        <span>{schedule}</span>
      </div>
    </button>
  );
}
```

### 2. Update ChatPage Component

**File:** `apps/web/src/pages/ChatPage.tsx`

```tsx
export function ChatPage() {
  const { chatId } = useParams();
  const navigate = useNavigate();
  const { data: workflow } = useWorkflowForChat(chatId!);
  const { data: messages } = useChatMessages(chatId!);

  const handleWorkflowClick = () => {
    if (workflow) {
      navigate(`/workflows/${workflow.id}`);
    }
  };

  return (
    <div className="flex flex-col h-full">
      <Header
        title="Chat"
        onBack={() => workflow && navigate(`/workflows/${workflow.id}`)}
      />

      {workflow && (
        <div className="px-4 py-2 border-b">
          <WorkflowInfoBox
            workflow={workflow}
            onClick={handleWorkflowClick}
          />
        </div>
      )}

      <div className="flex-1 overflow-auto p-4">
        {messages?.map(message => (
          <MessageItem key={message.id} message={message} />
        ))}
      </div>

      <ChatInput chatId={chatId!} />
    </div>
  );
}
```

### 3. Create MessageItem Component

**File:** `apps/web/src/components/MessageItem.tsx`

Renders a chat message with optional script summary box and execution info icon.

### 4. Create ScriptSummaryBox Component

**File:** `apps/web/src/components/ScriptSummaryBox.tsx`

Displays script summary inline in a message.

### 5. Create ExecutionInfoIcon Component

**File:** `apps/web/src/components/ExecutionInfoIcon.tsx`

Small icon that opens execution detail modal when clicked.

### 6. Add Hooks

**File:** `apps/web/src/hooks/dbChatReads.ts`

- `useChatMessages(chatId)` - queries `chat_messages` table
- `useWorkflowForChat(chatId)` - queries workflow by chat_id

## Edge Cases

### No Workflow Found

If chat doesn't belong to a workflow (shouldn't happen in normal use):
- Don't show workflow info box
- Back button goes to home

### Workflow Deleted

If workflow was deleted but chat still exists:
- Don't show workflow info box
- Back button goes to home

## Visual Mockup

```
┌─────────────────────────────────────┐
│ ←    Chat                   🔔  ≡  │
├─────────────────────────────────────┤
│ ┌─────────────────────────────────┐ │
│ │ 📋 Check Gmail for newsletters  │ │
│ │    🟢 Active · Daily at 9am     │ │
│ └─────────────────────────────────┘ │
├─────────────────────────────────────┤
│                                     │
│ ┌───────────────────────────────┐   │
│ │ Can you check my gmail inbox  │   │
│ │ for newsletters?              │ ← │
│ └───────────────────────────────┘   │
│                                     │
│   ┌───────────────────────────────┐ │
│ → │ I'll help you set up an      │ │
│   │ automation to check your     │ │
│   │ Gmail inbox for newsletters. │ │
│   └───────────────────────────────┘ │
│                                     │
├─────────────────────────────────────┤
│ ┌─────────────────────────────────┐ │
│ │ How can I help?        📎  ➤  │ │
│ └─────────────────────────────────┘ │
└─────────────────────────────────────┘
```

## Testing

1. Open chat from workflow page, verify info box shows
2. Verify workflow title, status, schedule displayed correctly
3. Tap info box, verify navigation to workflow hub
4. Tap back button, verify navigation to workflow hub
5. Test with workflow in different states (active, paused, error)
6. Test with untitled workflow, verify ID fallback
7. Trigger auto-fix, verify summary box appears in chat timeline
8. Verify auto-fix summary box is collapsed by default
9. Click auto-fix summary box, verify it expands (if implemented)
10. Verify auto-fix summary shows correct change_comment

## Dependencies

- Spec 04 (Workflow Hub) - destination for navigation

## Blocked By

- Spec 04

## Blocks

- Spec 06 (Home Page) - creation flow lands in chat with this info box
