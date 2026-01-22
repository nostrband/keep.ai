# Spec: Refactor TaskEventGroup inline HeaderContent component

## Problem

In TaskEventGroup.tsx, the HeaderContent component is defined inline inside the parent function component. This is a React anti-pattern that causes:
- A new HeaderContent function created on every render
- React can't recognize it's the same component between renders (function identity changes)
- Cannot use React.memo() for optimization
- Combined with the setInterval that updates every second during active runs, this creates unnecessary work

## Solution

Extract HeaderContent outside of TaskEventGroup as a separate component with explicit props, following the pattern used in SharedHeader.tsx where AssistantIcon is defined at module scope.

## Expected Outcome

- HeaderContent is defined once at module scope
- Component identity is stable across renders
- Can be memoized if needed for performance
- Follows established codebase patterns
