# Common User Flows

## Flow 1: Create a New Automation

```
Home Page
    |
    | Type: "Check my email for newsletters daily"
    | Click submit
    v
Chat Page (new workflow created)
    |
    | Workflow info box shows: "Untitled - Draft"
    | AI responds, asks clarifying questions
    | You provide details
    | AI generates script
    | Workflow title auto-set: "Check Gmail for newsletters"
    v
Workflow ready
    |
    | You can: Test Run, Activate, continue chatting
```

**Tips:**
- Be specific about what you want (which email, what action, when)
- AI will ask clarifying questions if needed
- You can always refine later through chat

---

## Flow 2: Handle an Authentication Error

```
Workflow runs on schedule
    |
    | Script fails: Gmail token expired
    v
Notification bell shows badge
    |
    | Error event created
    | Workflow status: "Error"
    v
You click bell or workflow card
    |
    v
Workflow page shows error banner
    |
    | "Authentication expired"
    | "Gmail token needs refresh"
    | [Reconnect Gmail] [Dismiss]
    v
Click "Reconnect Gmail"
    |
    | OAuth flow completes
    | Error resolved
    | Workflow status: "Active"
```

**Note:** Auth errors always require your action - AI can't reconnect services for you.

---

## Flow 3: AI Auto-Fixes a Bug (Silent)

```
Workflow runs on schedule
    |
    | Script fails: Date parsing error
    v
AI enters maintenance mode (no notification)
    |
    | Workflow status: "Fixing"
    | AI analyzes error and logs
    | AI modifies script to fix the bug
    v
Script saved, workflow re-runs
    |
    | Success!
    | Workflow status: "Active"
    | Chat shows collapsed auto-fix summary
    v
You're never bothered
```

**What you see:** A collapsed summary in chat showing AI fixed something. Expand to see details if curious.

---

## Flow 4: AI Can't Fix After Multiple Attempts

```
Workflow runs on schedule
    |
    | Script fails repeatedly
    v
AI tries to fix (attempt 1)
    |
    | Still fails
    v
AI tries to fix (attempt 2)
    |
    | Still fails
    v
AI tries to fix (attempt 3)
    |
    | Still fails
    v
AI escalates to user
    |
    | Notification: "Automation paused - needs your help"
    | Workflow status: "Error"
    v
You click notification
    |
    v
Workflow page shows escalation
    |
    | "AI tried 3x but couldn't fix date parsing"
    | [Talk to AI]
    v
Chat with AI to resolve
```

**Note:** After 3 failed fix attempts, AI gives up and asks for your help.

---

## Flow 5: Modify an Existing Workflow

```
Home Page
    |
    | Click on workflow card
    v
Workflow page
    |
    | Click "Talk to AI"
    v
Chat Page
    |
    | You: "Can you also summarize the newsletters?"
    | AI: "Sure, I'll update the script to..."
    | AI saves updated script
    v
Workflow updated
    |
    | New script version saved
    | Summary updated
```

---

## Flow 6: Pause and Resume

```
Workflow page (Active workflow)
    |
    | Click "Pause"
    v
Workflow page
    |
    | Status: "Paused" (yellow)
    | Scheduled runs won't execute
    | [Resume] button available
    v
Later: Click "Resume"
    |
    | Status: "Active" (green)
    | Scheduled runs resume
```

---

## Flow 7: Test a Workflow

```
Workflow page
    |
    | Click "Test Run"
    v
Script executes immediately
    |
    | Run appears in "Recent runs"
    | Success or failure shown
    v
If failed: Check error details
If success: Workflow works correctly
```

**Tip:** Always test before activating a new workflow.

---

## Flow 8: Review Script Changes

```
Workflow page
    |
    | Click "View script history"
    v
Script Page
    |
    | List of all script versions
    | Each version shows:
    |   - Timestamp
    |   - Change summary
    |   - Who/what made the change
    v
Click a version to see code
```

Useful for understanding how your workflow evolved or reverting to a previous version.
