# Spec: Fix chat interface pin-to-bottom behavior

## Problem

The ChatInterface pin-to-bottom functionality doesn't react to message content size changes. When a chat loads:
1. User is scrolled to bottom initially
2. Large messages (images, code blocks, etc.) render and expand
3. User is no longer at the bottom because content grew after initial scroll

Additionally, ChatInterface has three separate scroll event listeners that could potentially be consolidated for cleaner logic.

## Solution

Implement robust pin-to-bottom that tracks content size changes, not just scroll events. The scroll position should stay pinned to bottom as message content expands (images load, markdown renders, etc.).

## Expected Outcome

- When user is at bottom and new content loads/expands, they stay at bottom
- Pin-to-bottom works reliably regardless of dynamic content sizing
- Scroll event handling is cleaner and more maintainable

## Considerations

- May need ResizeObserver or MutationObserver to detect content size changes
- Should distinguish between "user scrolled away" vs "content pushed user away"
- Performance implications of observing content changes
- Three existing scroll listeners (ScrollToBottomDetector, scroll position tracking, infinite scroll) could potentially be consolidated
