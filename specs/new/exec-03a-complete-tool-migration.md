# exec-03a: Complete Tool Migration (api.ts → ToolWrapper)

## Goal

Complete the partially-done tool migration from `specs/done/logical-items.md`. The migration stalled with:
- `tool-wrapper.ts` exists but is NOT used
- `api.ts` still exists and IS used by workers
- `tool-lists.ts` was never created

This spec completes the migration and integrates phase enforcement for the new execution model.

## Current State

| Component | Status | Location |
|-----------|--------|----------|
| `SandboxAPI` (old) | ✅ Active, used by workers | `sandbox/api.ts` |
| `ToolWrapper` (new) | ✅ Exists, NOT used | `sandbox/tool-wrapper.ts` |
| `tool-lists.ts` | ❌ Missing | Should be `sandbox/tool-lists.ts` |
| Tool interface | ✅ Complete | `tools/types.ts` |

## Implementation

### 1. Create tool-lists.ts

**File**: `packages/agent/src/sandbox/tool-lists.ts` (NEW)

```typescript
import { Tool } from "../tools/types";
import { KeepDbApi } from "@app/db";
import { ConnectionManager } from "@app/connectors";
import { EvalContext } from "./sandbox";

// Import all tool makers
import { makeConsoleLogTool } from "../tools/console-log";
import { makeGetNoteTool, makeListNotesTool, makeSearchNotesTool, makeCreateNoteTool, makeUpdateNoteTool, makeDeleteNoteTool } from "../tools/memory";
import { makeReadFileTool, makeSaveFileTool, makeListFilesTool, makeSearchFilesTool } from "../tools/files";
import { makeWebSearchTool, makeWebFetchParseTool, makeWebDownloadTool } from "../tools/web";
import { makeWeatherTool, makeAtobTool } from "../tools/utils";
import { makeImageGenerateTool, makeImageExplainTool, makeImageTransformTool } from "../tools/images";
import { makePdfExplainTool } from "../tools/pdf";
import { makeAudioExplainTool } from "../tools/audio";
import { makeTextExtractTool, makeTextClassifyTool, makeTextSummarizeTool, makeTextGenerateTool } from "../tools/text";
import { makeUsersSendTool } from "../tools/users";
import { makeGmailApiTool } from "../tools/gmail";
import { makeGoogleDriveApiTool } from "../tools/google-drive";
import { makeGoogleSheetsApiTool } from "../tools/google-sheets";
import { makeGoogleDocsApiTool } from "../tools/google-docs";
import { makeNotionApiTool } from "../tools/notion";
import { makeGetScriptTool, makeListScriptsTool, makeScriptHistoryTool, makeListScriptRunsTool, makeGetScriptRunTool } from "../tools/scripts";

export interface ToolListConfig {
  api: KeepDbApi;
  getContext: () => EvalContext;
  connectionManager?: ConnectionManager;
  userPath?: string;
  workflowId?: string;
}

/**
 * Create tool list for workflow/handler execution.
 * Excludes Scripts.* tools (introspection not needed in production).
 */
export function createWorkflowTools(config: ToolListConfig): Tool[] {
  const { api, getContext, connectionManager, userPath } = config;

  const tools: Tool[] = [
    // Console (always allowed)
    makeConsoleLogTool(getContext),

    // Memory
    makeGetNoteTool(api.noteStore),
    makeListNotesTool(api.noteStore),
    makeSearchNotesTool(api.noteStore),
    makeCreateNoteTool(api.noteStore, getContext),
    makeUpdateNoteTool(api.noteStore, getContext),
    makeDeleteNoteTool(api.noteStore, getContext),

    // Files
    makeReadFileTool(userPath),
    makeSaveFileTool(userPath, getContext),
    makeListFilesTool(userPath),
    makeSearchFilesTool(userPath),

    // Web
    makeWebSearchTool(),
    makeWebFetchParseTool(),
    makeWebDownloadTool(userPath, getContext),

    // Utils
    makeWeatherTool(),
    makeAtobTool(),

    // LLM tools (read-only in terms of external state)
    makeImageGenerateTool(userPath, getContext),
    makeImageExplainTool(getContext),
    makeImageTransformTool(userPath, getContext),
    makePdfExplainTool(getContext),
    makeAudioExplainTool(getContext),
    makeTextExtractTool(getContext),
    makeTextClassifyTool(getContext),
    makeTextSummarizeTool(getContext),
    makeTextGenerateTool(getContext),

    // Users (notifications)
    makeUsersSendTool(getContext),
  ];

  // Add connector tools if connection manager available
  if (connectionManager) {
    tools.push(
      makeGmailApiTool(connectionManager, getContext),
      makeGoogleDriveApiTool(connectionManager, getContext),
      makeGoogleSheetsApiTool(connectionManager, getContext),
      makeGoogleDocsApiTool(connectionManager, getContext),
      makeNotionApiTool(connectionManager, getContext),
    );
  }

  return tools;
}

/**
 * Create tool list for task execution (planner/maintainer).
 * Includes Scripts.* tools for introspection.
 */
export function createTaskTools(config: ToolListConfig): Tool[] {
  const { api, getContext } = config;

  // Start with workflow tools
  const tools = createWorkflowTools(config);

  // Add Scripts.* tools for planner/maintainer introspection
  tools.push(
    makeGetScriptTool(api.scriptStore, getContext),
    makeListScriptsTool(api.scriptStore),
    makeScriptHistoryTool(api.scriptStore),
    makeListScriptRunsTool(api.scriptStore, getContext),
    makeGetScriptRunTool(api.scriptStore),
  );

  return tools;
}
```

