# Spec: Fix handleCheck Response Validation

## Problem

The `handleCheck` function in ConnectionsSection attempts to parse JSON from the response without first checking `response.ok`. If the server returns a 500 error (or other non-JSON error response), the JSON parsing will fail with an "unexpected token" error, masking the actual server error.

## Solution

Add a `response.ok` check before attempting to parse JSON. If the response is not ok, handle the error appropriately (show error message to user).

## Expected Outcome

- Server errors are handled gracefully with meaningful error messages
- No cryptic "unexpected token" errors shown to users
- Connection check failures display the actual reason for failure

## Considerations

- File: `apps/web/src/components/ConnectionsSection.tsx`
- Similar pattern may need to be applied to other fetch calls in the component
