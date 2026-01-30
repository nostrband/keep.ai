# Spec: Fix Race Condition in getUserPath()

## Problem

In `getUserPath()`, there's a TOCTOU (time-of-check-time-of-use) race condition:

```typescript
if (!fs.existsSync(userDir)) {
  fs.mkdirSync(userDir, { recursive: true });
}
```

Between the `existsSync` check and `mkdirSync` call, another process could create the directory. The check is also unnecessary since `recursive: true` already handles existing directories gracefully.

## Solution

Remove the redundant `existsSync` check and rely on `recursive: true`:

```typescript
fs.mkdirSync(userDir, { recursive: true });
```

## Expected Outcome

- No race condition window
- Simpler, more idiomatic code
- Same functional behavior (directory created if missing, no error if exists)

## Considerations

- Search for similar patterns elsewhere in the codebase
