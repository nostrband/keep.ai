# Spec: Fix ConnectionsSection setTimeout Memory Leak

## Problem

In `ConnectionsSection.tsx`, a 2-minute timeout is set when initiating an OAuth connection to auto-clear the pending state. However, this timeout is never cleaned up on component unmount, which can:
- Cause memory leaks
- Call setState on an unmounted component (React warning)

## Solution

Store the timeout ID in a ref and clear it in a useEffect cleanup function when the component unmounts.

## Expected Outcome

- No memory leak from orphaned timeouts
- No React warnings about state updates on unmounted components
- Pending state still auto-clears after 2 minutes if user stays on the page

## Considerations

- File: `apps/web/src/components/ConnectionsSection.tsx`
- May need to handle multiple concurrent connection attempts (multiple timeouts)
