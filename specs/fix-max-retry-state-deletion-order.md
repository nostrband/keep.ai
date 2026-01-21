# Spec: Fix Retry State Deletion Order on Max Retry Escalation

## Problem

In workflow-scheduler.ts, when max network retries are exceeded, the retry state is deleted from the in-memory map BEFORE the database update to mark the workflow as 'error' status. If the database update fails, the workflow enters a limbo state:

- Retry state is gone, so it won't be retried
- Workflow status was never updated to 'error', so user doesn't see it needs attention
- The workflow becomes permanently invisible/stuck

## Solution

Only delete the retry state after the database update succeeds. If the database update fails, preserve the retry state so the system can attempt the escalation again on the next signal.

## Expected Outcome

- Retry state is only deleted after successful database update
- If database update fails, retry state is preserved
- Workflows never enter a limbo state where they're neither retrying nor visible to user
- Error is logged when database update fails but state is preserved for recovery

## Considerations

- May need to convert from fire-and-forget (.catch()) to await pattern for proper sequencing
- Consider if there should be a maximum number of escalation attempts if DB keeps failing
