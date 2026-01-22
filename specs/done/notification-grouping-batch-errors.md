# Spec: Group notifications for batch workflow failures

## Problem

Each workflow error produces an individual OS notification. When multiple workflows fail simultaneously (e.g., 5 workflows with auth errors after token expiry), the user receives 5 separate notifications, causing notification spam.

## Solution

Implement notification batching/grouping in WorkflowNotifications:

- Collect errors during a check interval instead of notifying immediately
- Group by error type (auth, permission, network, etc.)
- Send a single grouped notification per error type (e.g., "3 workflows need authentication")
- Include workflow names/count in the notification body

## Expected Outcome

- Users receive at most one notification per error type per check cycle
- Grouped notification shows count and can navigate to a filtered view of affected workflows
- Reduces notification noise during cascading failures (e.g., API key expiry affecting multiple workflows)

## Considerations

- Need to decide on grouping window (current check interval or separate debounce)
- Click action for grouped notification - navigate to workflows list filtered by error type?
- May need to track which workflows were included in a grouped notification for deduplication
- Consider platform differences in notification grouping support (macOS vs Windows vs Linux)
