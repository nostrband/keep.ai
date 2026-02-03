# Spec: Add onError Callback to ArchivedPage Mutation

## Problem

In `ArchivedPage.tsx`, the restore functionality uses try-catch for error handling but doesn't include an `onError` callback for the TanStack Query mutation.

TanStack Query mutations can fail through React Query's error handling mechanism in ways that may not be caught by the try-catch block. Adding an `onError` callback provides defense-in-depth.

## Solution

Add an `onError` callback to the mutation that shows the error message using the existing error display mechanism:

```typescript
mutate(data, {
  onSuccess: () => { ... },
  onError: (error) => {
    errorMessage.show(error.message || "Failed to restore workflow");
  },
});
```

## Expected Outcome

- All error paths display feedback to the user
- Consistent with TanStack Query best practices
- Defense-in-depth error handling

## Considerations

- May be redundant with try-catch in some cases, but provides safety net
- Check other mutations in the codebase for similar missing callbacks
