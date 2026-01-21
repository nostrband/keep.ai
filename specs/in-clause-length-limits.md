# Spec: Add length limits to IN clause queries

## Problem

Several database methods accept arrays for IN clauses without validating array length. Passing extremely large arrays could cause resource exhaustion or performance issues.

Affected locations:
- script-store.ts `getLatestRunsByWorkflowIds()`
- task-store.ts `getTasks()`
- task-store.ts `getStates()`
- file-store.ts `getFiles()`
- nostr-peer-store.ts `deletePeers()`

## Solution

Add maximum length validation on all array inputs before generating IN clause queries. Throw an error if the limit is exceeded.

## Expected Outcome

- All IN clause queries validate input array length on entry
- Clear error message when limit is exceeded
- Protection against resource exhaustion from oversized queries

## Considerations

- Choose an appropriate limit (e.g., 1000 items)
- Consider implementing batch processing as an alternative for legitimate large array use cases
- The limit should be consistent across all affected methods
