# Spec: Standardize Development Mode Check Pattern

## Problem

The codebase uses two different patterns to check for development mode:
- `import.meta.env.DEV` (Vite's built-in flag) in main.tsx
- `__DEV__` (custom define constant) in worker.ts

This inconsistency requires maintaining a custom `__DEV__` define in vite.config.ts and adds unnecessary type declarations and defensive checks in worker files.

## Solution

Standardize on `import.meta.env.DEV` across the entire codebase. Remove the custom `__DEV__` define constant and update all files that use it.

## Expected Outcome

- All development mode checks use `import.meta.env.DEV`
- The `__DEV__` define constant is removed from vite.config.ts
- No `declare const __DEV__` type declarations remain in the codebase
- Consistent pattern across main app and worker files

## Considerations

- Verify `import.meta.env.DEV` works correctly in web worker context
- Check if any other files use `__DEV__` pattern
