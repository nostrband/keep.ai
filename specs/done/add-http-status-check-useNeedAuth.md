# Spec: Add HTTP status check in useNeedAuth

## Problem
In `apps/web/src/hooks/useNeedAuth.ts:42-43`, there's no check for `configResponse.ok` before parsing JSON:

```typescript
const configResponse = await fetch(`${API_ENDPOINT}/check_config`);
const configData = await configResponse.json();
```

If /check_config returns HTTP 500 or an HTML error page, JSON.parse throws an error. While this falls back to the server error display (which works), it masks the real issue and makes debugging harder.

## Solution
Add HTTP status validation before parsing JSON:

```typescript
const configResponse = await fetch(`${API_ENDPOINT}/check_config`);
if (!configResponse.ok) {
  throw new Error(`Failed to check config: HTTP ${configResponse.status}`);
}
const configData = await configResponse.json();
```

Optionally, also add response structure validation:
```typescript
if (!configData || typeof configData !== 'object') {
  throw new Error('Invalid config response format');
}
```

## Expected Outcome
- HTTP errors are detected before attempting JSON parse
- Error messages are more descriptive for debugging
- Fallback behavior unchanged (shows server error)

## Considerations
- Keep the catch block behavior unchanged for user experience
- Could add specific handling for different HTTP status codes if needed
