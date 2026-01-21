# Spec: Extract WorkflowStatusBadge Component

## Problem
The `getStatusBadge` function is duplicated across multiple files:
- `WorkflowsPage.tsx`
- `WorkflowDetailPage.tsx`
- `TaskDetailPage.tsx`
- `MainPage.tsx`

Any future status changes must be updated in multiple places, increasing maintenance burden and risk of inconsistencies.

## Solution
Extract the status badge logic into a shared component that can be imported and used across all pages that need to display workflow status.

## Expected Outcome
- Single source of truth for workflow status badge rendering
- All pages display consistent badge styling and labels
- Future status changes only need to be made in one place
