# Spec: Fix Backslash Escaping in console-log Tool

## Problem

In `console-log.ts`, only single quotes are escaped but backslashes are NOT:

```typescript
const escapedLine = input.line.replace(/'/g, "\\'");
```

This creates ambiguity when a message contains both backslash and quote:
- Input: `test\'` → Output: `'test\''`
- The backslash might be misinterpreted as escaping the quote

## Solution

Escape backslashes first, then single quotes:

```typescript
const escapedLine = input.line
  .replace(/\\/g, "\\\\")
  .replace(/'/g, "\\'");
```

Order matters: backslashes must be escaped first, otherwise the backslash added for quote escaping would itself get escaped.

## Expected Outcome

- Messages containing backslashes are displayed correctly
- No ambiguity between literal backslashes and escape sequences
- Input `test\'` → Output `'test\\\''` (literal backslash, literal quote)

## Considerations

- May also want to consider escaping newlines and other control characters
- Related issue: cropping may break escape sequences (separate spec)
