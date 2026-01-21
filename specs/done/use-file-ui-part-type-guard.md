# Spec: Use proper type guard for FileUIPart

## Problem

In `prepareUserMessage` in agent-env.ts, the code uses `as any` casts to access file part properties:

```typescript
if (p.type === "file") {
  const filename = (p as any).filename || 'file';
  const mediaType = (p as any).mediaType || 'unknown';
}
```

This bypasses TypeScript's type safety and represents technical debt.

## Solution

Use the `isFileUIPart()` type guard from the `ai` package (or proper type casting to `FileUIPart`) instead of `as any`.

## Expected Outcome

- Proper TypeScript type narrowing without `as any`
- Better IDE autocomplete and error detection
- More maintainable if FileUIPart properties change
- Self-documenting code

## Considerations

- Check if `isFileUIPart` is exported from the `ai` package
- Alternative: cast to `FileUIPart` type directly if type guard not available
