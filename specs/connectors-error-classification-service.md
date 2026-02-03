# Spec: Fix Overly Broad "service" Error Classification

## Problem

In `connectors.ts`, the error classification uses `includes("service")` which is extremely broad:

```typescript
errorMessageLower.includes("service") ||
```

This could incorrectly classify many errors as 503 Service Unavailable:
- "Unknown service" (should be 400 or 500)
- "service definition error" (should be 500)
- "service ID not found" (should be 404 or 400)

## Solution

Replace the broad "service" pattern with more specific patterns:

```typescript
errorMessageLower.includes("service unavailable") ||
errorMessageLower.includes("service error") ||
errorMessageLower.includes("service down") ||
errorMessageLower.includes("503") ||
```

## Expected Outcome

- Only actual service availability errors return 503
- Unrelated errors containing "service" get appropriate status codes
- More accurate error classification for API consumers

## Considerations

- Review common service provider error messages to ensure coverage
- May want to consolidate with error classification in packages/agent/src/errors.ts
- Related to "token" pattern fix (separate spec)
