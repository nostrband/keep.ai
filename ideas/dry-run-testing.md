## 5) Run a dry-run execution

### Goal

User can test the automation once safely before enabling scheduled runs.

### UI

* After script is saved, show **"Test run"** button in workflow detail
* Or agent can offer to test via chat: "Want me to run a test?"
* Test results show in chat as events

### Server/data

**Already implemented:**
* `script_runs` table tracks all executions
* `script_runs.type` can distinguish run types
* `WorkflowWorker` executes scripts in QuickJS sandbox

**For dry-run:**
* Create `script_run` with `type="dry_run"` (or similar marker)
* Execute script normally - sandbox is already isolated
* Results/logs saved to `script_run.logs` and `script_run.result`

### Execution model

* In dry-run mode:
  * Reads are real (Gmail fetch, file reads work)
  * Writes can be real or simulated based on script design
  * Agent should build scripts that check a dry-run flag or use "would do X" logging
* QuickJS sandbox provides isolation (16MB memory, 300s timeout)

### Lovable detail

* Show clear "Test completed" or "Test failed" message
* One-click to enable scheduling after successful test
* Logs viewable in script run detail page
