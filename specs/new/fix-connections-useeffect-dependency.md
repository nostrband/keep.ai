# Spec: Fix ConnectionsSection useEffect Dependency

## Problem

A useEffect in ConnectionsSection includes the entire `success` object in its dependency array. Since this object is recreated on every render, the effect may fire unnecessarily, potentially causing unexpected behavior or performance issues.

## Solution

Either:
- Only depend on `success.show` function (if it's stable/memoized)
- Extract the toast logic to a callback
- Use a ref for the success handler to avoid it being a dependency

## Expected Outcome

- Effect only fires when `connections` or `pendingService` actually change
- No unnecessary re-runs due to unstable object references
- Success toast still shows correctly when a new connection is detected

## Considerations

- File: `apps/web/src/components/ConnectionsSection.tsx`
- Check how the `success` object is created (custom hook?) to determine best fix approach
