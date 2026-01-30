# Logical Items Implementation - v1

This spec covers the implementation of logical items infrastructure for Keep.AI, based on docs/dev/12-logical-items.md.

**Scope**: withItem API, item ledger, tool wrapper refactor, callback support in sandbox.

**Out of scope**: Reconciliation (ch.13), idempotency (ch.14), escalation UI, code reviewer stages.

---

## 1. Overview

Logical items are the fundamental unit of work in Keep.AI automations. This implementation provides:

- `Items.withItem(id, title, handler)` - JavaScript API for scripts
- Item ledger (database) - tracks item state per workflow
- Callback support in sandbox - allows host to invoke guest functions
- Tool wrapper refactor - cleaner tool registration with metadata

### Item States (v1)

| Status | Description |
|--------|-------------|
| `processing` | Handler is executing |
| `done` | Handler completed successfully |
| `failed` | Handler threw an error |
| `skipped` | User explicitly skipped (manual action, not implemented in v1) |

Note: `needs_attention` requires reconciliation logic (out of scope for v1).

---

## 2. Sandbox Callback Support

### 2.1 Problem

Currently, when a guest script passes a callback to a host function, `ctx.dump(handle)` loses the callable nature of the function. We need host functions to be able to invoke guest callbacks.

### 2.2 Solution

Modify `sandbox.ts` to detect function handles and wrap them as host-callable functions.

**File**: `packages/agent/src/sandbox/sandbox.ts`

Add method to wrap guest callbacks:

```typescript
/**
 * Wrap a guest function handle as a host-callable async function.
 * The returned function can be called from host code and will execute
 * the guest function in the QuickJS context.
 */
private wrapGuestCallback(
  ctx: QuickJSContext,
  fnHandle: QuickJSHandle
): (...args: unknown[]) => Promise<unknown> {
  // Keep a reference to dispose later
  const ownedHandle = fnHandle.dup();

  return async (...hostArgs: unknown[]): Promise<unknown> => {
    this.#ensureAlive();

    // Convert host args to guest handles
    const argHandles = hostArgs.map((arg) =>
      this.hostValueToHandle(ctx, arg, "callback-arg")
    );

    try {
      // Call the guest function
      const callResult = ctx.callFunction(ownedHandle, ctx.undefined, ...argHandles);

      if ("error" in callResult) {
        const errorValue = ctx.dump(callResult.error);
        callResult.error.dispose();
        throw new Error(String(errorValue));
      }

      const resultHandle = callResult.value;

      // Check if result is a promise
      const resultType = ctx.typeof(resultHandle);
      if (resultType === "object") {
        // Try to resolve as promise
        const promiseState = ctx.getPromiseState(resultHandle);
        if (promiseState.type === "pending") {
          // Wait for promise to resolve
          const resolved = await this.#awaitGuestPromise(resultHandle);
          return resolved;
        }
      }

      // Dump and return the result
      const result = ctx.dump(resultHandle);
      resultHandle.dispose();
      return result;
    } finally {
      argHandles.forEach(h => h.dispose());
    }
  };
}
```

Modify `createFunctionHandle` to detect and wrap callback arguments:

```typescript
private createFunctionHandle(
  ctx: QuickJSContext,
  fn: (...args: unknown[]) => unknown,
  name: string
): QuickJSHandle {
  const functionName = name || "fn";

  return ctx.newFunction(functionName, (...argHandles) => {
    // Convert args, preserving functions as callable wrappers
    const args = argHandles.map((handle) => {
      const handleType = ctx.typeof(handle);
      if (handleType === "function") {
        // Wrap guest function as host-callable
        return this.wrapGuestCallback(ctx, handle);
      }
      return ctx.dump(handle);
    });

    // ... rest of existing implementation
  });
}
```

### 2.3 Promise Handling

Add helper method for awaiting guest promises (similar to existing eval logic):

```typescript
async #awaitGuestPromise(promiseHandle: QuickJSHandle): Promise<unknown> {
  const ctx = this.#ctx;

  // Execute pending jobs until promise settles
  while (true) {
    const state = ctx.getPromiseState(promiseHandle);

    if (state.type === "fulfilled") {
      const result = ctx.dump(state.value);
      state.value.dispose();
      promiseHandle.dispose();
      return result;
    }

    if (state.type === "rejected") {
      const error = ctx.dump(state.reason);
      state.reason.dispose();
      promiseHandle.dispose();
      throw new Error(String(error));
    }

    // Execute pending jobs
    const execResult = this.#rt.executePendingJobs();
    if (execResult.error) {
      const errorVal = ctx.dump(execResult.error);
      execResult.error.dispose();
      throw new Error(String(errorVal));
    }

    // Yield to allow async operations to complete
    await new Promise(resolve => queueMicrotask(resolve));
  }
}
```

---

## 3. Tool Interface Refactor

### 3.1 New Tool Type

Remove dependency on `tool()` from 'ai' package. Define our own tool interface.

**File**: `packages/agent/src/tools/types.ts` (NEW)

