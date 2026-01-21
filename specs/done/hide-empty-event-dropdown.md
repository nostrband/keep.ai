# Spec: Hide Empty Event Dropdown Menu

## Problem

In EventItem.tsx, when an event has no navigation/actions available, the dropdown menu still shows a "···" button. Clicking it reveals only a disabled "No actions available" item. This is misleading UX - the button suggests actions exist when they don't.

## Solution

Hide the dropdown button entirely when there are no actions available. Use a spacer element to maintain consistent layout if needed.

## Expected Outcome

- No dropdown button shown for events without available actions
- Consistent visual layout maintained
- Users not misled by inactive menu buttons

## Considerations

- May need a spacer div to keep alignment consistent with other items that have menus
