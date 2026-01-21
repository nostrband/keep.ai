# Spec: Register maintenance event types in UI

## Problem

The workflow-worker creates two event types (`maintenance_started` and `maintenance_escalated`) when workflows enter and escalate from maintenance mode. However, these event types are not registered in `apps/web/src/types/events.ts`, causing EventItem to return `null` for these events and making them invisible in the timeline.

Users cannot see when maintenance mode started or when escalation occurred, reducing their context about what happened with their workflow.

## Solution

Add the two maintenance event types to the EVENT_TYPES enum and EVENT_CONFIGS map in `apps/web/src/types/events.ts`:

- `maintenance_started`: Shows when a workflow enters maintenance mode due to a logic error
- `maintenance_escalated`: Shows when fix attempts are exhausted and the workflow is paused for user intervention

## Expected Outcome

- Both event types appear in the event timeline with appropriate icons and titles
- Users can see the progression: error → maintenance mode → fix attempts → escalation
- Event payloads are properly typed for type safety

## Considerations

- Check the payload structure from workflow-worker.ts to ensure the title functions access correct properties
- Choose appropriate emoji icons (e.g., wrench for maintenance_started, warning for escalated)
- Consider the `significance` level for each event type (likely 'state' and 'error' respectively)