```typescript
import { z } from "zod";

/**
 * Tool definition for sandbox-executable tools.
 * Replaces the 'tool()' helper from 'ai' package.
 */
export interface Tool<TInput = any, TOutput = any> {
  /** Tool namespace (e.g., "Gmail", "Memory", "Files") */
  namespace: string;

  /** Tool name within namespace (e.g., "api", "getNote", "read") */
  name: string;

  /** Human-readable description for documentation */
  description: string;

  /** Zod schema for input validation */
  inputSchema: z.ZodType<TInput>;

  /** Optional Zod schema for output validation */
  outputSchema?: z.ZodType<TOutput>;

  /** Execute the tool with validated input */
  execute: (input: TInput) => Promise<TOutput>;

  /**
   * Determine if a tool call with given params is read-only.
   * If absent, all calls are assumed to be mutations (writes).
   * Used by withItem to enforce mutation restrictions.
   */
  isReadOnly?: (params: TInput) => boolean;
}

/**
 * Tool that is always read-only (no mutations).
 */
export interface ReadOnlyTool<TInput = any, TOutput = any>
  extends Omit<Tool<TInput, TOutput>, 'isReadOnly'> {
  isReadOnly: true;
}

/**
 * Helper to create a tool definition.
 */
export function defineTool<TInput, TOutput>(
  config: Tool<TInput, TOutput>
): Tool<TInput, TOutput> {
  return config;
}

/**
 * Helper to create a read-only tool definition.
 */
export function defineReadOnlyTool<TInput, TOutput>(
  config: Omit<Tool<TInput, TOutput>, 'isReadOnly'>
): Tool<TInput, TOutput> {
  return { ...config, isReadOnly: () => true };
}
```

### 3.2 Update Existing Tools

Each `makeXxxTool` function returns a `Tool` object with namespace and name.

**Example**: `packages/agent/src/tools/gmail.ts` (dynamic read/write)

```typescript
import { defineTool } from "./types";

const READ_METHODS = [
  "users.messages.list",
  "users.messages.get",
  "users.messages.attachments.get",
  "users.history.list",
  "users.threads.get",
  "users.threads.list",
  "users.getProfile",
] as const;

const WRITE_METHODS = [
  "users.messages.send",
  "users.messages.modify",
  "users.messages.trash",
  "users.drafts.create",
  "users.drafts.send",
] as const;

export function makeGmailTool(
  getContext: () => EvalContext,
  connectionManager: ConnectionManager
): Tool {
  return defineTool({
    namespace: "Gmail",
    name: "api",
    description: `Access Gmail API with various methods.

⚠️ MUTATION INFO:
- Read methods (can use outside Items.withItem): ${READ_METHODS.join(', ')}
- Write methods (MUST use inside Items.withItem): ${WRITE_METHODS.join(', ')}`,
    inputSchema: z.object({
      method: z.enum([...READ_METHODS, ...WRITE_METHODS]),
      params: z.any().optional(),
      account: z.string(),
    }),
    isReadOnly: (params) => READ_METHODS.includes(params.method),
    execute: async (input) => {
      // ... existing implementation
    },
  });
}
```

**Example**: `packages/agent/src/tools/get-note.ts` (read-only)

```typescript
import { defineReadOnlyTool } from "./types";

export function makeGetNoteTool(noteStore: NoteStore): Tool {
  return defineReadOnlyTool({
    namespace: "Memory",
    name: "getNote",
    description: `Get a note by ID.

ℹ️ Not a mutation - can be used outside Items.withItem().`,
    inputSchema: z.object({ id: z.string() }),
    outputSchema: NoteSchema.nullable(),
    execute: async (input) => {
      return noteStore.getNote(input.id);
    },
  });
}
```

**Example**: `packages/agent/src/tools/create-note.ts` (write)

```typescript
import { defineTool } from "./types";

export function makeCreateNoteTool(noteStore: NoteStore, getContext: () => EvalContext): Tool {
  return defineTool({
    namespace: "Memory",
    name: "createNote",
    description: `Create a new note in memory.

⚠️ MUTATION - must be called inside Items.withItem().`,
    inputSchema: z.object({
      title: z.string(),
      content: z.string(),
    }),
    isReadOnly: () => false,
    execute: async (input) => {
      // ... implementation
    },
  });
}
```

### 3.3 Mutation Documentation in Descriptions

Every tool description MUST include mutation info so planner/maintainer know whether to use it inside `Items.withItem()`:

**Read-only tools** - add to description:
```
ℹ️ Not a mutation - can be used outside Items.withItem().
```

**Write tools** - add to description:
```
⚠️ MUTATION - must be called inside Items.withItem().
```

**Dynamic tools** (like Gmail) - list methods explicitly:
```
⚠️ MUTATION INFO:
- Read methods (can use outside Items.withItem): users.messages.list, users.messages.get, ...
- Write methods (MUST use inside Items.withItem): users.messages.send, users.messages.modify, ...
```

This ensures the LLM sees mutation requirements in `getDocs()` output and can generate correct code.

### 3.4 Tool Categories

Classify all tools as read-only or write:

