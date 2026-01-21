# Spec: Fix Next Run Time Status Check

## Problem
The WorkflowDetailPage shows the next run countdown for any workflow status except 'disabled' and 'error'. However, the scheduler only executes workflows where `status === 'active'`. This means draft workflows could show a misleading "next run" countdown even though they won't actually run.

## Solution
Align the UI status check with the scheduler logic - only show next run countdown for active workflows.

## Expected Outcome
- Next run countdown only displayed for active workflows
- Draft and other non-active workflows don't show misleading countdown
- UI behavior matches actual scheduler behavior
