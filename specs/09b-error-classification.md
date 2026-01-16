## 9b) Error classification and auto-fix

### Goal

Classify errors reliably so agent can auto-fix script issues while infrastructure errors escalate to user. This is core to "magical" maintenance - users only hear about things they need to act on.

### Error taxonomy

| Class | Source | Examples | Routed to |
|-------|--------|----------|-----------|
| `auth` | Tool/host | OAuth expired, invalid credentials | User |
| `permission` | Tool/host | Access denied, insufficient scope | User |
| `network` | Tool/host | Connection failed, timeout, 5xx | User |
| `logic` | Script/tool | Unexpected data, parsing error, null reference | Agent |

### Error sources

**1. Tool calls (host level) - most reliable**
* Each tool wrapper classifies errors at call time
* Host knows exactly what failed and why
* Throws typed exceptions into sandbox

**2. Script logs (Console.warn/error)**
* Agent-added logging in generated scripts
* Currently forwarded to agent
* Less reliable for classification - script doesn't know error type

**3. Unhandled exceptions**
* Script crashes without try/catch
* Always forwarded to agent for analysis/fix

### Implementation approach

**At host/tool level:**
```
// Each tool throws typed errors
class AuthError extends Error { type = 'auth' }
class PermissionError extends Error { type = 'permission' }
class NetworkError extends Error { type = 'network' }
class LogicError extends Error { type = 'logic' }
```

**Error detection per tool:**
* Gmail API: 401 → AuthError, 403 → PermissionError, 5xx/timeout → NetworkError
* Web fetch: Connection refused → NetworkError, 401/403 → varies
* File operations: EACCES → PermissionError, ENOENT → LogicError

**In sandbox:**
* Typed errors are thrown into QuickJS so scripts can catch specifically
* Scripts can handle `LogicError` (retry with different approach)
* Scripts should NOT catch `AuthError`/`PermissionError` (let them bubble up)

### Routing rules

```
on error:
  if error.type == 'network':
    → notify user (spec 09)
    → auto-retry with backoff (spec 10)
    → self-heals when service recovers
  if error.type in ['auth', 'permission']:
    → notify user immediately (spec 09)
    → no auto-retry, wait for user action
  if error.type == 'logic':
    → enter maintenance mode (spec 10)
    → agent auto-fixes silently
```

### Maintenance mode (logic errors)

When logic error occurs:
1. Set `workflow.maintenance = true`
2. Scheduler skips workflow while in maintenance
3. Error details sent to planner task inbox
4. Agent analyzes and generates fix
5. Agent saves new script version
6. Set `workflow.maintenance = false`, `next_run_timestamp = now`
7. Workflow runs immediately with fixed script
8. If fix fails repeatedly, escalate to user

**Auto-fix always runs in "AI decides" mode** - regardless of user's autonomy preference. Agent fixes silently without asking, unless:
- Critical data is missing (new required field in input)
- Ambiguous fix with significant consequences
- In these extreme cases, ask user before proceeding

### What agent receives for auto-fix

* Error message and stack trace
* Recent logs leading up to error
* Sample of input data that caused error
* Previous script version
* Run history (is this a new error or recurring?)

### Preventing spam

* Agent gets max N attempts to fix before escalating
* Same error recurring after fix → escalate
* Rate limit: don't retry more than X times per hour
* After escalation, workflow pauses until user acts

### TBD

* Exact retry limits and backoff
* How to detect "same error" vs "new error"
* UI for viewing agent fix attempts
* Manual override: user can disable auto-fix per workflow

### Lovable detail

* User only hears about real problems
* Agent fixes script bugs silently in background
* When agent does fix something, show brief "Fixed: [issue]" in chat history