**Read-only tools** (isReadOnly: true):
- Memory: getNote, listNotesMetadata, searchNotes
- Files: read, list, search
- Web: search, fetchParse
- Scripts: get, list, history, listScriptRuns, getScriptRun
- Gmail/GDrive/GSheets/GDocs/Notion: when method is read operation
- Utils: weather, atob
- Images: generate, explain, transform (LLM calls, no external state mutation)
- Text: extract, classify, summarize, generate (LLM calls, no external state mutation)
- PDF: explain
- Audio: explain
- Items: list

**Write tools** (isReadOnly: false or dynamic):
- Memory: createNote, updateNote, deleteNote
- Files: save
- Web: download
- Users: send
- Console: log (side effect but allowed outside withItem - see 5.5)
- Gmail/GDrive/GSheets/GDocs/Notion: when method is write operation

Note: "Side effects" in this context means mutations to external state that may need reconciliation and idempotency tracking. LLM API calls (Text.*, Images.*) don't mutate user-controlled external state and are therefore read-only. Privacy concerns around LLM data access are orthogonal to the withItem mutation tracking model.

### 3.5 Scripts.* Tools Availability

Scripts.* tools are only available in task mode (planner/maintainer), not in workflow mode.

Add to tool description:
```
⚠️ This tool is only available during planning/maintenance. Do not use in production scripts.
```

---

## 4. ToolWrapper Refactor

### 4.1 Rename and Restructure

**Rename**: `packages/agent/src/sandbox/api.ts` → `packages/agent/src/sandbox/tool-wrapper.ts`

**Rename class**: `SandboxAPI` → `ToolWrapper`

### 4.2 Constructor Changes

```typescript
export interface ToolWrapperConfig {
  tools: Tool[];
  api: KeepDbApi;
  getContext: () => EvalContext;

  // Workflow-specific config
  workflowId?: string;
  scriptRunId?: string;
  abortController?: AbortController;

  // Task-specific config
  taskRunId?: string;
  taskType?: 'planner' | 'maintainer';

  // Shared
  connectionManager?: ConnectionManager;
  userPath?: string;
}

export class ToolWrapper {
  private tools: Tool[];
  private api: KeepDbApi;
  private getContext: () => EvalContext;
  private workflowId?: string;
  private scriptRunId?: string;
  private taskRunId?: string;
  private taskType?: 'planner' | 'maintainer';
  private abortController?: AbortController;
  private connectionManager?: ConnectionManager;
  private userPath?: string;

  // Item tracking
  private activeItem: { id: string; title: string } | null = null;

  constructor(config: ToolWrapperConfig) {
    this.tools = config.tools;
    this.api = config.api;
    this.getContext = config.getContext;
    this.workflowId = config.workflowId;
    this.scriptRunId = config.scriptRunId;
    this.taskRunId = config.taskRunId;
    this.taskType = config.taskType;
    this.abortController = config.abortController;
    this.connectionManager = config.connectionManager;
    this.userPath = config.userPath;
  }

  // ...
}
```

### 4.3 Dynamic Namespace Building

```typescript
async createGlobal(): Promise<EvalGlobal> {
  const global: any = {};
  const toolDocs = new Map<string, string>();

  // Group tools by namespace
  for (const tool of this.tools) {
    if (!(tool.namespace in global)) {
      global[tool.namespace] = {};
    }

    // Create wrapped function
    global[tool.namespace][tool.name] = this.wrapTool(tool);

    // Build documentation
    const doc = this.buildToolDoc(tool);
    toolDocs.set(`${tool.namespace}.${tool.name}`, doc);
  }

  // Add built-in Items.withItem
  global.Items = {
    withItem: this.createWithItemFunction(),
  };

  // Add getDocs helper
  global.getDocs = (name: string) => { /* ... */ };

  this.toolDocs = toolDocs;
  return global;
}
```

### 4.4 Tool List Helpers

**File**: `packages/agent/src/sandbox/tool-lists.ts` (NEW)

