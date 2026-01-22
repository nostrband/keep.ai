# Four User Surfaces

Keep.AI organizes information across four distinct surfaces, each with a clear purpose. This prevents information overload while ensuring you can always find what you need.

## 1. Home Page - System Overview & Quick Creation

**URL:** `/`

The home page is your dashboard - see all workflows at a glance and quickly create new ones.

### What Shows Here

- **Workflow cards** - All your automations with status indicators
- **Create input** - Text field to describe a new automation
- **Notification bell** - Badge showing items needing attention

### Workflow Cards

Each card shows:
- Workflow title
- Status indicator (Draft/Ready/Active/Paused/Error/Fixing)
- Last run time or "Not scheduled"

Click a card to go to its Workflow page.

### Creating a New Workflow

1. Type what you want to automate in the input field
2. Click submit
3. Navigates to Chat page where AI helps you refine and build it

### Empty State

When no workflows exist, shows welcome message with example automations to inspire you.

---

## 2. Workflow Page - Status & Run History

**URL:** `/workflows/{id}`

The central hub for managing a specific workflow. Shows current state and execution history.

### What Shows Here

- **Status bar** - Current state with dropdown controls
- **Error banner** - If there's an unresolved error, shown prominently with action buttons
- **Action buttons** - Talk to AI, Test Run, Pause/Resume
- **Summary** - What the workflow does (AI-generated description)
- **Recent runs** - Last 5 script executions with status and duration
- **Script history link** - View all versions of the script

### Status States

| Status | Color | Meaning |
|--------|-------|---------|
| Draft | Gray | No script yet, still setting up |
| Ready | Blue | Has script, not activated |
| Active | Green | Running on schedule |
| Paused | Yellow | Temporarily stopped by user |
| Error | Red | Has unresolved error needing attention |
| Fixing | Orange | AI is automatically fixing an issue |

### Recent Runs

Shows execution history:
- Success (checkmark) with duration
- Failure (X) with error type
- Running (spinner) for in-progress

Click a run to see detailed logs.

---

## 3. Chat Page - Workflow Edit History

**URL:** `/chats/{id}`

Shows the evolution of your workflow through conversation with AI.

### What Shows Here

- **Workflow info box** - Tappable header showing workflow name and status
- **User messages** - Your requests and questions
- **AI responses** - Explanations, confirmations, updates
- **Auto-fix summaries** - Collapsed boxes showing AI made automatic repairs

### What Does NOT Show Here

- Script run results (see Workflow page)
- Errors requiring action (see Notifications)
- Other workflows' activity

### Use Cases

- Create or modify workflow logic
- Ask AI to change how the script works
- Understand what changes were made and why
- Review automatic fixes AI applied

### Auto-fix Summary Boxes

When AI automatically fixes a failing script, instead of cluttering the chat with internal reasoning, you see a collapsed summary:

```
+------------------------------------------+
| Auto-fix applied                     [v] |
|   Fixed date parsing error               |
|   2 hours ago                            |
+------------------------------------------+
```

Click to expand for more details if needed.

---

## 4. Notifications Page - Actionable Items Only

**URL:** `/notifications` or `/notifications/{workflowId}`

Shows things that require your attention or response. Nothing else.

### What Shows Here

| Type | Icon | Description |
|------|------|-------------|
| **Errors** | Warning | Auth expired, permission denied, network failures |
| **Script Messages** | Mailbox | Notifications from running scripts |
| **Escalated Fixes** | Stop | AI tried but couldn't fix after multiple attempts |
| **Confirmations** (future) | Question | Scripts asking for your approval |

### What Does NOT Show Here

- Successful runs (too noisy at scale)
- Auto-fix activity that succeeded (handled silently)
- Tool execution logs (internal implementation detail)
- Regular chat messages (in chat page)

### Notification Cards

Each notification card shows:
- Icon indicating type
- Title/summary of the issue
- Workflow name and timestamp
- Action buttons (Reconnect, Retry, View workflow, etc.)

### Workflow-Specific View

Navigate to `/notifications/{workflowId}` to see notifications for just one workflow. Useful when debugging a specific automation.

---

## Summary: Where to Find What

| Looking for... | Go to... |
|----------------|----------|
| See all my workflows | Home page |
| Create a new automation | Home page |
| Current workflow status | Workflow page |
| Recent execution results | Workflow page |
| Script version history | Workflow page → Script history link |
| Create/modify workflow logic | Chat page |
| See what AI changed automatically | Chat page (auto-fix boxes) |
| Errors needing my attention | Notifications page |
| Messages from scripts | Notifications page |
