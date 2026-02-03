# Spec: Move ClassifiedError to Proto and Use in Connectors

## Problem

The connectors package has its own simple error types (`AuthError`, `OAuthError` in `@app/connectors`) that don't integrate with the agent's error classification system (`ClassifiedError` hierarchy in `@app/agent/src/errors.ts`).

This causes the connectors route handler to use fragile keyword-based error classification:

```typescript
// connectors.ts - BAD: keyword matching
const errorMessageLower = errorMessage.toLowerCase();
if (errorMessageLower.includes("unauthorized") || ...)
```

Instead of proper type checking:

```typescript
// GOOD: type-based classification
if (isClassifiedError(error)) {
  switch (error.type) {
    case 'auth': statusCode = 401; break;
    case 'permission': statusCode = 403; break;
    case 'network': statusCode = 503; break;
    default: statusCode = 500;
  }
}
```

## Current State

1. **ConnectionManager.getCredentials()** throws `AuthError` from `@app/connectors` (simple Error subclass)
2. **Service fetchProfile()** throws generic `Error` with unstructured messages
3. **OAuthHandler** throws `OAuthError` with `errorCode` but not ClassifiedError
4. **Route handler** does keyword matching on error messages
5. **errors.ts** in agent package has no imports - completely self-contained

## Solution

### Part 1: Move errors.ts to @app/proto

The `errors.ts` file has zero imports, making it ideal for the proto package:

1. Move `packages/agent/src/errors.ts` to `packages/proto/src/errors.ts`
2. Export from `packages/proto/src/index.ts`
3. Add `@app/proto` as dependency to `@app/connectors`
4. Update all imports in `@app/agent` from `./errors` to `@app/proto`

### Part 2: Connectors should throw ClassifiedError

1. Remove the simple `AuthError` and `OAuthError` from connectors
2. Import `AuthError`, `NetworkError`, etc. from `@app/proto`
3. Have `ConnectionManager.getCredentials()` throw the proto `AuthError`
4. Have `OAuthHandler` throw `AuthError` instead of `OAuthError`
5. Have `fetchProfile` implementations catch SDK errors and throw classified errors

### Part 3: Route handler should use type checking

```typescript
import { isClassifiedError } from "@app/proto";

// In catch block:
if (isClassifiedError(error)) {
  switch (error.type) {
    case 'auth': statusCode = 401; break;
    case 'permission': statusCode = 403; break;
    case 'network': statusCode = 503; break;
    default: statusCode = 500;
  }
} else {
  statusCode = 500;
}
```

### Part 4: Service definitions should classify errors

Each service's `fetchProfile` should catch SDK-specific errors and throw classified errors:

```typescript
import { classifyHttpError, isClassifiedError, classifyGenericError } from "@app/proto";

// google.ts fetchProfile
async fetchProfile(accessToken: string) {
  try {
    const response = await fetch(...);
    if (!response.ok) {
      throw classifyHttpError(response.status, `Google API error: ${response.statusText}`, { source: 'google.fetchProfile' });
    }
    return await response.json();
  } catch (err) {
    if (isClassifiedError(err)) throw err;
    throw classifyGenericError(err, 'google.fetchProfile');
  }
}
```

## Expected Outcome

- `@app/proto` contains the shared error classification system
- `@app/connectors` depends on `@app/proto` and throws ClassifiedError subclasses
- `@app/agent` imports errors from `@app/proto` instead of local file
- No keyword-based error classification in route handlers
- HTTP status codes determined by error type, not message content

## Considerations

- OAuthError's `errorCode` property is useful - consider adding as optional property to AuthError or storing in `cause`
- Existing code that catches the old `AuthError` from connectors needs updating
- The classify* helper functions (classifyHttpError, classifyGenericError, etc.) should also move to proto