```typescript
import { Tool } from "../tools/types";
import { KeepDbApi } from "@app/db";
import { ConnectionManager } from "@app/connectors";
import { EvalContext } from "./sandbox";
import {
  makeGetNoteTool,
  makeListNotesTool,
  // ... all tool imports
} from "../tools";

export interface ToolListConfig {
  api: KeepDbApi;
  getContext: () => EvalContext;
  connectionManager?: ConnectionManager;
  userPath?: string;
}

/**
 * Create tool list for workflow execution.
 * Excludes Scripts.* tools (introspection not needed in production).
 */
export function createWorkflowTools(config: ToolListConfig): Tool[] {
  const { api, getContext, connectionManager, userPath } = config;

  const tools: Tool[] = [
    // Console
    makeConsoleLogTool(getContext),

    // Memory
    makeGetNoteTool(api.noteStore),
    makeListNotesTool(api.noteStore),
    makeSearchNotesTool(api.noteStore),
    makeCreateNoteTool(api.noteStore, getContext),
    makeUpdateNoteTool(api.noteStore, getContext),
    makeDeleteNoteTool(api.noteStore, getContext),

    // Files
    makeReadFileTool(api.fileStore, userPath),
    makeSaveFileTool(api.fileStore, userPath, getContext),
    makeListFilesTool(api.fileStore),
    makeSearchFilesTool(api.fileStore),

    // Web
    makeWebSearchTool(getContext),
    makeWebFetchTool(getContext),
    makeWebDownloadTool(api.fileStore, userPath, getContext),

    // Utils
    makeGetWeatherTool(getContext),
    makeAtobTool(),

    // Images
    makeImagesGenerateTool(api.fileStore, userPath, getContext),
    makeImagesExplainTool(api.fileStore, userPath, getContext),
    makeImagesTransformTool(api.fileStore, userPath, getContext),

    // PDF, Audio
    makePdfExplainTool(api.fileStore, userPath, getContext),
    makeAudioExplainTool(api.fileStore, userPath, getContext),

    // Text
    makeTextExtractTool(getContext),
    makeTextClassifyTool(getContext),
    makeTextSummarizeTool(getContext),
    makeTextGenerateTool(getContext),

    // Users
    makeUserSendTool(api, undefined), // workflow context added separately
  ];

  // Connector tools (if available)
  if (connectionManager) {
    tools.push(
      makeGmailTool(getContext, connectionManager),
      makeGDriveTool(getContext, connectionManager),
      makeGSheetsTool(getContext, connectionManager),
      makeGDocsTool(getContext, connectionManager),
      makeNotionTool(getContext, connectionManager),
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

  // Add Scripts.* tools (marked as not for production)
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

---

## 5. withItem Implementation

### 5.1 Items Table Schema

**File**: `packages/db/src/migrations/v34.ts` (NEW)

```typescript
export async function migrateV34(tx: Transaction) {
  await tx.exec(`PRAGMA user_version = 34`);

  await tx.exec(`
    CREATE TABLE IF NOT EXISTS items (
      id TEXT PRIMARY KEY NOT NULL DEFAULT '',
      workflow_id TEXT NOT NULL DEFAULT '',
      logical_item_id TEXT NOT NULL DEFAULT '',
      title TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'processing',
      current_attempt_id INTEGER NOT NULL DEFAULT 1,
      created_by TEXT NOT NULL DEFAULT 'workflow',
      created_by_run_id TEXT NOT NULL DEFAULT '',
      last_run_id TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL DEFAULT 0,
      UNIQUE(workflow_id, logical_item_id)
    )
  `);

  await tx.exec(
    `CREATE INDEX IF NOT EXISTS idx_items_workflow ON items(workflow_id)`
  );
  await tx.exec(
    `CREATE INDEX IF NOT EXISTS idx_items_status ON items(workflow_id, status)`
  );

  await tx.exec("SELECT crsql_as_crr('items')");
}
```

**Columns**:
- `id`: Generated unique ID (primary key)
- `workflow_id`: Owning workflow
- `logical_item_id`: Stable identifier chosen by script
- `title`: Human-readable description
- `status`: 'processing' | 'done' | 'failed' | 'skipped'
- `current_attempt_id`: Monotonically increasing attempt counter
- `created_by`: 'workflow' | 'planner' | 'maintainer'
- `created_by_run_id`: Run ID that first created this item
- `last_run_id`: Run ID that last changed this item's state
- `created_at`, `updated_at`: Timestamps

### 5.2 ItemStore

**File**: `packages/db/src/item-store.ts` (NEW)

```typescript
import { generateId } from "ai";
import { DBInterface } from "./interfaces";

export type ItemStatus = 'processing' | 'done' | 'failed' | 'skipped';
export type ItemCreatedBy = 'workflow' | 'planner' | 'maintainer';

export interface Item {
  id: string;
  workflow_id: string;
  logical_item_id: string;
  title: string;
  status: ItemStatus;
  current_attempt_id: number;
  created_by: ItemCreatedBy;
  created_by_run_id: string;
  last_run_id: string;
  created_at: number;
  updated_at: number;
}

export interface ItemStore {
  /**
   * Get an item by workflow ID and logical item ID.
   */
  getItem(workflowId: string, logicalItemId: string): Promise<Item | null>;

  /**
   * Get or create an item, setting status to 'processing'.
   * If item exists and is 'done', returns it unchanged (for isDone check).
   * If item exists and is 'failed', resets to 'processing' for retry.
   */
  startItem(
    workflowId: string,
    logicalItemId: string,
    title: string,
    createdBy: ItemCreatedBy,
    runId: string
  ): Promise<Item>;

  /**
   * Update item status.
   */
  setStatus(
    workflowId: string,
    logicalItemId: string,
    status: ItemStatus,
    runId: string
  ): Promise<void>;

  /**
   * List items for a workflow.
   */
  listItems(
    workflowId: string,
    options?: { status?: ItemStatus; limit?: number; offset?: number }
  ): Promise<Item[]>;

  /**
   * Count items by status for a workflow.
   */
  countByStatus(workflowId: string): Promise<Record<ItemStatus, number>>;
}

