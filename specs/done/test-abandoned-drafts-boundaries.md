# Spec: Test abandoned drafts boundary conditions

## Problem
The `getAbandonedDrafts()` and `getDraftActivitySummary()` functions have complex logic with time thresholds and COALESCE fallbacks, but tests don't cover important boundary conditions:
- Exact threshold boundary (workflow exactly 7 days old)
- Workflow with no chat_messages (should fallback to script timestamps)
- Task with 'asks' state (not just 'wait')
- COALESCE precedence when multiple timestamps exist

## Solution
Add test cases in script-store.test.ts that specifically target these boundary conditions to ensure the queries behave correctly at edge cases.

## Expected Outcome
- Test for workflow at exactly 7-day threshold (both included and excluded)
- Test for workflows with missing chat_messages to verify fallback behavior
- Test for tasks in 'asks' state in addition to 'wait'
- Test that verifies COALESCE picks the correct timestamp when multiple exist

## Considerations
- May need to mock or control the current time in tests for reliable threshold testing
- Review the actual SQL queries to understand all COALESCE paths
