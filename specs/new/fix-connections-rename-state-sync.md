# Spec: Fix Connection Rename State Sync

## Problem

In ConnectionsSection, the `newLabel` state for renaming a connection is initialized once from `connection.label`. If the connection label is updated externally (e.g., via database sync from another tab or device), the local `newLabel` state won't reflect the new value, showing stale data in the rename input.

## Solution

Add a useEffect to sync the `newLabel` state when `connection.label` changes externally.

## Expected Outcome

- Rename input field reflects the current connection label even after external updates
- No stale label values shown when editing
- User edits are preserved while actively editing (don't overwrite during typing)

## Considerations

- File: `apps/web/src/components/ConnectionsSection.tsx`
- Need to handle the case where user is actively editing (don't reset mid-edit)
- Could use a "dirty" flag or only sync when rename UI is not open