export function createItemStore(db: DBInterface): ItemStore {
  return {
    async getItem(workflowId, logicalItemId) {
      const row = await db.get<Item>(
        `SELECT * FROM items WHERE workflow_id = ? AND logical_item_id = ?`,
        [workflowId, logicalItemId]
      );
      return row || null;
    },

    async startItem(workflowId, logicalItemId, title, createdBy, runId) {
      const now = Date.now();

      // Check if item exists
      const existing = await this.getItem(workflowId, logicalItemId);

      if (existing) {
        // If done, return as-is (caller checks isDone)
        if (existing.status === 'done') {
          return existing;
        }

        // If failed/skipped, reset to processing (retry)
        await db.run(
          `UPDATE items SET
            status = 'processing',
            title = ?,
            last_run_id = ?,
            updated_at = ?
          WHERE workflow_id = ? AND logical_item_id = ?`,
          [title, runId, now, workflowId, logicalItemId]
        );

        return {
          ...existing,
          status: 'processing',
          title,
          last_run_id: runId,
          updated_at: now,
        };
      }

      // Create new item
      const id = generateId();
      await db.run(
        `INSERT INTO items (
          id, workflow_id, logical_item_id, title, status,
          current_attempt_id, created_by, created_by_run_id, last_run_id,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, 'processing', 1, ?, ?, ?, ?, ?)`,
        [id, workflowId, logicalItemId, title, createdBy, runId, runId, now, now]
      );

      return {
        id,
        workflow_id: workflowId,
        logical_item_id: logicalItemId,
        title,
        status: 'processing',
        current_attempt_id: 1,
        created_by: createdBy,
        created_by_run_id: runId,
        last_run_id: runId,
        created_at: now,
        updated_at: now,
      };
    },

    async setStatus(workflowId, logicalItemId, status, runId) {
      const now = Date.now();
      await db.run(
        `UPDATE items SET status = ?, last_run_id = ?, updated_at = ?
         WHERE workflow_id = ? AND logical_item_id = ?`,
        [status, runId, now, workflowId, logicalItemId]
      );
    },

    async listItems(workflowId, options = {}) {
      let query = `SELECT * FROM items WHERE workflow_id = ?`;
      const params: any[] = [workflowId];

      if (options.status) {
        query += ` AND status = ?`;
        params.push(options.status);
      }

      query += ` ORDER BY created_at DESC`;

      if (options.limit) {
        query += ` LIMIT ?`;
        params.push(options.limit);
        if (options.offset) {
          query += ` OFFSET ?`;
          params.push(options.offset);
        }
      }

      return db.all<Item>(query, params);
    },

    async countByStatus(workflowId) {
      const rows = await db.all<{ status: ItemStatus; count: number }>(
        `SELECT status, COUNT(*) as count FROM items
         WHERE workflow_id = ? GROUP BY status`,
        [workflowId]
      );

      const result: Record<ItemStatus, number> = {
        processing: 0,
        done: 0,
        failed: 0,
        skipped: 0,
      };

      for (const row of rows) {
        result[row.status] = row.count;
      }

      return result;
    },
  };
}
```

### 5.3 Items.list Tool

**File**: `packages/agent/src/tools/items-list.ts` (NEW)

A regular tool (not built-in) that allows scripts to introspect processed items for positioning within their input dataset.

```typescript
import { z } from "zod";
import { defineReadOnlyTool } from "./types";
import { ItemStore, ItemStatus } from "@app/db";

const ItemStatusEnum = z.enum(['processing', 'done', 'failed', 'skipped']);

const ItemSchema = z.object({
  id: z.string(),
  logical_item_id: z.string(),
  title: z.string(),
  status: ItemStatusEnum,
  current_attempt_id: z.number(),
  created_at: z.number(),
  updated_at: z.number(),
});

