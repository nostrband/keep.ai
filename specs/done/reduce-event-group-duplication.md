# Spec: Reduce code duplication between TaskEventGroup and WorkflowEventGroup

## Problem

TaskEventGroup and WorkflowEventGroup have significant code duplication:
- Gmail event consolidation logic (~30 lines)
- Event filtering and partitioning logic (~10 lines)
- Event rendering loop structure (~35 lines)

This creates maintenance burden where changes need to be made in multiple places.

## Solution

Extract shared logic into reusable functions or components in the event-helpers module or a shared component.

## Expected Outcome

- Shared event processing logic is defined in one place
- Both components use the shared code
- Future changes to event handling only need to be made once

## Considerations

- The components have some differences in their data sources (TaskEventGroup has run timing data, WorkflowEventGroup doesn't)
- May need to parameterize the shared code to handle these differences
