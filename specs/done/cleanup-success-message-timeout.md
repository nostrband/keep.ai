# Spec: Cleanup Success Message Timeout

## Problem

In WorkflowEventGroup.tsx, the setTimeout for clearing the success message is never cleaned up. If the component unmounts before the 3-second timeout completes, React will warn about setting state on an unmounted component.

## Solution

Use useEffect with proper cleanup to handle the success message timeout instead of an uncleaned setTimeout in the onSuccess callback.

## Expected Outcome

- No React warnings about setting state on unmounted components
- Success message still auto-clears after 3 seconds
- Timeout is properly cleaned up on component unmount

## Considerations

- Check if similar pattern exists in other components and fix those as well
