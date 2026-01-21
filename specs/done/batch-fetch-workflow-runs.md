# Spec: Batch Fetch Workflow Runs

## Problem
Multiple components fetch the latest run for each workflow sequentially in a for loop:
- MainPage.tsx fetches runs to display workflow status
- WorkflowNotifications.ts fetches runs to check for errors needing attention

With many workflows, this creates N separate API calls per component, causing poor performance that scales badly. WorkflowNotifications runs on every database change, making this especially problematic.

## Solution
Create a new scriptStore method to fetch latest runs for multiple workflow IDs in a single database query instead of N separate calls.

## Expected Outcome
- Single API call to fetch latest runs for all workflows
- Significant performance improvement on MainPage load
- WorkflowNotifications performs efficiently even with many workflows
- Proper cleanup to prevent stale state updates if component unmounts during fetch
