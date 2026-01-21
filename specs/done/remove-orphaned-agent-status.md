# Spec: Remove orphaned agent status infrastructure

## Problem

The old agent status system is orphaned - `startStatusUpdater()` was removed but the supporting infrastructure remains:

- `setAgentStatus()` in api.ts - never called
- `getAgentStatus()` in api.ts - only called by frontend, always returns empty
- `useAgentStatus()` hook - polls every 5 seconds for data that never changes
- SharedHeader.tsx status display - always shows empty
- Remaining commented references in task-worker.ts (statusUpdaterInterval, startStatusUpdater call, cleanup code)
- Dead file: packages/agent/src/interfaces.ts (only contains unused Memory interface)

## Solution

Remove all orphaned agent status code:

1. Delete `setAgentStatus()` and `getAgentStatus()` from packages/db/src/api.ts
2. Remove `useAgentStatus()` hook from apps/web/src/hooks/dbApiReads.ts
3. Remove agent status display from SharedHeader.tsx
4. Remove remaining commented references in task-worker.ts (lines ~109, ~138, ~402-404)
5. Delete packages/agent/src/interfaces.ts entirely

## Expected Outcome

- No dead code polling for status that never updates
- Cleaner codebase without misleading status infrastructure
- Agent status can be re-implemented fresh based on active runs (see ideas/agent-status-from-active-runs.md)

## Considerations

- The agent_state table may be used for other purposes (autonomy mode) - verify before removing table
- Keep the table if other data is stored there, just remove the status-specific code
