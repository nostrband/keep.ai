## 10) Retry a failed run

### Goal

System auto-retries failures intelligently. Network issues self-heal. Auth issues wait for user. Logic issues go to agent.

### Retry behavior by error type

| Error type | Auto-retry | Backoff | User notified | Notes |
|------------|------------|---------|---------------|-------|
| `network` | Yes | Exponential, max 10min | After N retries | Self-heals eventually |
| `auth` | No | - | Immediately | User must reconnect |
| `permission` | No | - | Immediately | User must grant access |
| `logic` | No* | - | No | Agent fixes, see below |

*Logic errors trigger maintenance mode, not retry.

### Network error handling

* Auto-retry with exponential backoff: 10s, 20s, 40s... up to 10 minutes max
* **No max_retries** - only max_backoff. System will self-heal when service recovers.
* Notify user after N failed retries (e.g., 3) so they're aware
* May produce multiple notifications of same type if issue persists
* On success: clear backoff, resume normal schedule

### Logic error handling (maintenance mode)

When logic error occurs:
1. Set `workflow.maintenance = true`
2. Scheduler skips workflow while in maintenance
3. Error forwarded to agent (planner task inbox)
4. Agent analyzes and creates new script version
5. On agent completion: `workflow.maintenance = false`, `next_run_timestamp = now`
6. Workflow runs immediately with fixed script

### Auth/permission error handling

* No auto-retry - would just fail again
* Notify user immediately (spec 09)
* Workflow continues schedule but will keep failing until user acts
* Consider: pause workflow after N consecutive auth failures?

### Retry tracking

**Required for V1:**
* `script_run.retry_of` - links to original failed run ID (or null)
* `script_run.retry_count` - which retry attempt this is
* Allows UI to show retry chain and history

### Backoff state

**Already implemented:**
* `WorkflowScheduler` tracks retry state per workflow
* Backoff policy: 10s → 20s → 40s → ... → 10min (max)
* State stored in scheduler memory (per-session)
* Cleared on successful run (`"done"` signal)

### UI

* Workflow detail shows current retry state:
  * "Retrying in 2m" with countdown (network errors)
  * "In maintenance - agent fixing" (logic errors)
  * "Needs reconnection" (auth errors)
* Failed run notification includes manual **"Retry now"** button
* Retry history visible in run list (shows retry chain)

### Lovable detail

* "Retry scheduled in 2m" countdown updates live
* When network recovers, show brief "Back online" confirmation
* Maintenance mode feels automatic - user doesn't need to act on logic errors
