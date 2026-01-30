# Spec: Export MAX_FIX_ATTEMPTS Constant

## Problem

The `MAX_FIX_ATTEMPTS = 3` constant is defined in `workflow-worker.ts` but tests hardcode the same value. If the constant changes in production, tests will continue to pass with stale expectations.

Locations with hardcoded value:
- maintainer-integration.test.ts (lines 499, 591, 695)

## Solution

Export `MAX_FIX_ATTEMPTS` from a shared location (e.g., @app/db constants or export from workflow-worker) and import it in both the implementation and tests.

## Expected Outcome

- Single source of truth for MAX_FIX_ATTEMPTS
- Tests automatically use the correct value if it changes
- No magic numbers in test files

## Considerations

- Decide on the best location for the constant (workflow-worker.ts export vs shared constants file)
