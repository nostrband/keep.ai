# Spec: Early workflow_id Validation for Maintainer Tasks

## Problem

Maintainer tasks require a `workflow_id` to load their execution context, but this requirement is not validated early. If `workflow_id` is missing, the task proceeds without loading context and only fails much later in `Agent.loop()` with the confusing error "Maintainer task requires maintainerContext".

This late failure makes debugging configuration issues difficult.

## Solution

Add early validation in `executeTask()` (task-worker.ts) that checks for `workflow_id` immediately after accepting a maintainer task type. If missing, fail fast with a clear configuration error message.

## Expected Outcome

- Maintainer tasks without `workflow_id` fail immediately with a clear error like "Maintainer task missing workflow_id"
- The error is logged via debug() before task termination
- No change to behavior for properly configured maintainer tasks

## Considerations

- The validation should happen after the type check but before any context loading attempts
- Use the existing `finishTask()` pattern with an appropriate error state
