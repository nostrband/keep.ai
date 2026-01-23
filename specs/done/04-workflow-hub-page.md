# Spec 04: Workflow Hub Page

## Overview

Redesign the workflow detail page (`/workflows/{id}`) to be the central hub for managing an automation. Shows status, error alerts, controls, summary, and recent activity. Replaces the current verbose detail view.

## Current State

The current workflow page shows:
- Workflow name + Draft status
- "Chat" button + "Script required to activate" message
- Created date, Workflow ID
- Chat section (linked)
- Task section (linked)
- Script Runs section

This exposes too many internal concepts (tasks, script runs) and lacks clear controls.

## Target State

```
┌──────────────────────────────────────────────────────┐
│ ← Home              Check Gmail for...    🔔   [≡]  │
├──────────────────────────────────────────────────────┤
│                                                      │
│  Check Gmail for newsletters              [Active ▼]│
│  ────────────────────────────────────────────────── │
│  📅 Every day at 9:00 AM                            │
│                                                      │
│  ┌────────────────────────────────────────────────┐ │
│  │ ⚠️ Authentication expired                       │ │
│  │    Gmail token needs refresh                    │ │
│  │    [Reconnect Gmail]  [Dismiss]                 │ │
│  └────────────────────────────────────────────────┘ │
│                                                      │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐          │
│  │ Talk to  │  │   Test   │  │  Pause   │          │
│  │   AI     │  │   Run    │  │          │          │
│  └──────────┘  └──────────┘  └──────────┘          │
│                                                      │
├──────────────────────────────────────────────────────┤
│  What it does                                        │
│  ─────────────                                       │
│  Every morning at 9am, checks your Gmail inbox for  │
│  emails from newsletter senders and creates a       │
│  summary in your notes.                             │
│                                                      │
├──────────────────────────────────────────────────────┤
│  Recent runs                                         │
│  ───────────                                         │
│  ✗ Failed · 2 hours ago · Auth error                │
│  ✓ Success · yesterday · 3.2s                       │
│  ✓ Success · 2 days ago · 2.8s                      │
│                                                      │
│  View script history →                               │
│                                                      │
└──────────────────────────────────────────────────────┘
```

## Page Sections

### 1. Header

```
┌──────────────────────────────────────────────────────┐
│ ← Home              {workflow_title}       🔔   [≡]  │
└──────────────────────────────────────────────────────┘
```

- Back button → Home (`/`)
- Workflow title (or truncated ID if untitled)
- Notification bell (standard)
- Menu button (standard)

### 2. Status Bar

```
┌──────────────────────────────────────────────────────┐
│  {workflow_title}                         [Status ▼] │
│  ──────────────────────────────────────────────────  │
│  📅 {schedule_description}                           │
└──────────────────────────────────────────────────────┘
```

**Status Badge Options:**
| Status | Color | Meaning |
|--------|-------|---------|
| Draft | Gray | No script yet, needs setup |
| Ready | Blue | Has script, not activated |
| Active | Green | Running on schedule |
| Paused | Yellow | User paused |
| Error | Red | Has unresolved error |
| Fixing | Orange | AI is auto-fixing (maintenance=true) |

**Status Dropdown Actions:**
- `active` → "Pause" (sets status to 'paused')
- `paused` → "Resume" (sets status to 'active')
- `error` → "Resume" (sets status to 'active', resolves notification)
- `ready` → "Activate" (sets status to 'active')
- `draft` → No dropdown (need script first)

**Schedule Description Examples:**
- "Every day at 9:00 AM"
- "Every hour"
- "When triggered manually"
- "Not scheduled yet"

### 3. Error Alert (Conditional)

Only shown when there's an unresolved error in `notifications` table for this workflow.

```
┌────────────────────────────────────────────────────┐
│ ⚠️ {error_type_friendly} error                     │
│    {error_message}                                 │
│    [Action Button]  [Dismiss]                      │
└────────────────────────────────────────────────────┘
```

**Action Buttons by Error Type:**
| Error Type | Action Button |
|------------|---------------|
| auth | "Reconnect {service}" |
| permission | "Check Permissions" |
| network | "Retry Now" |
| internal | "Contact Support" |

**Dismiss Behavior:**
- Sets `acknowledged_at` on the notification
- Hides the alert but notification remains queryable
- To fully resolve: set `resolved_at` (e.g., after successful retry)

### 4. Action Buttons

```
┌──────────┐  ┌──────────┐  ┌──────────┐
│ Talk to  │  │   Test   │  │  Pause   │
│   AI     │  │   Run    │  │          │
└──────────┘  └──────────┘  └──────────┘
```

| Button | Action | When Shown |
|--------|--------|------------|
| Talk to AI | Navigate to `/chats/${workflow.chat_id}` | Always |
| Test Run | Execute script once, show result | status !== 'draft' |
| Activate | Set status to 'active' | status === 'ready' |
| Pause | Set status to 'paused' | status === 'active' |
| Resume | Set status to 'active' | status === 'paused' OR status === 'error' |

### 5. Summary Section

