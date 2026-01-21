# Spec: Replace Custom LCS with Diff Library in ScriptDiff

## Problem

ScriptDiff.tsx implements a custom LCS (Longest Common Subsequence) algorithm that has several issues:
- O(n*m) memory complexity - can crash browser for large files
- Tie-breaking bug producing inconsistent diffs
- Empty string edge case handling
- No optimization for similar files (common in version history)

## Solution

Replace the custom LCS implementation with an established diff library like `diff` (jsdiff) from npm. This library:
- Is battle-tested and handles edge cases
- Uses optimized algorithms (Myers diff)
- Has better memory characteristics
- Provides multiple output formats (line diff, word diff, etc.)

## Expected Outcome

- ScriptDiff component uses `diff` library instead of custom algorithm
- Large files diff without crashing the browser
- Edge cases (empty strings, trailing newlines) handled correctly
- Consistent, intuitive diff output
- Simpler, more maintainable code

## Considerations

- The `diff` library is already widely used - check if it's already a transitive dependency
- The library provides `diffLines()` function which is ideal for this use case
- May need to adapt the output format to match the current UI rendering
- Consider adding a file size limit as additional safety net
