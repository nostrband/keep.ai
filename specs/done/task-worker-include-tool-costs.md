# Spec: Include tool costs in task run cost tracking

## Problem

Task worker currently only saves agent LLM orchestration costs (`opts.agent.openRouterUsage.cost`) when finishing a task run. Tool execution costs accumulated in `sandbox.context.cost` (from text_generate, images_generate, etc.) are not included.

Additionally, TaskEventGroup UI currently sums both `taskRun.cost` and individual event costs, which would cause double-counting if task-worker is fixed.

## Solution

1. When saving task run costs in task-worker, combine both the agent LLM costs and the tool costs from `sandbox.context.cost`
2. Update TaskEventGroup to display only `taskRun.cost` instead of summing it with individual event costs

## Expected Outcome

- task_runs.cost reflects total cost: agent LLM costs + tool execution costs
- TaskEventGroup displays only the stored task run cost (no event cost summing)
- No double-counting of tool costs in the UI
- Consistent cost reporting between task runs and workflow runs

## Considerations

- Workflow-worker correctly uses only `sandbox.context.cost` since workflows don't have agentic LLM costs
- Need to handle cases where sandbox.context may not exist (error paths)
- Individual event costs can still be shown per-event if needed, just not summed into header