```
┌──────────────────────────────────────────────────────┐
│  What it does                                        │
│  ─────────────                                       │
│  {script.summary}                                    │
│                                                      │
│  (or "Not configured yet" if no script)             │
└──────────────────────────────────────────────────────┘
```

Source: `script.summary` field from the latest script version.

### 6. Recent Runs

Shows script execution history (from `script_runs` table, not chat_events).

```
┌──────────────────────────────────────────────────────┐
│  Recent runs                                         │
│  ───────────                                         │
│  ✗ Failed · 2 hours ago · Auth error                │
│  ✓ Success · yesterday · 3.2s                       │
│  ✓ Success · 2 days ago · 2.8s                      │
└──────────────────────────────────────────────────────┘
```

**Run Items (from script_runs table):**

| Run Status | Display |
|------------|---------|
| success | ✓ Success · {relative_time} · {duration} |
| error | ✗ Failed · {relative_time} · {error_type} |
| running | ⏳ Running · {relative_time} |

**Limit:** Show last 5 runs.

**Click behavior:** Navigate to `/tasks/{task_id}/runs/{run_id}` to see run details.

### 7. Script History Link

Link to view script version history (edit history handled by AI).

```
┌──────────────────────────────────────────────────────┐
│                                                      │
│  View script history →                               │
│                                                      │
└──────────────────────────────────────────────────────┘
```

**Destination:** `/scripts/{script_id}` (existing script detail page with version list)

## Data Requirements

### Query: Unresolved Error (from notifications table)

```typescript
async getUnresolvedError(workflowId: string): Promise<Notification | null> {
  const results = await db.execO(
    `SELECT * FROM notifications
     WHERE workflow_id = ?
       AND type = 'error'
       AND resolved_at = ''
     ORDER BY timestamp DESC
     LIMIT 1`,
    [workflowId]
  );
  return results[0] || null;
}
```

### Query: Recent Runs

```typescript
async getRecentRuns(workflowId: string, limit = 5): Promise<ScriptRun[]> {
  return await db.execO(
    `SELECT * FROM script_runs
     WHERE workflow_id = ?
     ORDER BY start_timestamp DESC
     LIMIT ?`,
    [workflowId, limit]
  );
}
```

### Navigation to Chat

Use direct link via `workflow.chat_id` (from Spec 09):

```typescript
// Navigate to chat
navigate(`/chats/${workflow.chat_id}`);
```

### Status Display

Status is now explicit in `workflow.status` field (from Spec 11):
- `draft` - No script yet
- `ready` - Has script, not activated
- `active` - Running on schedule
- `paused` - User paused
- `error` - Has unresolved error

Plus `maintenance` flag for "Fixing" state:

```typescript
function getDisplayStatus(workflow: Workflow): DisplayStatus {
  if (workflow.maintenance) return 'fixing';
  return workflow.status;  // Already explicit: draft, ready, active, paused, error
}
```

## Implementation

### 1. Refactor WorkflowDetailPage

**File:** `apps/web/src/pages/WorkflowDetailPage.tsx`

Replace current implementation with new hub layout.

### 2. Create Sub-components

**Files:**
- `components/workflow/WorkflowStatusBar.tsx`
- `components/workflow/WorkflowErrorAlert.tsx`
- `components/workflow/WorkflowActions.tsx`
- `components/workflow/WorkflowSummary.tsx`
- `components/workflow/WorkflowActivity.tsx`

### 3. Add Status Dropdown Component

**File:** `components/workflow/WorkflowStatusDropdown.tsx`

Shows current status as badge, opens dropdown with actions.

### 4. Add NotificationStore Method

**File:** `packages/db/src/notification-store.ts`

Add `getUnresolvedError(workflowId)` method to get latest unresolved error for a workflow.

## State Transitions

```
                 ┌─────────┐
                 │  Draft  │
                 └────┬────┘
                      │ script created
                      ▼
                 ┌─────────┐
                 │  Ready  │
                 └────┬────┘
                      │ activate
                      ▼
   ┌──────────── ┌─────────┐ ───────────┐
   │             │ Active  │            │
   │             └────┬────┘            │
   │  pause           │ error           │ AI fixes
   ▼                  ▼                 ▼
┌─────────┐     ┌─────────┐      ┌─────────┐
│ Paused  │     │  Error  │ ───► │ Fixing  │
└────┬────┘     └────┬────┘      └────┬────┘
     │ resume        │ retry/fix      │ fixed
     └───────────────┴────────────────┘
                      │
                      ▼
                 ┌─────────┐
                 │ Active  │
                 └─────────┘
```

## Testing

1. View workflow in Draft state, verify "Not configured" shown
2. View workflow with script, verify summary shown
3. Trigger error, verify error alert appears
4. Click action buttons, verify correct navigation/behavior
5. Verify recent runs shows script execution history
6. Click a run item, verify navigation to run detail page
7. Click "View script history", verify navigation to script page
8. Test status dropdown actions (pause, resume, etc.)

## Dependencies

- Spec 01 (Event System) - for type='error' events and workflow_id in content
- Spec 03 (Notifications Page) - for "View all" link destination

## Blocked By

- Spec 01

## Blocks

- Spec 05 (Chat Page) - needs workflow hub as back navigation target
