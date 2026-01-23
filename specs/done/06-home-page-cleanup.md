# Spec 06: Home Page Cleanup

## Overview

Clean up the home page to be the single entry point for automation creation. Remove duplicate entry points (`/new` page, "Create Workflow" button on `/workflows`). Improve workflow cards to show status. Fix the creation flow to properly navigate to chat.

## Current Issues

1. **Duplicate entry points:**
   - Home page input: "What would you like me to help automate?"
   - `/workflows` → "Create Workflow" button → `/new` page with "What would you like to plan?"
   - Confusing, different prompts

2. **Creation doesn't work properly:**
   - User submits on home page, no workflow created (or UI doesn't update)
   - No navigation to chat after creation

3. **Workflow cards lack status:**
   - Only show "Draft" and "Not scheduled"
   - No indication of running, error, or paused states

## Target State

```
┌──────────────────────────────────────────────────────┐
│ Keep.AI                                    🔔 2  [≡] │
├──────────────────────────────────────────────────────┤
│                                                      │
│  ┌────────────────────────────────────────────────┐ │
│  │ 📋 Check Gmail for newsletters                 │ │
│  │    🔴 Error · Last run: 2 hours ago            │ │
│  └────────────────────────────────────────────────┘ │
│                                                      │
│  ┌────────────────────────────────────────────────┐ │
│  │ 📋 Daily weather report                        │ │
│  │    🟢 Active · Last run: 6 hours ago           │ │
│  └────────────────────────────────────────────────┘ │
│                                                      │
│  ┌────────────────────────────────────────────────┐ │
│  │ 📋 Backup photos                               │ │
│  │    ⚪ Draft · Not scheduled                    │ │
│  └────────────────────────────────────────────────┘ │
│                                                      │
├──────────────────────────────────────────────────────┤
│  ┌────────────────────────────────────────────────┐ │
│  │ What would you like to automate?      [+] [→] │ │
│  └────────────────────────────────────────────────┘ │
│                                                      │
│  [AI decides details]                               │
│                                                      │
└──────────────────────────────────────────────────────┘
```

## Changes Required

### 1. Fix Creation Flow

**Current behavior:** Submit → nothing visible happens

**Target behavior:** Submit → create workflow + chat → navigate to chat

```typescript
async function handleSubmit(message: string) {
  // 1. Create workflow (this creates task + chat internally)
  const workflow = await api.createWorkflow({ message });

  // 2. Navigate to the chat to continue conversation
  navigate(`/chats/${workflow.chatId}`);
}
```

### 2. Remove Duplicate Entry Points

**Remove `/new` route:**
```typescript
// Remove this route
<Route path="/new" element={<NewChatPage />} />

// Add redirect for any bookmarks
<Route path="/new" element={<Navigate to="/" replace />} />
```

**Remove "Create Workflow" button from `/workflows` page:**
The workflows list page becomes read-only, just for viewing existing workflows.

Or, if keeping the button, make it navigate to home:
```typescript
<Button onClick={() => navigate('/')}>
  Create Workflow
</Button>
```

### 3. Improved Workflow Cards

**Current card:**
```
┌─────────────────────────────────────┐
│ Workflow 5a79cf19                   │
│ Draft                               │
│ Not scheduled                       │
└─────────────────────────────────────┘
```

**Target card:**
```
┌─────────────────────────────────────┐
│ 📋 Check Gmail for newsletters      │
│    🔴 Error · Last run: 2 hours ago │
└─────────────────────────────────────┘
```

**Card fields:**
| Field | Source |
|-------|--------|
| Title | `workflow.title` or truncated ID |
| Status | Derived (see Spec 04) |
| Last run | `latest_script_run.end_timestamp` |

**Status indicators (from Spec 11):**
| `workflow.status` | Display |
|-------------------|---------|
| `draft` | ⚪ Draft |
| `ready` | 🔵 Ready |
| `active` | 🟢 Active |
| `paused` | 🟡 Paused |
| `error` | 🔴 Error |
| (any + `maintenance=true`) | 🟠 Fixing |

### 4. Empty State

When no workflows exist:

```
┌──────────────────────────────────────────────────────┐
│                                                      │
│                 Welcome to Keep.AI                   │
│                                                      │
│     Describe what you'd like to automate below,     │
│          and I'll help you set it up.               │
│                                                      │
│  Examples:                                           │
│  • "Check my email for newsletters daily"           │
│  • "Remind me to drink water every 2 hours"         │
│  • "Summarize the news every morning"               │
│                                                      │
├──────────────────────────────────────────────────────┤
│  ┌────────────────────────────────────────────────┐ │
│  │ What would you like to automate?      [+] [→] │ │
│  └────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────┘
```

## Implementation

### 1. Update MainPage Component

**File:** `apps/web/src/pages/MainPage.tsx`

```tsx
export function MainPage() {
  const { workflows, isLoading } = useWorkflows();
  const navigate = useNavigate();

  const handleSubmit = async (message: string) => {
    // Create workflow and navigate to chat
    const result = await createWorkflow(message);
    navigate(`/chats/${result.chatId}`);
  };

  return (
    <div className="flex flex-col h-full">
      <Header title="Keep.AI" />

      <div className="flex-1 overflow-auto p-4">
        {workflows.length === 0 ? (
          <EmptyState />
        ) : (
          <WorkflowList workflows={workflows} />
        )}
      </div>

      <div className="p-4 border-t">
        <AutomationInput onSubmit={handleSubmit} />
      </div>
    </div>
  );
}
```

### 2. Update WorkflowCard Component

**File:** `apps/web/src/components/WorkflowCard.tsx`

```tsx
interface WorkflowCardProps {
  workflow: Workflow;
  latestRun?: ScriptRun;
}

export function WorkflowCard({ workflow, latestRun }: WorkflowCardProps) {
  // Status is now explicit in workflow.status (Spec 11)
  // Only need to check maintenance flag for "Fixing" display
  const displayStatus = workflow.maintenance ? 'fixing' : workflow.status;

  const lastRunText = latestRun
    ? `Last run: ${formatRelativeTime(latestRun.end_timestamp)}`
    : workflow.status === 'draft' ? 'Not configured' : 'Not scheduled';

  return (
    <Link to={`/workflows/${workflow.id}`} className="block">
      <Card>
        <div className="flex items-center gap-2">
          <span>📋</span>
          <span className="font-medium truncate">
            {workflow.title || `Workflow ${workflow.id.slice(0, 8)}`}
          </span>
        </div>
        <div className="flex items-center gap-2 text-sm text-muted-foreground mt-1">
          <StatusIndicator status={displayStatus} />
          <span>·</span>
          <span>{lastRunText}</span>
        </div>
      </Card>
    </Link>
  );
}
```

### 3. Update/Remove NewChatPage

**File:** `apps/web/src/pages/NewChatPage.tsx`

Either remove entirely or convert to redirect:

```tsx
export function NewChatPage() {
  return <Navigate to="/" replace />;
}
```

### 4. Update WorkflowsPage (Optional)

**File:** `apps/web/src/pages/WorkflowsPage.tsx`

Remove "Create Workflow" button, or redirect it to home.

### 5. Fix createWorkflow Function

Ensure the workflow creation follows the new data model (Specs 09, 10, 11, 12):
1. Creates workflow record with `chat_id`
2. Creates task record with `workflow_id`
3. Creates chat record with `workflow_id`
4. All links set bidirectionally at creation
5. Returns the chat_id for navigation

**File:** `apps/web/src/hooks/dbWrites.ts` (or similar)

```typescript
async function createWorkflow(message: string) {
  const workflowId = generateId();
  const taskId = generateId();
  const chatId = generateId();

  // Create records with bidirectional links (Spec 09, 10)
  await api.chatStore.createChat({
    id: chatId,
    workflow_id: workflowId,  // Direct link to workflow
  });

  await api.taskStore.addTask({
    id: taskId,
    chat_id: chatId,
    workflow_id: workflowId,  // Direct link to workflow
    type: 'planner',
    asks: '',
  });

  await api.scriptStore.addWorkflow({
    id: workflowId,
    task_id: taskId,
    chat_id: chatId,          // Direct link to chat
    status: 'draft',          // Explicit status (Spec 11)
    title: '',
    cron: '',
    events: '',
    maintenance: false,
    maintenance_fix_count: 0,
    active_script_id: '',
  });

  // Save initial user message to chat_messages table (Spec 12)
  await api.chatStore.saveChatMessage({
    id: generateId(),
    chat_id: chatId,
    role: 'user',
    content: JSON.stringify(createUserMessage(message)),
    timestamp: new Date().toISOString(),
    task_run_id: '',
    script_id: '',
    failed_script_run_id: '',
  });

  return { workflowId, chatId };
}
```

## Routes After Cleanup

```
/                           Home (workflow list + create input)
├── /workflows/{id}         Workflow Hub
│   └── /chats/{id}         Chat
├── /notifications          Global Event Feed
│   └── /notifications/{id} Workflow Event Feed
├── /settings               Settings
│
└── [Advanced - in menu]
    ├── /tasks
    ├── /tasks/{id}
    ├── /scripts
    ├── /threads
    ├── /notes
    ├── /files
    ├── /devices
    └── /console

Removed/Redirected:
├── /new                    → Redirect to /
├── /workflows              → Keep but remove create button
└── /chat/main              → Redirect to /
```

## Testing

1. Submit message on home page → workflow created → navigates to chat
2. Verify workflow appears in list after creation
3. Verify workflow card shows correct status and last run
4. Navigate to /new → redirects to home
5. Navigate to /chat/main → redirects to home
6. Verify empty state shown when no workflows
7. Click workflow card → navigates to workflow hub

## Dependencies

- Spec 05 (Chat Page) - for navigation destination after creation
- Spec 09 (Chats-Workflows Direct Link) - for bidirectional links
- Spec 11 (Workflows Status Cleanup) - for explicit status values
- Spec 12 (chat_events split) - for chat_messages table

## Blocked By

- Spec 05, 09, 11, 12

## Blocks

- None (this is the final piece)

## Migration Notes

- Users with /new bookmarked will be redirected to home
- Users with /chat/main bookmarked will be redirected to home
- No data migration needed
