## 0) Main screen

### Goal

User lands on a single screen that lets them create new automations and see all existing ones at a glance.

### UI

**Layout:**
```
┌─────────────────────────────────────┐
│ [What would you like me to automate?] ← input + Cmd/Ctrl+N
├─────────────────────────────────────┤
│ 🔴 2 need attention                 │ ← only shown if > 0
├─────────────────────────────────────┤
│ Daily email summary        Running  │
│   Last run: 2h ago ✓               │
│ Invoice processor          Paused   │
│   ⚠ Failed 3h ago - needs attention│
│ Weekly report              Draft    │
│   Waiting for your input           │
└─────────────────────────────────────┘
```

**Input box:**
* Placeholder: "What would you like me to help automate?"
* On submit: calls `api.createTask({ content })`, redirects to `/workflows/{id}`
* Keyboard shortcut: Cmd/Ctrl+N focuses input from anywhere

**Autonomy hint (below input):**
* Shows: "AI decides details ⓘ" (muted/subtle text)
* Click toggles to: "Coordinate with me ⓘ"
* Info icon shows tooltip explaining behavior
* Choice persists as user preference
* Default: "AI decides details" (agent minimizes questions, uses safe defaults)

**Attention banner:**
* Shows count of workflows needing attention (failed runs, waiting for input)
* Only visible when count > 0
* Click to filter list to attention items only

**Workflow list:**
* Sorted by: attention items first, then by last activity
* Each row shows:
  * Title (or "Workflow {id}" if untitled)
  * Status badge: Draft (gray), Running (green), Paused (yellow)
  * Secondary line: last run result OR action needed
* Click row → navigate to `/workflows/{id}` (workflow detail/chat)

**Status badge mapping:**
| `workflow.status` | Badge    | Color  |
|-------------------|----------|--------|
| `""`              | Draft    | Gray   |
| `"active"`        | Running  | Green  |
| `"disabled"`      | Paused   | Yellow |

**Secondary line logic:**
* If waiting for user input: "Waiting for your input"
* If last run failed: "⚠ Failed {time ago} - needs attention"
* If last run succeeded: "Last run: {time ago} ✓"
* If never run and no schedule: "Not scheduled"
* If scheduled but never run: "Next run: {time}"

### Server/data

**Data needed:**
* `workflows` list with status, title, cron, next_run_timestamp
* Latest `script_run` per workflow for last run status
* `tasks` with state="wait" to detect "waiting for input"

**API:**
* `api.listWorkflows()` - returns workflows with computed attention state
* `api.createTask({ content })` - creates new workflow (existing)

### Empty state

* First-time user sees:
  * Input box prominently displayed
  * "No automations yet" message below
  * Optional: 2-3 example suggestions (defer to later)

### Lovable detail

* Workflows with attention pulse subtly or have colored left border
* Typing in input shows subtle "Press Enter to create" hint
* List updates in real-time as workflow states change (via db sync)
