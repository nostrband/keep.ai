# Spec: Validate and truncate quick-reply option text length

## Problem

The `formatAsks()` function in the ask tool does not validate or limit the length of option text. If an agent provides very long option strings, the quick-reply buttons could break the UI layout (overflow, wrapping issues, or pushing other elements off-screen).

## Solution

Add length validation/truncation for quick-reply options:

- Truncate option text to a reasonable maximum (e.g., 50-100 characters)
- Add ellipsis (...) when truncated
- Optionally show full text on hover via tooltip

## Expected Outcome

- Quick-reply buttons maintain consistent sizing regardless of option text length
- Long options are truncated with ellipsis indicator
- UI layout remains stable with any option content

## Considerations

- Choose appropriate max length that works well with button styling
- Truncation should happen in formatAsks() (server-side) or QuickReplyButtons (client-side)
- Consider whether to warn/log when truncation occurs
- May want to validate on the agent side to encourage concise options
