# Spec: Route maintenance_fixed event to task.chat_id

## Problem

In save.ts, the `maintenance_fixed` chat event is created with a hardcoded `"main"` chat ID, while the corresponding `maintenance_started` event in workflow-worker.ts uses `task.chat_id`.

This inconsistency means maintenance lifecycle events may appear in different chat contexts, potentially confusing users who expect to see the full maintenance flow in one place.

## Solution

Update save.ts to use `task.chat_id` (or derive the correct chat_id from the workflow's associated task) when creating the `maintenance_fixed` event, matching the pattern used for `maintenance_started`.

## Expected Outcome

- `maintenance_started` and `maintenance_fixed` events appear in the same chat
- Users see the complete maintenance lifecycle in one consistent location

## Considerations

- Ensure the task/chat_id is available in the save.ts context
- If task is not directly available, may need to fetch it or pass it through the options
