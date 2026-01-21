# Spec: Extract Event Helper Functions

## Problem

TaskEventGroup.tsx and WorkflowEventGroup.tsx both contain identical copies of:
- `transformGmailMethod()` function
- `formatDuration()` function

This duplication means changes must be made in multiple places.

## Solution

Extract these shared helper functions to a common utility file like `apps/web/src/lib/event-helpers.ts`.

## Expected Outcome

- Single source of truth for `transformGmailMethod` and `formatDuration`
- Both components import from shared location
- Easier to maintain and extend

## Considerations

- Check if these functions are duplicated in any other components
- Consider if there are other event-related helpers that should be co-located
