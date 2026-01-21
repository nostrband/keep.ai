# Spec: Add @types/debug to apps/web devDependencies

## Problem

The `debug` package was added as an explicit dependency to apps/web, but `@types/debug` was not added to devDependencies. This creates fragility for TypeScript type checking - it currently relies on the root-level @types/debug which could break if workspace type resolution changes.

## Solution

Add `@types/debug` as an explicit devDependency in apps/web/package.json.

## Expected Outcome

- TypeScript type checking for debug module is independent of root package configuration
- Consistent with other explicit type dependencies in apps/web (@types/react, @types/react-dom, etc.)
