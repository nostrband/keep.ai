# Spec: Network Error Maximum Retries

## Problem
Network errors currently trigger exponential backoff retries with no maximum limit. Once the backoff caps at 10 minutes, workflows retry every 10 minutes indefinitely.

This causes:
- Permanently unavailable external services trigger infinite retries
- Workflows never transition to error state for user attention
- Users are never notified of persistent network issues
- Wasted resources from endless retry attempts

## Desired Behavior
Network errors should have a maximum retry limit. After exhausting retries, the workflow should escalate to require user attention rather than continuing to retry forever.

The escalation should:
- Stop further automatic retries
- Mark the workflow as needing attention
- Allow the user to see what went wrong
- Allow manual retry once the underlying issue is resolved

## Considerations
- What's a reasonable max retry count? (balance between giving transient issues time to resolve vs not retrying forever)
- Should the retry count reset after a successful run?
- Should different network error subtypes (timeout vs DNS vs connection refused) have different limits?
- How should this interact with the existing exponential backoff logic?

## Files likely involved
- `packages/agent/src/workflow-scheduler.ts` - retry scheduling logic
- `packages/agent/src/workflow-worker.ts` - error routing logic
