# Spec: Fix maxResultSizeSafe() Return Value Logic

## Problem

The `maxResultSizeSafe()` function in compression classes has backwards conditional logic:

```typescript
if (!this.maxResultSize) return this.maxResultSize;  // returns falsy value
return Math.max(64, this.maxResultSize - 1024);      // applies margin
```

When `maxResultSize` is falsy (undefined/null/0), it returns that falsy value. When defined, it applies the 1KB margin. The function doesn't clearly communicate its intent - it should return `undefined` when no limit is set.

Affected locations:
- NodeCompression.maxResultSizeSafe() in packages/node/src/compression.ts
- BrowserCompression.maxResultSizeSafe() in packages/browser/src/compression.ts
- NoCompression.maxResultSizeSafe() in both node and browser packages

## Solution

Change the return statement to explicitly return `undefined` when no limit is set:

```typescript
if (!this.maxResultSize) return undefined;
```

Investigation confirmed all callers use truthiness checks, so this change is safe.

## Expected Outcome

- Function clearly returns `undefined` when no size limit is configured
- Improved code clarity and type safety
- No functional change to callers (all already handle falsy values correctly)

## Considerations

- Update all 4 implementations (NodeCompression, BrowserCompression, and both NoCompression classes)
- Consider updating interface documentation in packages/sync/src/compression.ts if return type becomes strictly `number | undefined`
