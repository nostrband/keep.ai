## 6) Activate automation

### Goal

User explicitly activates a draft workflow to start running on schedule. This is the security boundary - user consents to running AI-generated code.

### UI

**Activate button:**
* Appears in workflow header after script is saved (Draft status)
* Button text: "Activate" or "Start automation"
* Clicking sets `workflow.status = "active"`

**After activation:**
* Status badge changes: Draft → Running (green)
* Shows next run time: "Next run: Tomorrow at 9am"
* Button changes to "Pause" (see spec 11)

**Workflow detail page shows:**
* Status badge: Draft (gray) / Running (green) / Paused (yellow)
* Schedule in human terms: "Runs daily at 9am"
* Next run timestamp (if active)
* Last run result (if any)

### Status mapping

| `workflow.status` | Badge   | Color  | Scheduler runs? |
|-------------------|---------|--------|-----------------|
| `""`              | Draft   | Gray   | No              |
| `"active"`        | Running | Green  | Yes             |
| `"disabled"`      | Paused  | Yellow | No              |

### Server/data

**To activate:**
* Set `workflow.status = "active"`
* `workflow.cron` and `next_run_timestamp` must already be set (by agent via `schedule` tool)

**API:**
* `api.updateWorkflow({ id, status: "active" })`

### Scheduler behavior

**Already implemented in `WorkflowScheduler`:**
* Runs every 10 seconds
* Checks for workflows where `next_run_timestamp <= now` AND `status != "disabled"` AND `status != ""`
* Only `"active"` workflows are executed

### Pre-activation validation

Before allowing activation, check:
* At least one script version exists

Note: Connector authorization is not checked here - agent tests access during build, errors surface earlier.

### Manual execution (no schedule)

If `workflow.cron` is empty (no schedule set):
* Show "Run now" button instead of "Activate"
* Clicking executes the script once immediately
* Workflow stays in Draft status (no recurring runs)
* User can run manually anytime via "Run now"

### Lovable detail

* Activation feels like flipping a switch - satisfying moment
* Tray tooltip updates: "1 automation running"
* Consider subtle animation/confirmation on activate
* Show "Runs daily at 9am" not raw cron expression
