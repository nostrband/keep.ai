# Spec: Standardize cost display format

## Problem

Cost display format is inconsistent across the UI:
- Some components use `.toFixed(4)` with `$` prefix (ScriptRunDetailPage, WorkflowDetailPage)
- Other components use `.toFixed(2)` without `$` prefix (EventItem, TaskEventGroup, WorkflowEventGroup)

## Solution

Standardize all cost displays to use `.toFixed(2)` without `$` prefix.

## Expected Outcome

- All cost displays use consistent format: `0.00` (2 decimal places, no $ prefix)
- Visual consistency across run detail pages and event groups

## Considerations

- The money emoji (💵) already indicates it's a cost, so $ prefix is redundant
- 2 decimal places is sufficient for user-facing display
