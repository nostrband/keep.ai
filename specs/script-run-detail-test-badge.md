# Spec: Add test badge to ScriptRunDetailPage

## Problem

The "Test" badge is displayed correctly in WorkflowDetailPage's runs list when a run has `type === 'test'`, but when viewing the detail of that test run in ScriptRunDetailPage, the test badge is missing.

This creates a cosmetic inconsistency where users can identify test runs in the list view but not in the detail view.

## Solution

Add the same test badge display logic to ScriptRunDetailPage header that exists in WorkflowDetailPage:

```tsx
{run.type === 'test' && (
  <Badge variant="outline" className="text-amber-700 border-amber-300 bg-amber-50 text-xs">
    Test
  </Badge>
)}
```

## Expected Outcome

- Test badge appears alongside status badge in ScriptRunDetailPage header
- Consistent UI between list view and detail view
- Users can immediately identify they're viewing a test run

## Considerations

- Badge should use same styling as in WorkflowDetailPage for consistency
- Position badge near the status badge in the header area
