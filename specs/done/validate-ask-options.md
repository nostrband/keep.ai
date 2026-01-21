# Spec: Validate Ask Tool Options Array

## Problem

The `formatAsks` function in the ask tool accepts any string array without validation:
- Empty strings would render as empty buttons
- Duplicates would show the same option multiple times
- Very long strings have no truncation

## Solution

Add basic validation to the `formatAsks` function to filter empty strings and deduplicate options before storing.

## Expected Outcome

- Empty strings are filtered out
- Duplicate options are removed
- Clean options array stored in task state
- No empty or duplicate quick-reply buttons rendered

## Considerations

- Consider whether to also add a max length limit for individual options
- Consider whether to limit the total number of options