export function makeItemsListTool(
  itemStore: ItemStore,
  getWorkflowId: () => string | undefined
) {
  return defineReadOnlyTool({
    namespace: "Items",
    name: "list",
    description: `List logical items for the current workflow with optional filtering and pagination.
Use this to check which items have been processed, failed, or are pending.
Useful for resuming work or understanding progress through a dataset.

Example: Check if an item was already processed:
  const items = await Items.list({ logical_item_id: 'email:abc123' });
  const alreadyDone = items.items.some(i => i.status === 'done');

Example: Get all failed items for retry logic:
  const failed = await Items.list({ status: 'failed', limit: 100 });

Example: Paginate through all done items:
  let offset = 0;
  while (true) {
    const page = await Items.list({ status: 'done', limit: 50, offset });
    if (page.items.length === 0) break;
    // process page.items
    offset += page.items.length;
  }`,
    inputSchema: z.object({
      status: ItemStatusEnum.optional().describe(
        "Filter by item status: 'processing', 'done', 'failed', 'skipped'"
      ),
      logical_item_id: z.string().optional().describe(
        "Filter by exact logical item ID (useful to check if specific item exists)"
      ),
      limit: z.number().min(1).max(1000).default(100).describe(
        "Maximum number of items to return (default: 100, max: 1000)"
      ),
      offset: z.number().min(0).default(0).describe(
        "Number of items to skip for pagination (default: 0)"
      ),
    }),
    outputSchema: z.object({
      items: z.array(ItemSchema),
      total: z.number().describe("Total count matching the filter (for pagination)"),
      has_more: z.boolean().describe("Whether there are more items beyond this page"),
    }),
    execute: async (input) => {
      const workflowId = getWorkflowId();
      if (!workflowId) {
        throw new Error("Items.list requires a workflow context");
      }

      const { status, logical_item_id, limit, offset } = input;

      // If filtering by specific logical_item_id, use getItem
      if (logical_item_id) {
        const item = await itemStore.getItem(workflowId, logical_item_id);
        if (!item) {
          return { items: [], total: 0, has_more: false };
        }
        // Apply status filter if provided
        if (status && item.status !== status) {
          return { items: [], total: 0, has_more: false };
        }
        return {
          items: [{
            id: item.id,
            logical_item_id: item.logical_item_id,
            title: item.title,
            status: item.status,
            current_attempt_id: item.current_attempt_id,
            created_at: item.created_at,
            updated_at: item.updated_at,
          }],
          total: 1,
          has_more: false,
        };
      }

      // Get items with pagination
      const items = await itemStore.listItems(workflowId, {
        status,
        limit: limit + 1, // Fetch one extra to check has_more
        offset,
      });

      const has_more = items.length > limit;
      const resultItems = has_more ? items.slice(0, limit) : items;

      // Get total count for pagination info
      const counts = await itemStore.countByStatus(workflowId);
      const total = status ? counts[status] : Object.values(counts).reduce((a, b) => a + b, 0);

      return {
        items: resultItems.map(item => ({
          id: item.id,
          logical_item_id: item.logical_item_id,
          title: item.title,
          status: item.status,
          current_attempt_id: item.current_attempt_id,
          created_at: item.created_at,
          updated_at: item.updated_at,
        })),
        total,
        has_more,
      };
    },
  });
}
```

Add to tool lists:

```typescript
// In createWorkflowTools and createTaskTools:
makeItemsListTool(api.itemStore, () => config.workflowId),
```

### 5.4 withItem Function in ToolWrapper

```typescript
// In ToolWrapper class

/**
 * ItemContext passed to withItem handler.
 */
interface ItemContext {
  item: {
    id: string;
    title: string;
    isDone: boolean;
  };
}

private createWithItemFunction() {
  return async (
    logicalItemId: string,
    title: string,
    handler: (ctx: ItemContext) => Promise<unknown>
  ): Promise<unknown> => {
    // Validate inputs
    if (typeof logicalItemId !== 'string' || !logicalItemId) {
      return this.abortWithLogicError('Items.withItem: id must be a non-empty string');
    }
    if (typeof title !== 'string' || !title) {
      return this.abortWithLogicError('Items.withItem: title must be a non-empty string');
    }
    if (typeof handler !== 'function') {
      return this.abortWithLogicError('Items.withItem: handler must be a function');
    }

    // Check for nested/concurrent withItem (logic error)
    if (this.activeItem !== null) {
      return this.abortWithLogicError(
        `Items.withItem: cannot nest or run concurrent withItem calls. ` +
        `Already processing item "${this.activeItem.id}". ` +
        `Ensure withItem calls are sequential and not nested.`
      );
    }

    // Get workflow context
    const workflowId = this.workflowId;
    if (!workflowId) {
      return this.abortWithLogicError(
        'Items.withItem: no workflow context. withItem requires a workflow.'
      );
    }

    // Determine run ID and created_by
    const runId = this.scriptRunId || this.taskRunId || '';
    const createdBy: ItemCreatedBy = this.taskType || 'workflow';

    // Start item (creates or updates status to 'processing')
    const item = await this.api.itemStore.startItem(
      workflowId,
      logicalItemId,
      title,
      createdBy,
      runId
    );

    const isDone = item.status === 'done';

    // Set active item
    this.activeItem = { id: logicalItemId, title };

    // Create context for handler
    const ctx: ItemContext = {
      item: {
        id: logicalItemId,
        title,
        isDone,
      },
    };

    try {
      // Execute handler
      const result = await handler(ctx);

      // Only update status if item wasn't already done
      if (!isDone) {
        await this.api.itemStore.setStatus(workflowId, logicalItemId, 'done', runId);
      }

      return result;
    } catch (error) {
      // Only update status if item wasn't already done
      if (!isDone) {
        await this.api.itemStore.setStatus(workflowId, logicalItemId, 'failed', runId);
      }
      throw error;
    } finally {
      this.activeItem = null;
    }
  };
}

private abortWithLogicError(message: string): never {
  const error = new LogicError(message, { source: 'Items.withItem' });

  if (this.abortController) {
    this.getContext().classifiedError = error;
    this.abortController.abort(message);
  }

  throw error;
}
```

### 5.5 Mutation Enforcement

In the tool wrapper, check for mutations outside withItem:

```typescript
private wrapTool(tool: Tool) {
  return async (input: any) => {
    // Check workflow active (existing logic)
    await this.checkWorkflowActive();

    // Validate input (existing logic)
    let validatedInput = input;
    if (tool.inputSchema) {
      try {
        validatedInput = tool.inputSchema.parse(input);
      } catch (error) {
        return this.abortWithLogicError(
          `Invalid input for ${tool.namespace}.${tool.name}...`
        );
      }
    }

    // Check mutation restrictions
    const isReadOnly = tool.isReadOnly?.(validatedInput) ?? false;

    if (!isReadOnly) {
      // This is a mutation - enforce withItem requirement
      this.enforceMutationRestrictions(tool);
    }

    // Execute tool (existing logic)
    // ...
  };
}

