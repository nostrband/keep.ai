# Spec: Deduplicate TaskEventGroup Header Rendering

## Problem

TaskEventGroup.tsx renders the header twice with ~120 lines of nearly identical code:
- One version wrapped in `<Link>` component (when navigation is available)
- One version wrapped in plain `<div>` (when no navigation)

This duplication increases maintenance burden and risk of the two versions diverging.

## Solution

Extract the shared header content to a subcomponent or use a conditional wrapper pattern to eliminate the duplication.

## Expected Outcome

- Single source of truth for header content
- Wrapper (Link or div) chosen conditionally
- Reduced code duplication (~120 lines to ~60 lines)
- Easier to maintain and update header styling

## Considerations

- Ensure click handling and navigation behavior is preserved
- The conditional wrapper pattern (`const Wrapper = condition ? Link : 'div'`) may need type handling for props
