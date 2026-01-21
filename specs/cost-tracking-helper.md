# Spec: Add helper function for cost tracking in tool events

## Problem

The cost tracking system relies on tools manually passing the correct object structure `{ usage: { cost: number } }` when creating events. There's no type enforcement, making it easy to accidentally pass `usage` directly instead of the nested structure, which causes costs to not be accumulated.

This bug happened in audio-explain.ts (fixed in commit 466d29f) and could happen again in future tools.

## Solution

Create a helper function that enforces the correct cost tracking structure:

```typescript
function formatUsageForEvent(usage: { cost?: number }): { usage: { cost: number } } {
  return { usage: { cost: usage.cost || 0 } };
}
```

Or use TypeScript types to enforce the structure at compile time.

Update existing tools to use this helper for consistency and update documentation/examples for new tools.

## Expected Outcome

- Type-safe way to pass usage data to createEvent
- Impossible to accidentally pass wrong structure
- Consistent pattern across all tools
- Future tools have clear example to follow

## Considerations

- Could be a simple helper function or a more comprehensive type definition
- Need to update all existing tools to use the helper (or leave them as-is since they're already correct)
- Should be documented in tool development guidelines
