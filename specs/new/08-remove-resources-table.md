# Spec 08: Remove resources Table Feature

## Overview

Remove all code related to the `resources` table. This is legacy functionality that was never used in the application.

**Rationale:** The resources table was created in v1 migration for "shared working memory and contextual resources" but the feature was never implemented or used. All methods exist but have zero callers.

## Scope

- **Remove:** All code that queries/updates the `resources` table
- **Keep:** The table in the database, marked as deprecated (drop later near production)
- **Keep:** The migration statements (required for existing databases)

## Files to Modify

### 1. Database Migration - Mark as Deprecated

**File:** `packages/db/src/migrations/v1.ts`

Add deprecation comments around the resources table creation:

```typescript
// DEPRECATED: resources table is no longer used. Kept for backwards compatibility.
// Will be dropped in a future migration. See Spec 08.
// Original purpose: Shared working memory and contextual resources.
// Removal reason: Feature was never implemented or used.
```

Add comments around these specific lines:
- `CREATE TABLE IF NOT EXISTS resources` (Lines ~63-69)
- `CREATE INDEX IF NOT EXISTS idx_resources_id` (Line ~115)
- `SELECT crsql_as_crr('resources')` (Line ~123)

### 2. Memory Store - Remove Resource Methods

**File:** `packages/db/src/memory-store.ts`

Remove the following:

1. **`Resource` type definition** (Lines ~16-22)
   ```typescript
   export type Resource = {
     id: string;
     workingMemory?: string;
     metadata?: Record<string, unknown>;
     created_at: Date;
     updated_at: Date;
   };
   ```

2. **`saveResource()` method** (Lines ~181-194)
   - Inserts/updates a resource record
   - Zero callers in codebase

3. **`getResource()` method** (Lines ~196-213)
   - Retrieves single resource (LIMIT 1)
   - Zero callers in codebase

4. **`setResource()` method** (Lines ~215-234)
   - Sets working memory with fixed "default" ID
   - Zero callers in codebase

### 3. Package Exports - Remove Type Export

**File:** `packages/db/src/index.ts`

Remove the `Resource` type export:

```typescript
// Before
export type {
  Thread as StorageThreadType,
  Resource as StorageResourceType,  // <-- REMOVE THIS LINE
} from "./memory-store";

// After
export type {
  Thread as StorageThreadType,
} from "./memory-store";
```

## Implementation Checklist

- [ ] Add deprecation comments to `v1.ts` migration for resources table
- [ ] Remove `Resource` type from `memory-store.ts`
- [ ] Remove `saveResource()` from `memory-store.ts`
- [ ] Remove `getResource()` from `memory-store.ts`
- [ ] Remove `setResource()` from `memory-store.ts`
- [ ] Remove `StorageResourceType` export from `index.ts`
- [ ] Run `npm run build` in `packages/db` to regenerate types
- [ ] Verify no TypeScript errors across the monorepo
- [ ] Test that app starts and functions without errors

## Testing

1. App should start without errors
2. TypeScript compilation should succeed
3. No runtime errors related to missing Resource type
4. Database migrations should still run on fresh install

## Future Work

When closer to production, create a migration to:
```sql
DROP TABLE IF EXISTS resources;
```

And remove the deprecated comments and table creation from v1.ts (or leave as documentation).

## Notes

- The `resources` table IS synced via cr-sqlite (CRR enabled), but since it's empty everywhere, dropping it won't cause sync issues
- No tests exist for this functionality
- Zero active usage means this is a safe, low-risk removal
- The `dist/index.d.ts` file will be automatically regenerated on build
