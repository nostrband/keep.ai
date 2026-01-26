# Spec: Fix GDrive Event Tracking Inconsistency

## Problem

The Google Drive tool only tracks events for `list`, `create`, and `delete` methods. The `update` and `copy` methods are significant write operations that should also be tracked for activity logging and auditing purposes.

## Solution

Expand the event tracking condition in gdrive.ts to include `update` and `copy` methods alongside the existing tracked methods.

## Expected Outcome

- All significant GDrive operations (`list`, `create`, `delete`, `update`, `copy`) generate activity events
- Consistent audit trail for file modifications
- Users can see complete history of Drive operations in activity logs

## Considerations

- Review gsheets.ts and gdocs.ts for similar gaps in event tracking
- File: `packages/agent/src/tools/gdrive.ts`
