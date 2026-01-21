# Spec: Set error_type for ERROR_PAYMENT_REQUIRED

## Problem

In workflow-worker.ts, when `ERROR_PAYMENT_REQUIRED` is encountered, the `errorType` is left as an empty string while other error conditions set appropriate error types:

```typescript
if (error === ERROR_BAD_REQUEST) {
  errorType = 'internal';
} else if (error === ERROR_PAYMENT_REQUIRED) {
  errorType = ''; // Not classified
}
```

This means payment-related errors don't have a proper type for UI display or error routing purposes.

## Solution

Assign an appropriate error_type for ERROR_PAYMENT_REQUIRED. This could be a new type like 'payment' or reuse 'auth' if payment issues should be treated similarly to authentication issues (both require user action).

## Expected Outcome

- ERROR_PAYMENT_REQUIRED has a defined error_type
- UI can display appropriate messaging for payment-related errors
- Error routing logic handles payment errors consistently

## Considerations

- Decide if 'payment' should be a new ErrorType or map to existing type
- If adding new type, update ATTENTION_ERROR_TYPES in MainPage.tsx
- Consider what user-friendly message should display for payment errors
