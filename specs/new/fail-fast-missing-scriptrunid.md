# Spec: Fail Fast on Missing scriptRunId in Maintainer Context

## Problem

In `loadMaintainerContext()`, when scriptRunId is not found in inbox metadata, the function returns a fallback context with empty scriptRunId and "unknown" error type. The maintainer agent will then attempt to fix based on the active script, which may not be the script that actually failed if the planner updated it in the meantime.

This could lead to applying fixes to the wrong script version, wasting a fix attempt.

## Solution

Return undefined when scriptRunId is missing instead of returning a fallback context. The calling code already handles undefined return by finishing the task with an error message.

## Expected Outcome

- Maintainer task fails cleanly when scriptRunId is missing
- No blind fixes attempted on potentially wrong script version
- Clear error message indicates the problem

## Considerations

- Verify calling code properly handles undefined return
- Consider logging a warning when this happens for debugging
