# Spec: Add Explicit Debug Dependency

## Problem

The `debug` package is imported in multiple files within apps/web/src but is not listed as an explicit dependency in apps/web/package.json. It currently works only because it's a transitive dependency from workspace packages (packages/db, packages/sync, etc.).

This creates fragility - if workspace dependencies are restructured, the import could break.

## Solution

Add `debug` as an explicit dependency in apps/web/package.json.

## Expected Outcome

- `debug` is listed in apps/web/package.json dependencies
- The app no longer relies on transitive dependencies for this import
- Build remains stable even if workspace package dependencies change

## Considerations

- Match the version used by other workspace packages for consistency
