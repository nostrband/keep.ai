# Spec: Add null assignment to CodeBlockCopyButton timeout

## Problem

In CodeBlockCopyButton (code-block.tsx), the timeout callback doesn't set the ref to null after the timeout fires, unlike other components that follow this pattern.

## Solution

Add `copyTimeoutRef.current = null;` in the timeout callback for consistency with the pattern used elsewhere.

## Expected Outcome

- Consistent timeout ref handling across all components
- Ref accurately reflects whether a timeout is pending
