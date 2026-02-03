# Spec: Remove files.list from GDrive TRACKED_METHODS

## Problem

In gdrive.ts, the `TRACKED_METHODS` Set includes `files.list`:

```typescript
const TRACKED_METHODS = new Set<string>([
  "files.list",  // Read operation
  "files.create",
  "files.update",
  "files.delete",
  "files.copy",
]);
```

Unlike the other methods (create, update, delete, copy) which are write operations, `files.list` is a read-only operation. Tracking read operations can generate excessive events and doesn't provide the same audit value as tracking mutations.

## Solution

Remove `files.list` from the `TRACKED_METHODS` Set. Only track operations that modify data.

## Expected Outcome

- Reduced event noise from read-only operations
- TRACKED_METHODS only contains write operations
- Consistent with the purpose of tracking (audit mutations, not reads)

## Considerations

- Verify there's no specific auditing requirement that necessitates tracking list operations
- Check if similar read operations are tracked in gdocs.ts or gsheets.ts and remove those too
