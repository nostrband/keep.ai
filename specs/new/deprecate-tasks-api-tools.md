# Spec: Deprecate Tasks.* tools from sandbox API

## Problem
The task management API (Tasks.*) in the agent sandbox is leftover from the prototype stage and is no longer part of the intended agent workflow. These tools are currently exposed:
- Tasks.get
- Tasks.list
- Tasks.sendToTaskInbox
- Tasks.update

Additionally, there are unexposed but existing tools:
- add-task
- add-task-recurring

This creates confusion about agent capabilities and clutters the API.

## Solution
1. Remove all Tasks.* tool registrations from `packages/agent/src/sandbox/api.ts`
2. Move all task-related tool files to a `deprecated` sub-folder under `packages/agent/src/tools/`
3. Add @deprecated JSDoc comments to the tool factory functions
4. Update agent system prompts in agent-env.ts to remove any references to task management capabilities
5. Update exports in tools/index.ts accordingly (export from deprecated folder or remove)

## Expected Outcome
- No Tasks.* namespace in sandbox API
- Tool files preserved in `packages/agent/src/tools/deprecated/` folder
- System prompts don't mention task management tools
- Clean separation between active and deprecated code

## Considerations
- Verify no other code paths depend on these tools being available
- The tools can be restored later if task management becomes a desired feature
- Update README documentation for the agent package
