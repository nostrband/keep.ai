# Spec: Fix Empty String Handling in ScriptDiff

## Problem

In ScriptDiff.tsx, empty strings are not handled correctly when splitting into lines:
```typescript
const oldLines = oldCode.split("\n");
const newLines = newCode.split("\n");
```

`"".split("\n")` returns `[""]` (array with one empty string), not `[]`. This causes:
- Comparing an empty file to a non-empty file shows incorrect diff results
- New scripts (starting from empty) display incorrectly
- Cleared/deleted scripts display incorrectly
- Trailing newlines may create spurious empty line entries

## Solution

Add input normalization before splitting to handle empty strings:
```typescript
const oldLines = oldCode ? oldCode.split("\n") : [];
const newLines = newCode ? newCode.split("\n") : [];
```

Or check for empty string case at the start of computeDiff and handle it separately.

## Expected Outcome

- Empty string input produces an empty array of lines
- Comparing empty vs non-empty files shows correct "all added" or "all removed" diff
- New scripts show all lines as additions
- Cleared scripts show all lines as deletions

## Considerations

- Consider also handling trailing newline normalization (trim trailing empty lines or be consistent about them)
