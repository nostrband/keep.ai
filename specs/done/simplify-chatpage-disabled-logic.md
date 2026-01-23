# Spec: Simplify ChatPage disabled button logic

## Problem
In `apps/web/src/components/ChatPage.tsx:249`, the disabled logic is overly complex:
```tsx
disabled={(!input && !uploadState.isUploading) || uploadState.isUploading}
```

This can be simplified. Truth table analysis:
- `!input=T, isUploading=T` → `(T && F) || T` = `T` (disabled)
- `!input=T, isUploading=F` → `(T && T) || F` = `T` (disabled)
- `!input=F, isUploading=T` → `(F && F) || T` = `T` (disabled)
- `!input=F, isUploading=F` → `(F && T) || F` = `F` (enabled)

Result: disabled when `!input || isUploading`

## Solution
Simplify to:
```tsx
disabled={!input || uploadState.isUploading}
```

## Expected Outcome
- Same behavior, clearer code
- Easier to understand at a glance
- Reduced cognitive load for future maintainers

## Considerations
- Verify with truth table that behavior is identical
- Simple one-line change
