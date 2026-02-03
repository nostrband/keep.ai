# Spec: Crop Before Escaping in console-log Tool

## Problem

In `console-log.ts`, the 1000 character limit is applied AFTER escaping:

```typescript
const escapedLine = input.line.replace(/'/g, "\\'");
const croppedLine = escapedLine.length > 1000
  ? "'" + escapedLine.substring(0, 1000) + "..."
  : "'" + escapedLine + "'";
```

This causes two issues:
1. Substring might cut in the middle of an escape sequence (e.g., cutting at the backslash of `\'`)
2. A 990-char message with 20 quotes becomes 1010 chars after escaping, triggering unexpected truncation

## Solution

Crop the input BEFORE escaping:

```typescript
const croppedInput = input.line.length > 1000
  ? input.line.substring(0, 1000) + "..."
  : input.line;
const escapedLine = croppedInput
  .replace(/\\/g, "\\\\")
  .replace(/'/g, "\\'");
const output = "'" + escapedLine + "'";
```

## Expected Outcome

- Users can predict truncation based on their input length (not escaped length)
- No risk of cutting in the middle of escape sequences
- Consistent 1000 character limit on original input

## Considerations

- The final output may exceed 1000 chars after escaping, but that's acceptable since escaping is for correctness
- The "..." indicator should be added before escaping so it's part of the cropped message
