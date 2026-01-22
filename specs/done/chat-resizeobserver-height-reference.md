# Spec: Fix inconsistent DOM references in chat ResizeObserver

## Problem

In `apps/web/src/components/ChatInterface.tsx`, the ResizeObserver implementation uses inconsistent DOM references for height comparison:

- `lastHeight` is initialized from `container.scrollHeight` (the chat messages div)
- `newHeight` is read from `document.documentElement.scrollHeight` (the document root)

These are different DOM nodes with different scrollHeight values. After the first resize event, `lastHeight` stores the documentElement value, but the initial comparison uses mismatched values, which could cause incorrect auto-scroll behavior on the first content resize.

## Solution

Use consistent DOM reference for both initialization and comparison. Since `scrollToBottom` uses `document.documentElement.scrollHeight`, the comparison should also use `document.documentElement.scrollHeight` for initialization.

## Expected Outcome

- `lastHeight` initialized from `document.documentElement.scrollHeight`
- Height comparisons use the same DOM reference consistently
- Auto-scroll to bottom works correctly on first content resize (e.g., image load)

## Considerations

- The observer is attached to the container element (to detect when it resizes)
- But the scroll position is relative to the document, so document.documentElement is the correct reference for height measurement
- Consider adding a clarifying comment explaining why we observe container but measure document
