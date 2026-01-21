## 11) Pause an automation

### Goal

User can stop an automation instantly.

### UI

* Workflow detail: **Pause** button (toggles `status`)
* Tray menu: "Pause all automations" option
* Status changes immediately reflected

### Server/data

**Already implemented:**
* Set `workflow.status = "disabled"` to pause
* Set `workflow.status = "active"` to re-enable (not `""` which is Draft)
* `WorkflowScheduler` skips workflows where `status = "disabled"`

**API:**
* `scriptStore.updateWorkflow({ ...workflow, status: "disabled" })`

### Scheduler behavior

* Disabled workflows are filtered out in scheduler loop
* Existing in-progress runs continue to completion (can't interrupt QuickJS)
* Next scheduled run won't trigger

### Lovable detail

* Show pause reason in UI:
  * "Paused by you" - user paused manually
  * "Paused: needs reconnection" - repeated auth errors
* Quick re-enable with single click
