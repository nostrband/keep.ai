# Spec: Generate test run ID upfront

## Problem

The test-run endpoint queries for the "latest" run after execution to get the run ID. With concurrent test runs for the same workflow, this could return the wrong run due to race conditions.

## Solution

Generate the script run ID upfront before starting execution and pass it through to the workflow worker, then return it directly to the caller.

## Expected Outcome

- Run ID is generated before execution starts
- The exact run ID is returned to the caller without querying
- Concurrent test runs don't interfere with each other's ID retrieval
