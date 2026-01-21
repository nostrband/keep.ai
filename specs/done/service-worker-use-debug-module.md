# Spec: Use debug module in service-worker

## Problem

service-worker.ts uses a custom `DEBUG_SW = false` constant with a `debugLog()` wrapper function, while all other workers use the standard `debug` module with namespaces. This creates inconsistency:

- DEBUG_SW is hardcoded to `false`, requiring code changes to enable logging
- No runtime control via DEBUG environment variable
- No namespace filtering capability (can't do `DEBUG=keep:service-worker`)
- Different developer experience compared to other workers

## Solution

Replace the custom DEBUG_SW/debugLog pattern in service-worker.ts with the standard `debug` module, matching the pattern used in shared-worker.ts, worker.ts, and lib/worker.ts.

## Expected Outcome

- service-worker.ts uses `debug("keep:service-worker")` for logging
- Debug logging can be controlled at runtime like other workers
- Consistent debugging experience across all worker types
- Remove the hardcoded DEBUG_SW constant and debugLog wrapper

## Considerations

- Service workers have different execution context - verify debug module works correctly there
- May need to check if debug.enable() pattern is needed for service worker context
