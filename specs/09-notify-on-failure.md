## 9) Notify user on critical failure

### Goal

User is interrupted only when necessary - agent-fixable errors stay silent, infrastructure errors escalate to user.

### What triggers user notification

Only **non-fixable errors** notify the user:
* `auth` - OAuth token expired, credentials invalid
* `permission` - Access denied, scope insufficient
* `network` - Connection failed, timeout, service unavailable

**NOT notified (agent handles silently):**
* `logic` - Script bugs, unexpected data, parsing errors
* These are routed to agent for auto-fix (see spec: Error classification)

### Notification delivery

**If app is in tray (background):**
* OS-level notification
* Title: "{Workflow name} needs attention"
* Body: Brief error summary (e.g., "Gmail connection expired")
* Click → opens app to action screen

**If app is open:**
* In-app notification banner/toast
* Same content as OS notification
* Click → navigates to action screen

**Tray icon:**
* Badge/dot indicator when any workflow needs attention
* Tooltip: "1 automation needs attention"

### Action screen

Notifications lead to an action screen where user can resolve the issue:

| Error type | Action screen | Primary action |
|------------|---------------|----------------|
| `auth` | Reconnect flow | "Reconnect Gmail" button |
| `permission` | Permission request | "Grant access" button |
| `network` | Retry options | "Retry now" / "Retry in 5m" |

### UI in workflow list (spec 00)

* Workflows needing attention show red indicator
* Secondary line: "⚠ Gmail disconnected" or "⚠ Network error"
* Click → action screen for that workflow

### Server/data

* Error classification happens at tool/host level (see spec: Error classification)
* Non-fixable errors create `chat_event` with `type="needs_attention"`
* `workflow.needs_attention` flag (or computed from recent errors)

### TBD

* Notification preferences (mute specific workflows?)
* Quiet hours / do not disturb
* Notification history screen

### Lovable detail

* Notifications are rare and always actionable
* One-click resolution where possible
* Clear language: "Gmail disconnected" not "OAuth2 token refresh failed"
