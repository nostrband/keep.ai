## 7) Execute an automation on schedule

### Goal

Workflows run reliably on schedule and record results.

### Scheduling

**Already implemented in `WorkflowScheduler`:**
* Polls every 10 seconds for due workflows
* Checks `next_run_timestamp <= now` and `status = "active"`
* Handles `payment_required` signal from LLM API with 10-minute global pause (API working but unusable)

### Server/data

**Already implemented:**
* Each run creates `script_run` row:
  * `script_id` - which script version ran
  * `workflow_id` - parent workflow
  * `start_timestamp`, `end_timestamp`
  * `result` - execution result
  * `error` - error message if failed
  * `logs` - captured Console.log output

### Worker behavior

**Already implemented in `WorkflowWorker`:**
* Fetches latest script for workflow via `getScriptsByWorkflowId()`
* Creates QuickJS sandbox with:
  * 16MB memory limit
  * 512KB stack limit
  * 300 second (5 min) timeout
* Injects all sandbox APIs (Gmail, Memory, Web, Files, etc.)
* Captures logs and creates chat events for significant actions
* Updates `next_run_timestamp` after successful run

### Retry and backoff

See spec 10 for retry logic, backoff policy, and error categorization.

### Failure notifications

See spec 09 for failure notification details.

### Lovable detail

* Workflow list shows last run status with colored indicator:
  * Green dot + "Last run: 2 min ago" (success)
  * Red dot + "Failed 3h ago" (failure)
* Status updates in real-time via db sync
