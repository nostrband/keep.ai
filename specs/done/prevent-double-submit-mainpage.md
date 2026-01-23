# Spec: Prevent double submit on MainPage

## Problem
In `apps/web/src/components/MainPage.tsx`, rapid double-clicks on the submit button can trigger multiple task creations before React's async state update (`setIsSubmitting(true)`) takes effect. This could result in duplicate tasks being created.

## Solution
Use a ref for synchronous checking in addition to the state for UI updates:

```typescript
const isSubmittingRef = useRef(false);

const handleSubmit = async () => {
  if (isSubmittingRef.current) return;
  isSubmittingRef.current = true;
  setIsSubmitting(true); // for UI disable
  try {
    // ... existing submit logic
  } finally {
    isSubmittingRef.current = false;
    setIsSubmitting(false);
  }
};
```

## Expected Outcome
- Second click is blocked immediately (synchronous ref check)
- No duplicate task creation on rapid clicks
- UI still shows disabled state via isSubmitting state

## Considerations
- This pattern could be extracted to a custom hook if used elsewhere
- Ensure finally block runs even on navigation to clean up ref
