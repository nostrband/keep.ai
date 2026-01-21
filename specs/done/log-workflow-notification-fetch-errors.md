# Spec: Log Workflow Notification Fetch Errors

## Problem

In WorkflowNotifications.ts, errors when fetching individual workflow runs are silently ignored with an empty catch block. If a specific workflow has data issues, its error state is completely missed with no visibility.

## Solution

Add console.debug logging for errors when fetching workflow runs, so issues are visible during debugging while not spamming the console in normal operation.

## Expected Outcome

- Errors logged with workflow ID for debugging
- Easier to diagnose issues with specific workflows
- Processing continues for other workflows (current behavior preserved)

## Considerations

- Use console.debug rather than console.error to avoid noise in normal operation
