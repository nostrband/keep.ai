# V1 SLC Refactor Overview

## Goal

Transform Keep.AI from a prototype with many disconnected pages into a **Simple, Lovable, Complete (SLC)** v1 product focused on the core user journey:

```
Create → Approve → Run → Handle Issues → Tune
```

## Four User-Facing Surfaces

The refactored UX has four distinct surfaces, each with a clear purpose:

### 1. Home Page - System Overview & Quick Creation
Dashboard for all workflows and fast creation:
- Workflow cards showing status at a glance
- Create input for describing new automations
- Notification bell with badge count

### 2. Workflow Page - Status & Run History
Central hub for managing a specific workflow:
- Status (Draft/Ready/Active/Paused/Error/Fixing)
- Error banner (if any)
- Action buttons (Talk to AI, Test, Pause)
- Recent runs (from `script_runs` table)
- Link to script version history

### 3. Chat Page - Workflow Edit History
Shows how the workflow evolved through user/AI collaboration:
- User/AI conversation messages (the "why" and "how")
- Auto-fix summary boxes (collapsed, showing AI made automatic repairs)
- This is where users go to understand or modify workflow logic

### 4. Notifications Page - Actionable Items Only
Shows things requiring user attention:
- ⚠️ Errors (auth expired, permission denied, network failures)
- 📬 Script messages (`user-send` notifications from scripts)
- ⛔ Escalated auto-fix (AI tried but couldn't fix)
- ❓ Script confirmations (future `user-ask` requests)
- **NOT shown:** Successful runs, auto-fix activity, tool logs

## Specs in This Refactor

### UX Specs (01-06)
| # | Spec | Description | Blocked By |
|---|------|-------------|------------|
| 01 | Event System Refactor | Write to new tables (chat_messages, notifications, execution_logs) | 12 |
| 02 | Navigation & Header Refactor | Simplify menu, add bell, Advanced submenu | - |
| 03 | Notifications Page | /notifications for actionable items only | 01, 12 |
| 04 | Workflow Hub Page | Redesigned workflow detail with status, runs, & controls | 01, 09, 11 |
| 05 | Chat Page Update | Add workflow info box + message metadata rendering | 04, 09, 12 |
| 06 | Home Page Cleanup | Fix creation flow, remove duplicates | 05, 09 |

### Database Specs (07-12) - Implement First
| # | Spec | Description |
|---|------|-------------|
| 07 | Remove chat_notifications | Deprecate table, remove code |
| 08 | Remove resources | Deprecate table, remove code |
| 09 | Chats-Workflows Direct Link | Add `workflow.chat_id` and `chat.workflow_id` |
| 10 | Tasks Table Cleanup | Add `workflow_id`, `asks`; deprecate `task_states` |
| 11 | Workflows Status Cleanup | Explicit status values: draft, ready, active, paused, error |
| 12 | Split chat_events | New tables: chat_messages, notifications, execution_logs |

## Implementation Order

```
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│  Phase 1: Database Changes (do first, can be parallel)      │
│  ┌───────────────┐ ┌───────────────┐ ┌───────────────┐     │
│  │ 07 Remove     │ │ 08 Remove     │ │ 09 Chat/WF    │     │
│  │ chat_notifs   │ │ resources     │ │ Direct Link   │     │
│  └───────────────┘ └───────────────┘ └───────┬───────┘     │
│                                              │              │
│  ┌───────────────┐ ┌───────────────┐         │              │
│  │ 10 Tasks      │ │ 11 Workflow   │         │              │
│  │ Cleanup       │ │ Status        │         │              │
│  └───────────────┘ └───────────────┘         │              │
│                                              │              │
│  ┌───────────────────────────────────────────┘              │
│  │                                                          │
│  ▼                                                          │
│  ┌─────────────────────┐                                   │
│  │ 12 Split            │  ← Creates new tables              │
│  │    chat_events      │                                   │
│  └──────────┬──────────┘                                   │
│             │                                               │
│  Phase 2: Agent/Worker Updates                              │
│             ▼                                               │
│  ┌─────────────────────┐  ┌─────────────────────┐          │
│  │ 01 Event System     │  │ 02 Navigation       │          │
│  │    Refactor         │  │    & Header         │          │
│  └──────────┬──────────┘  └─────────────────────┘          │
│             │                                               │
│  Phase 3: UI Pages (sequential)                             │
│             ▼                                               │
│  ┌─────────────────────┐                                   │
│  │ 03 Notifications    │                                   │
│  │    Page             │                                   │
│  └──────────┬──────────┘                                   │
│             │                                               │
│             ▼                                               │
│  ┌─────────────────────┐                                   │
│  │ 04 Workflow Hub     │                                   │
│  │    Page             │                                   │
│  └──────────┬──────────┘                                   │
│             │                                               │
│             ▼                                               │
│  ┌─────────────────────┐                                   │
│  │ 05 Chat Page        │                                   │
│  │    Update           │                                   │
│  └──────────┬──────────┘                                   │
│             │                                               │
│             ▼                                               │
│  ┌─────────────────────┐                                   │
│  │ 06 Home Page        │                                   │
│  │    Cleanup          │                                   │
│  └─────────────────────┘                                   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## Page Tree (After Refactor)

```
/                           Home
│                           ├── Workflow list (cards with status)
│                           ├── 🔔 Notification bell → /notifications
│                           └── Create automation input
│
├── /workflows/{id}         Workflow Hub
│   │                       ├── Status bar + dropdown controls
│   │                       ├── Error alert (if any)
│   │                       ├── Action buttons (Talk to AI, Test, Pause)
│   │                       ├── Summary ("What it does")
│   │                       ├── Recent runs (from script_runs)
│   │                       └── View script history → /scripts/{id}
│   │
│   └── /chats/{id}         Chat (Workflow Edit History)
│                           ├── Workflow info box (tappable → workflow hub)
│                           ├── User/AI conversation messages
│                           ├── Auto-fix summary boxes (collapsed)
│                           └── Input
│
├── /notifications          Actionable Items
│   │                       ├── Errors (auth, permission, network)
│   │                       ├── Script messages (user-send)
│   │                       ├── Escalated auto-fix (AI gave up)
│   │                       └── Future: Script confirmations (user-ask)
│   │
│   └── /notifications/{id} Workflow Actionable Items
│                           └── Same, filtered to workflow
│
├── /settings               Settings
│
└── [Advanced Menu]
    ├── /tasks              Task list (debug)
    ├── /scripts            Script list (debug)
    ├── /threads            Thread list (debug)
    ├── /notes              Notes (debug)
    ├── /files              Files (debug)
    ├── /devices            Devices (debug)
    └── /console            SQL Console (debug)

Removed:
├── /chat/main              → Redirect to /
├── /new                    → Redirect to /
└── Assistant menu item     → Removed
```

## Header (All Pages)

```
┌──────────────────────────────────────────────────────┐
│ [←]  {Page Title}                        🔔 {n}  [≡] │
└──────────────────────────────────────────────────────┘
     │       │                              │       │
     │       │                              │       └── Menu
     │       │                              └── Notification bell + badge
     │       └── Dynamic per page
     └── Back (when not on home)
```

## Menu Structure

```
[≡] Menu
├── Home           → /
├── Notifications  → /notifications
├── Settings       → /settings
├── ─────────────────
└── Advanced ▶
    ├── Tasks      → /tasks
    ├── Scripts    → /scripts
    ├── Threads    → /threads
    ├── Notes      → /notes
    ├── Files      → /files
    ├── Devices    → /devices
    └── Console    → /console
```

## Key Flows

### Flow 1: Create Automation

```
Home page
    │
    │ User types: "Check my email for newsletters daily"
    │ Clicks submit
    ▼
Chat page (new workflow created)
    │
    │ Workflow info box shows: "Untitled · Draft"
    │ AI responds, conversation continues
    │ AI uses tool to set title: "Check Gmail for newsletters"
    │ AI generates script
    ▼
Workflow created with script
    │
    │ User can: Test Run, Activate, etc.
```

### Flow 2: Handle Error

```
Workflow runs on schedule
    │
    │ Script fails with auth error
    ▼
Error event created (type='error')
    │
    ├──► Notification bell badge increments
    │
    ├──► OS notification sent (if app not visible)
    │
    └──► Workflow status changes to "Error"

User clicks bell or workflow card
    │
    ▼
Workflow Hub shows error alert
    │
    │ "⚠️ Authentication expired"
    │ [Reconnect Gmail] [Dismiss]
    │
    │ User clicks "Reconnect Gmail"
    ▼
Gmail reconnected, error resolved
```

### Flow 3: AI Auto-Fix (Logic Error)

```
Workflow runs on schedule
    │
    │ Script fails with logic error
    ▼
maintenance_started event created
    │
    │ Workflow status: "Fixing"
    │ (No user notification - AI handles silently)
    ▼
AI analyzes error, fixes script
    │
    ▼
maintenance_fixed event created
    │
    │ Workflow status: "Active"
    │ Script updated with fix
    │ Chat shows collapsed auto-fix summary box
    ▼
Workflow continues running
```

## Data Model (See Specs 07-12 for details)

### Three Purpose-Specific Tables

| Table | Purpose | What Shows Where |
|-------|---------|------------------|
| `chat_messages` | User/AI conversation | Chat Page |
| `notifications` | Actionable items | Notifications Page, Workflow error banner |
| `execution_logs` | Tool calls, debugging | Execution detail view (drill-down) |

### chat_messages

Clean conversation with optional metadata links:
- `task_run_id` → "ℹ️" icon for execution detail
- `script_id` → Script summary box at bottom of message
- `failed_script_run_id` → Indicates auto-fix response

### notifications

| Type | Description | Shows In |
|------|-------------|----------|
| `error` | Auth/permission/network errors | Notifications Page, Workflow error banner |
| `escalated` | AI gave up after 3 fix attempts | Notifications Page |
| `script_message` | Script notifying user (`user.send`) | Notifications Page |
| `script_ask` (future) | Script requesting confirmation | Notifications Page |

### execution_logs

Tool calls and operational data, accessed via drill-down from chat messages (task_run_id link).

### What's NOT in these tables

- `maintenance_started/fixed` → Now metadata on chat_messages (`failed_script_run_id`, `script_id`)
- `add_script` → Now `script_id` link on chat_message
- Tool events → Now in `execution_logs`, not shown in chat feed

## Status States

| Status | Color | Meaning | Actions |
|--------|-------|---------|---------|
| Draft | Gray | No script yet | Talk to AI |
| Ready | Blue | Has script, not active | Activate, Test |
| Active | Green | Running on schedule | Pause, Test |
| Paused | Yellow | User paused | Resume |
| Error | Red | Has unresolved error | View error, Retry |
| Fixing | Orange | AI auto-fixing | (wait) |

## Files Changed Summary

### New Files
- `apps/web/src/pages/NotificationsPage.tsx`
- `apps/web/src/components/NotificationBell.tsx`
- `apps/web/src/components/WorkflowInfoBox.tsx`
- `apps/web/src/components/EventCard.tsx`
- `apps/web/src/hooks/useWorkflowsNeedingAttention.ts`
- `apps/web/src/hooks/useNotificationEvents.ts`
- `apps/web/src/hooks/useWorkflowForChat.ts`

### Modified Files
- `packages/agent/src/workflow-worker.ts` - event routing
- `packages/agent/src/ai-tools/save.ts` - event routing
- `packages/agent/src/tools/user-send.ts` - route to task.chat_id instead of "main"
- `packages/db/src/chat-store.ts` - new query methods
- `packages/db/src/script-store.ts` - new query methods
- `apps/web/src/pages/MainPage.tsx` - creation flow, cards
- `apps/web/src/pages/WorkflowDetailPage.tsx` - complete redesign

### Removed Files/Tools
- `packages/agent/src/tools/list-events.ts` - remove from agent-env (reads from defunct "main" chat)
- `apps/web/src/pages/ChatPage.tsx` - workflow info box
- `apps/web/src/components/SharedHeader.tsx` - notification bell
- `apps/web/src/components/Menu.tsx` - simplified structure
- `apps/web/src/App.tsx` - routes

### Removed/Redirected
- `apps/web/src/pages/NewChatPage.tsx` - redirect to /
- Route: `/chat/main` - redirect to /
- Menu item: "Assistant"
