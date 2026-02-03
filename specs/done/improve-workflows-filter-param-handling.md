# Spec: Improve Workflows Filter Parameter Handling

## Problem

The WorkflowsPage filter query parameter has two UX issues:

1. **No validation**: Invalid filter values like `/workflows?filter=invalid` are silently ignored, showing all workflows without feedback
2. **Case-sensitive**: `/workflows?filter=Drafts` or `DRAFTS` don't work, only lowercase `drafts`

Users get no indication when using an invalid or incorrectly-cased filter value.

## Solution

1. Normalize filter parameter to lowercase before matching
2. Validate against a whitelist of supported filter values
3. Optionally show feedback for invalid filter values (toast, or redirect to unfiltered view)

## Expected Outcome

- Filter matching is case-insensitive (`drafts`, `Drafts`, `DRAFTS` all work)
- Invalid filter values are handled gracefully (either ignored with feedback, or redirected)
- Easy to extend when new filter values are added

## Considerations

- Decide whether invalid filters should show a warning or silently redirect
- Consider whether to support singular form (`draft` vs `drafts`)
