## 8) Record a run log

### Goal

Users can trust and debug because runs are visible and traceable.

### Data

**Already implemented in `script_runs` table:**
* `id` - unique run identifier
* `script_id` - which script version
* `workflow_id` - parent workflow
* `start_timestamp`, `end_timestamp` - timing
* `result` - JSON result from script execution
* `error` - error message if failed
* `logs` - captured Console.log output
* `type` - run type (workflow, dry_run, etc.)

### Chat events display

**Already implemented:**
* `WorkflowEventGroup` groups events by `script_run_id`
* Header shows: workflow title, ⚙ icon, status, total cost (💵)
* Individual events displayed via `EventItem` component
* 25+ event types supported with emoji icons:
  * 📧 Gmail API calls (consolidated when multiple)
  * 🔍 Web search
  * 🌐 Web fetch
  * 📁 File save
  * 📝 Note operations
  * 🎨 Image generation
  * And more...
* Events with navigation: Notes, Tasks, Scripts link to detail pages
* Cost shown on individual events when `usage.cost > 0`

### WorkflowDetailPage

**Already implemented:**
* Workflow metadata: title, ID, status badge
* Cron schedule and next run time
* Script runs list showing:
  * Run ID, status badge
  * Start/end timestamps
  * Links to script run detail pages
* Controls: "Run now" button, Enable/Disable toggle

### ScriptRunDetailPage

**Already implemented:**
* Run metadata: Script ID, Task ID, Run ID (with links)
* Status badge (Running/Completed/Error)
* Start/end timestamps, duration
* Error message (if failed)
* Result and logs display

**TBD:**
* Event breakdown within run (currently only shows in chat, not on detail page)
* Cost display (missing from this page)

### TBD items

* Add cost display to ScriptRunDetailPage
* Add cost per run in WorkflowDetailPage script runs list
* Event menu actions (currently TODO/console.log only)
* Detailed event information modal/expanded view

### Lovable detail

* Events use emoji icons for quick visual scanning
* Highlight errors with distinct styling
* Show total cost in group headers
