# Spec: Make Script Rollback Operation Atomic

## Problem

The script rollback operation in dbWrites.ts performs three separate async operations without a transaction:
1. Fetch target script to rollback to
2. Fetch latest script to determine next version number
3. Create new script with incremented version

Race conditions are possible:
- Two concurrent rollbacks could compute the same version number and create duplicates
- Concurrent edit + rollback could collide on version numbers
- If the latest script query fails or returns stale data, version numbering could be incorrect

## Solution

Make the rollback operation atomic, either by:
1. Wrapping operations in a database transaction (if cr-sqlite supports it)
2. Using a unique constraint on (workflow_id, version) to detect collisions and retry
3. Computing version number server-side with an atomic increment

## Expected Outcome

- Concurrent rollbacks produce distinct, sequential version numbers
- No duplicate versions can be created for the same workflow
- Version numbering is always correct and sequential
- Operation either fully succeeds or fully fails (no partial state)

## Considerations

- Check if cr-sqlite transaction API is available from the frontend
- May need to add a unique constraint on (workflow_id, version) in the scripts table if not already present
- Consider debouncing the rollback button as an additional UX safeguard