### 2. Add Phase Tracking to ToolWrapper

**File**: `packages/agent/src/sandbox/tool-wrapper.ts`

Add phase tracking (integrate with exec-04):

```typescript
// Add to ToolWrapper class

type ExecutionPhase = 'producer' | 'prepare' | 'mutate' | 'next' | null;
type OperationType = 'read' | 'mutate' | 'topic_peek' | 'topic_publish';

private currentPhase: ExecutionPhase = null;
private mutationExecuted: boolean = false;
private currentMutation: Mutation | null = null;

setPhase(phase: ExecutionPhase): void {
  this.currentPhase = phase;
  this.mutationExecuted = false;
  this.currentMutation = null;
}

getPhase(): ExecutionPhase {
  return this.currentPhase;
}

setCurrentMutation(mutation: Mutation): void {
  this.currentMutation = mutation;
}

getCurrentMutation(): Mutation | null {
  return this.currentMutation;
}

checkPhaseAllowed(operation: OperationType): void {
  // Skip phase check if not in handler execution (e.g., task mode)
  if (!this.currentPhase) {
    return;
  }

  const allowed: Record<ExecutionPhase, Record<OperationType, boolean>> = {
    producer: { read: true, mutate: false, topic_peek: false, topic_publish: true },
    prepare:  { read: true, mutate: false, topic_peek: true, topic_publish: false },
    mutate:   { read: false, mutate: true, topic_peek: false, topic_publish: false },
    next:     { read: false, mutate: false, topic_peek: false, topic_publish: true },
  };

  if (!allowed[this.currentPhase][operation]) {
    throw new LogicError(`Operation '${operation}' not allowed in '${this.currentPhase}' phase`);
  }

  if (operation === 'mutate') {
    if (this.mutationExecuted) {
      throw new LogicError('Only one mutation allowed per mutate phase');
    }
    this.mutationExecuted = true;
  }
}
```

Update `wrapTool` to check phase:

```typescript
private wrapTool(tool: Tool, doc: ToolDoc) {
  return async (input: unknown) => {
    // ... existing validation ...

    // Check phase restrictions (for handler execution)
    if (this.currentPhase) {
      const isReadOnly = tool.isReadOnly?.(validatedInput) ?? false;
      this.checkPhaseAllowed(isReadOnly ? 'read' : 'mutate');
    }

    // ... existing execution ...
  };
}
```

### 3. Remove Items.withItem from ToolWrapper

Since we're moving to the new execution model, remove:
- `activeItem` and `activeItemIsDone` properties
- `createWithItemFunction()` method
- `enforceMutationRestrictions()` method
- Items.withItem injection in `createGlobal()`

