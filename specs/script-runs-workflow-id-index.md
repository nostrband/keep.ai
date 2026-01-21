# Spec: Add database index on script_runs workflow_id column

## Problem

The script_runs table has no index on the workflow_id column, but several queries group and filter by this column (e.g., `getLatestRunsByWorkflowIds()`). This causes full table scans on large datasets.

Existing indexes only cover script_id and start_timestamp (from migration v11). The workflow_id column was added in v16 without an index.

## Solution

Create a database migration that adds an index on the workflow_id column, potentially as a composite index with start_timestamp for optimal query performance.

## Expected Outcome

- Queries filtering by workflow_id use index lookup instead of full table scan
- Improved performance for workflow-related run queries as the table grows

## Considerations

- Consider composite index (workflow_id, start_timestamp DESC) since queries often order by timestamp
- This is related to but separate from specs/script-runs-retry-of-index.md (different column)
