# Spec: Fix OAuth State Validation Race Condition

## Problem

The OAuth state validation in `completeOAuthFlow` uses a non-atomic check-and-delete pattern. The state is retrieved, validated through several checks, and only then deleted. Between getting the state and deleting it, a concurrent request with the same intercepted OAuth callback URL could also pass validation.

This creates a potential token replay attack vector if an attacker intercepts an OAuth callback URL.

## Solution

Make the state consumption atomic by deleting the state immediately after retrieving it, before any validation checks. This ensures only one request can "claim" a given state.

Move the `pendingStates.delete(state)` call to immediately after `pendingStates.get(state)` in the same synchronous block.

## Expected Outcome

- Only one request can successfully use a given OAuth state
- Concurrent requests with the same state will fail with "Invalid or expired state"
- Token replay attacks are prevented

## Considerations

- File: `packages/connectors/src/manager.ts`
- Simple change: move the delete() call earlier in the function
- All validation checks should happen after deletion, operating on the captured `pending` object