private enforceMutationRestrictions(tool: Tool) {
  // Skip enforcement for Console.log (allowed outside withItem)
  if (tool.namespace === 'Console' && tool.name === 'log') {
    return;
  }

  // Mutations require active item scope
  if (this.activeItem === null) {
    this.abortWithLogicError(
      `${tool.namespace}.${tool.name} is a mutation and must be called inside Items.withItem(). ` +
      `Wrap your mutations in a withItem call to track progress.`
    );
  }

  // Check if item is done (spec 14.2.2)
  // Note: This requires tracking isDone state, which we have from startItem
  if (this.activeItemIsDone) {
    this.abortWithLogicError(
      `${tool.namespace}.${tool.name}: cannot perform mutations on completed item "${this.activeItem.id}". ` +
      `Check ctx.item.isDone before attempting mutations.`
    );
  }
}
```

Add tracking for isDone state:

```typescript
// In ToolWrapper class
private activeItem: { id: string; title: string } | null = null;
private activeItemIsDone: boolean = false;

// In createWithItemFunction, after startItem:
this.activeItemIsDone = isDone;

// In finally block:
this.activeItem = null;
this.activeItemIsDone = false;
```

---

## 6. Integration Updates

### 6.1 WorkflowWorker Updates

**File**: `packages/agent/src/workflow-worker.ts`

```typescript
import { ToolWrapper } from "./sandbox/tool-wrapper";
import { createWorkflowTools } from "./sandbox/tool-lists";

// In processWorkflowScript:

const tools = createWorkflowTools({
  api: this.api,
  getContext: () => sandbox.context,
  connectionManager: this.connectionManager,
  userPath: this.userPath,
});

const toolWrapper = new ToolWrapper({
  tools,
  api: this.api,
  getContext: () => sandbox.context,
  workflowId: workflow.id,
  scriptRunId,
  abortController,
  connectionManager: this.connectionManager,
  userPath: this.userPath,
});

const global = await toolWrapper.createGlobal();
sandbox.setGlobal(global);
```

### 6.2 TaskWorker Updates

**File**: `packages/agent/src/task-worker.ts`

Similar updates using `createTaskTools` and passing `taskRunId`/`taskType`.

### 6.3 Database Updates

**File**: `packages/db/src/index.ts`

- Export `ItemStore`, `Item`, `ItemStatus`, `createItemStore`
- Add `itemStore` to `KeepDbApi`

**File**: `packages/db/src/keep-db-api.ts`

```typescript
import { createItemStore, ItemStore } from "./item-store";

export class KeepDbApi {
  // ...
  public readonly itemStore: ItemStore;

  constructor(db: DBInterface) {
    // ...
    this.itemStore = createItemStore(db);
  }
}
```

---

## 7. Prompting Changes

### 7.1 Planner Prompts

Add to planner system prompt:

```
## Logical Items

Scripts must process work in discrete logical items using `Items.withItem()`:

```javascript
for (const email of emails) {
  await Items.withItem(
    `email:${email.id}`,  // Stable ID based on external identifier
    `Email from ${email.from}: "${email.subject}"`,  // Human-readable title
    async (ctx) => {
      // Check if already processed
      if (ctx.item.isDone) {
        Console.log({ type: 'log', line: `Skipping already processed: ${ctx.item.title}` });
        return;
      }

      // Process the item
      await Gmail.api({ method: 'users.messages.modify', ... });
    }
  );
}
```

### Logical Item ID Requirements

IDs must be:
- **Stable**: Same entity → same ID every time
- **Based on external identifiers**: Use `email.id`, `invoice.number`, etc.
- **Independent of volatile data**: No timestamps, counters, or array indices

Good: `email:${messageId}`, `invoice:${invoiceNumber}`, `order:${orderId}|item:${lineItemId}`
Bad: `email:${index}`, `item-${Date.now()}`, `record-${hash(fullObject)}`

### Logical Item Title Requirements

Titles must:
- Include a stable external identifier
- Include a human-recognizable descriptor
- Describe what the item IS, not how it's processed

Good: `Email from alice@example.com: "Invoice December"`
Bad: `Processing item`, `Email #5`, `Invoice updated at 2024-01-19`

### Checking Progress with Items.list

Use Items.list to check processed items and resume from where you left off:

```javascript
// Check if a specific item was already processed
const existing = await Items.list({ logical_item_id: `email:${email.id}` });
if (existing.items.some(i => i.status === 'done')) {
  Console.log({ type: 'log', line: `Skipping ${email.id} - already done` });
  continue;
}

// Get count of completed items for progress reporting
const progress = await Items.list({ status: 'done', limit: 1 });
Console.log({ type: 'log', line: `Processed ${progress.total} items so far` });
```

