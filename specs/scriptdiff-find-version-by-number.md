# Spec: Find Previous Script Version by Version Number

## Problem

In WorkflowDetailPage.tsx, the code to find the previous version for diff comparison relies on array index position:
```typescript
const previousVersion = scriptVersions[index + 1];
```

This only works because the database query returns versions in DESC order. The assumption is undocumented and fragile - if the sort order changes, the diff would compare wrong versions.

## Solution

Find the previous version explicitly by version number instead of array index:
```typescript
const previousVersion = scriptVersions.find(v => v.version === script.version - 1);
```

## Expected Outcome

- Code is self-documenting - clearly shows we want version N-1
- Works regardless of array ordering
- No implicit dependency on database query sort order
- Maintainers can understand the intent without tracing back to the query

## Considerations

- Performance is negligible - typical version count is <100, find() is O(n)
- Handle case where previous version doesn't exist (version 1 has no previous)
