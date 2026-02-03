# Spec: Fix Overly Broad "token" Error Classification

## Problem

In `connectors.ts`, the error classification uses `includes("token")` which is too broad:

```typescript
errorMessageLower.includes("token") ||
```

This could incorrectly classify unrelated errors as 401 auth errors:
- "token bucket rate limit exceeded" (should be 503)
- "tokenize failed" (should be 500)
- "token count exceeded" (should be 500)

## Solution

Replace the broad "token" pattern with more specific patterns:

```typescript
errorMessageLower.includes("token expired") ||
errorMessageLower.includes("invalid token") ||
errorMessageLower.includes("token revoked") ||
errorMessageLower.includes("access token") ||
```

## Expected Outcome

- Only actual token authentication errors return 401
- Unrelated errors containing "token" get appropriate status codes
- More accurate error classification for API consumers

## Considerations

- Review other OAuth error messages to ensure coverage
- May want to consolidate with error classification in packages/agent/src/errors.ts
- Similar issue exists for "service" pattern (separate spec)
