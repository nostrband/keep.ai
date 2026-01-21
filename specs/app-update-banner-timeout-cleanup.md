# Spec: Add setTimeout cleanup for app update banner

## Problem

In App.tsx, the app update banner auto-dismiss uses setTimeout without proper cleanup:

```typescript
const handleAppUpdate = () => {
  setShowBanner(true);
  setTimeout(() => setShowBanner(false), 10000);
};
```

Issues:
- Timeout is not stored in a ref
- No cleanup on component unmount
- Multiple updates could schedule conflicting timeouts
- Stale closures over `setShowBanner`

## Solution

Apply the same useRef-based timeout cleanup pattern used elsewhere in the codebase:

- Store timeout ID in a ref
- Clear existing timeout before scheduling new one
- Clean up timeout on component unmount

## Expected Outcome

- Only one auto-dismiss timeout active at a time
- Timeout properly cleaned up on unmount
- No memory leaks from orphaned timeouts
- Consistent with timeout patterns in other components (WorkflowEventGroup, etc.)

## Considerations

- Related to specs/settimeout-cleanup-remaining-components.md which covers other files