Keep `Items.list` tool for now (can be removed later or repurposed for events).

### 4. Update WorkflowWorker

**File**: `packages/agent/src/workflow-worker.ts`

```typescript
// Change imports
import { ToolWrapper } from "./sandbox/tool-wrapper";
import { createWorkflowTools } from "./sandbox/tool-lists";

// In createSandbox or equivalent:
const tools = createWorkflowTools({
  api: this.api,
  getContext: () => sandbox.context,
  connectionManager: this.connectionManager,
  userPath: this.userPath,
  workflowId: workflow.id,
});

const toolWrapper = new ToolWrapper({
  tools,
  api: this.api,
  getContext: () => sandbox.context,
  connectionManager: this.connectionManager,
  userPath: this.userPath,
  workflowId: workflow.id,
  scriptRunId,
  abortController,
});

const global = await toolWrapper.createGlobal();
sandbox.injectGlobal(global);
```

### 5. Update TaskWorker

**File**: `packages/agent/src/task-worker.ts`

```typescript
// Change imports
import { ToolWrapper } from "./sandbox/tool-wrapper";
import { createTaskTools } from "./sandbox/tool-lists";

// In createSandbox or equivalent:
const tools = createTaskTools({
  api: this.api,
  getContext: () => sandbox.context,
  connectionManager: this.connectionManager,
  userPath: this.userPath,
});

const toolWrapper = new ToolWrapper({
  tools,
  api: this.api,
  getContext: () => sandbox.context,
  connectionManager: this.connectionManager,
  userPath: this.userPath,
  taskRunId,
  taskType: task.type,  // 'planner' | 'maintainer'
  abortController,
});

const global = await toolWrapper.createGlobal();
sandbox.injectGlobal(global);
```

### 6. Deprecate api.ts

**File**: `packages/agent/src/sandbox/api.ts`

Add deprecation notice at top:

```typescript
/**
 * @deprecated Use ToolWrapper from './tool-wrapper' instead.
 * This file is kept for reference only and will be removed.
 */
```

**File**: `packages/agent/src/sandbox/index.ts`

Update exports:

```typescript
// Primary exports
export { ToolWrapper } from './tool-wrapper';
export { createWorkflowTools, createTaskTools } from './tool-lists';

// Deprecated - remove in next major version
export { SandboxAPI } from './api';
```

### 7. Update ToolWrapper Config

Add fields needed for new execution model:

```typescript
interface ToolWrapperConfig {
  tools: Tool[];
  api: KeepDbApi;
  getContext: () => EvalContext;
  connectionManager?: ConnectionManager;
  userPath?: string;

  // Workflow execution
  workflowId?: string;
  scriptRunId?: string;
  handlerRunId?: string;  // NEW: for handler execution

  // Task execution
  taskRunId?: string;
  taskType?: 'planner' | 'maintainer';

  abortController?: AbortController;
}
```

## File Changes Summary

| File | Change |
|------|--------|
| `sandbox/tool-lists.ts` | NEW - createWorkflowTools, createTaskTools |
| `sandbox/tool-wrapper.ts` | Add phase tracking, remove Items.withItem |
| `sandbox/api.ts` | Add deprecation notice |
| `sandbox/index.ts` | Update exports |
| `workflow-worker.ts` | Use ToolWrapper + createWorkflowTools |
| `task-worker.ts` | Use ToolWrapper + createTaskTools |

## Dependencies

- **exec-01**: Database schema (for Mutation type used in phase tracking)
- **exec-02**: Deprecate items (this spec removes Items.withItem from ToolWrapper)
- **exec-03**: Topics API (Topics tools will be added to tool-lists)
- **exec-04**: Phase tracking (integrated into this spec)

## Testing

- Verify createWorkflowTools returns expected tools
- Verify createTaskTools includes Scripts.* tools
- Verify ToolWrapper phase checking works
- Verify workers function correctly with ToolWrapper
- Verify deprecated SandboxAPI still works (backwards compat)
- Run existing tests to ensure no regressions