### Rules

1. All mutations MUST be inside Items.withItem() - mutations outside will abort the script
2. Only ONE Items.withItem can be active at a time - no nesting or parallel withItem calls
3. Always check ctx.item.isDone before mutations to skip already-completed items, attempting a mutation on a done item will abort the script 
4. Items must be independent - processing one must not depend on another's outcome
5. Use Items.list to check progress or resume from a known position
```

### 7.2 Maintainer Prompts

Add to maintainer system prompt:

```
## Logical Item Constraints

When repairing scripts, you MUST NOT modify:
- Logical item ID construction (the first argument to withItem)
- The structure or components of item IDs

You MAY modify:
- Item titles (second argument) for better readability
- Handler logic inside withItem
- Control flow around withItem calls

If a fix requires changing the logical item ID format, this is NOT a repair -
it requires re-planning. Fail explicitly with: "Cannot repair: would change logical item identity" and some explanation.

### Rules

1. All mutations MUST be inside Items.withItem() - mutations outside will abort the script
2. Only ONE Items.withItem can be active at a time - no nesting or parallel withItem calls
3. Always check ctx.item.isDone before mutations to skip already-completed items, attempting a mutation on a done item will abort the script 
4. Items must be independent - processing one must not depend on another's outcome
5. Use Items.list to check progress or resume from a known position
```

---

## 8. File Changes Summary

| File | Change |
|------|--------|
| `packages/agent/src/sandbox/sandbox.ts` | Add `wrapGuestCallback()`, modify `createFunctionHandle()` |
| `packages/agent/src/tools/types.ts` | NEW - Tool interface, defineTool helpers |
| `packages/agent/src/tools/*.ts` | Update all makeXxxTool to use new interface |
| `packages/agent/src/tools/items-list.ts` | NEW - Items.list tool |
| `packages/agent/src/tools/index.ts` | Export types, Items.list |
| `packages/agent/src/sandbox/api.ts` | DELETE (renamed) |
| `packages/agent/src/sandbox/tool-wrapper.ts` | NEW - ToolWrapper class (renamed from SandboxAPI) |
| `packages/agent/src/sandbox/tool-lists.ts` | NEW - createWorkflowTools, createTaskTools |
| `packages/db/src/migrations/v34.ts` | NEW - items table |
| `packages/db/src/item-store.ts` | NEW - ItemStore |
| `packages/db/src/index.ts` | Export item store |
| `packages/db/src/keep-db-api.ts` | Add itemStore |
| `packages/db/src/migrations/index.ts` | Add v34 |
| `packages/agent/src/workflow-worker.ts` | Use ToolWrapper with workflow tools |
| `packages/agent/src/task-worker.ts` | Use ToolWrapper with task tools |
| Planner/maintainer prompts (various) | Add logical items guidance |

---

## 9. Testing

### 9.1 Sandbox Callback Tests

```typescript
// Test: guest callback can be invoked by host
test("host can invoke guest callback", async () => {
  const sandbox = await initSandbox();

  let callbackInvoked = false;
  sandbox.setGlobal({
    testWithCallback: async (cb: () => Promise<number>) => {
      const result = await cb();
      callbackInvoked = true;
      return result * 2;
    },
  });

  const result = await sandbox.eval(`
    await testWithCallback(async () => 42)
  `);

  expect(result).toEqual({ ok: true, result: 84 });
  expect(callbackInvoked).toBe(true);
});
```

### 9.2 withItem Tests

```typescript
// Test: withItem tracks item state
test("withItem creates and completes item", async () => {
  // ... setup sandbox with ToolWrapper

  const result = await sandbox.eval(`
    await Items.withItem('test-1', 'Test Item', async (ctx) => {
      return ctx.item.isDone;
    });
  `);

  expect(result).toEqual({ ok: true, result: false });

  const item = await api.itemStore.getItem(workflowId, 'test-1');
  expect(item?.status).toBe('done');
});

// Test: nested withItem aborts
test("nested withItem aborts with logic error", async () => {
  const result = await sandbox.eval(`
    await Items.withItem('outer', 'Outer', async () => {
      await Items.withItem('inner', 'Inner', async () => {});
    });
  `);

  expect(result.ok).toBe(false);
  expect(result.error).toContain('cannot nest');
});

// Test: mutation outside withItem aborts
test("mutation outside withItem aborts", async () => {
  const result = await sandbox.eval(`
    await Memory.createNote({ title: 'test', content: 'test' });
  `);

  expect(result.ok).toBe(false);
  expect(result.error).toContain('must be called inside Items.withItem');
});
```

---

## 10. Migration Path

1. Implement sandbox callback support (Phase 1)
2. Create Tool interface and update a few tools as proof of concept
3. Create ToolWrapper with withItem support
4. Migrate remaining tools to new interface
5. Create tool-lists.ts with helpers
6. Add items table migration
7. Update workflow-worker and task-worker
8. Update prompts
9. Test end-to-end with planner creating scripts that use withItem
