# Spec: Fix LCS Algorithm Tie-Breaking in ScriptDiff

## Problem

In ScriptDiff.tsx, the LCS (Longest Common Subsequence) backtracking algorithm uses `>=` instead of `>` for tie-breaking when deciding whether to move left or up in the matrix. Standard LCS implementations use `>` to prioritize deletions over insertions, producing more intuitive and consistent diffs.

Using `>=` can cause the same file comparison to produce different visual representations depending on subtle ordering, making diffs harder to read and potentially non-deterministic.

## Solution

Change the tie-breaking comparison from `>=` to `>` in the LCS backtracking logic.

## Expected Outcome

- Diffs are consistent and deterministic for the same input files
- Deletions are shown before insertions when both are valid choices (standard convention)
- Diff output matches user expectations from tools like git diff

## Considerations

- This is a one-character fix but affects the visual output of all diffs
- Consider adding a test case to verify diff output consistency
