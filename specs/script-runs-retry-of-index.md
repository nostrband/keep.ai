# Spec: Add database index on script_runs retry_of column

## Problem

The getRetriesOfRun() query filters by retry_of column but there is no index on this column. This causes full table scans on every run detail page view, which will degrade performance as the script_runs table grows.

## Solution

Create a new database migration that adds an index on the retry_of column (or a composite index on retry_of and retry_count for optimal query performance).

## Expected Outcome

- Queries filtering by retry_of use index lookup instead of full table scan
- Run detail page loads remain fast as the script_runs table grows

## Considerations

- Consider whether a composite index (retry_of, retry_count) is more appropriate given the query also orders by retry_count
