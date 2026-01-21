# Idea: Agent status derived from active runs

## Overview

Instead of the old approach where task-worker manually called `setAgentStatus()` with strings like "Planning...", "Executing...", derive agent status from actual active task/script runs in the database.

## Concept

Show combined status based on currently running items:
- "2 active tasks, 1 active workflow"
- "1 task running"
- "Idle" (nothing running)

This is more accurate and doesn't require manual status updates that can get out of sync.

## Requirements

1. **Query active runs** - Check task_runs and script_runs tables for items with status indicating they're in progress

2. **Handle orphaned runs on startup** - If the app crashes, runs will be left in "running" state forever. On startup, detect orphaned runs (running state but no actual execution) and auto-finish them with an error status like "interrupted" or "crashed"

3. **UI display** - Show the combined status somewhere (header, tray menu, status bar)

## Open Questions

- Where should status be displayed? (SharedHeader, tray icon tooltip, dedicated status area)
- How to detect orphaned runs? (timestamp threshold, process ID tracking, startup flag)
- Should we show more detail? (which workflows/tasks are running, progress indicators)
