# Spec: Fix Confusing Compression Error Message

## Problem

In compression.ts, an error message says the opposite of what's happening:

```typescript
if (typeof chunk !== "string" && !this.binary)
  throw new Error("Uint8Array input in binary mode");
```

The condition `!this.binary` means we're in STRING mode, but the error says "binary mode".

## Solution

Fix the error message to accurately describe the situation: receiving Uint8Array input when string input was expected.

## Expected Outcome

- Error message accurately states: expected string input in string mode, got Uint8Array
- Easier debugging when this error is encountered
