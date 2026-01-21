# Spec: Validate Workflow Status Before Retry

## Problem

The retry handler in WorkflowEventGroup.tsx only checks if the workflow exists, not if it's in an active state. The scheduler only executes workflows where `status === 'active'`.

If a user clicks "Retry" on a paused/disabled workflow:
- The database is updated with new `next_run_timestamp`
- "Retry scheduled" success message is shown
- But the workflow never actually executes

This gives users false positive feedback.

## Solution

Add status validation before allowing retry. If the workflow is not active, show a message like "Enable workflow first to retry" instead of proceeding with the retry.

## Expected Outcome

- Users cannot retry non-active workflows
- Clear feedback explaining why retry is not available
- No false positive "Retry scheduled" messages for workflows that won't run

## Considerations

- Could alternatively auto-activate the workflow when retry is clicked (but this might be unexpected behavior)
- Consider disabling the Retry menu item entirely for non-active workflows
