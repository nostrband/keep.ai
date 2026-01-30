import { KeepDbApi, TaskType, ItemCreatedBy } from "@app/db";
import {
  makeCreateNoteTool,
  makeDeleteNoteTool,
  makeGetNoteTool,
  makeGetWeatherTool,
  makeListNotesTool,
  makeSearchNotesTool,
  makeUpdateNoteTool,
  makeWebFetchTool,
  makeWebDownloadTool,
  makeWebSearchTool,
  makeReadFileTool,
  makeSaveFileTool,
  makeListFilesTool,
  makeSearchFilesTool,
  makeImagesGenerateTool,
  makeImagesExplainTool,
  makeImagesTransformTool,
  makePdfExplainTool,
  makeAudioExplainTool,
  makeGmailTool,
  makeGDriveTool,
  makeGSheetsTool,
  makeGDocsTool,
  makeNotionTool,
  makeAtobTool,
  makeTextExtractTool,
  makeTextClassifyTool,
  makeTextSummarizeTool,
  makeTextGenerateTool,
  makeUserSendTool,
  makeGetScriptTool,
  makeListScriptsTool,
  makeScriptHistoryTool,
  makeListScriptRunsTool,
  makeGetScriptRunTool,
  makeConsoleLogTool,
  makeItemsListTool,
  ItemContext,
} from "../tools";
import { z, ZodFirstPartyTypeKind as K } from "zod";
import { EvalContext, EvalGlobal } from "./sandbox";
import debug from "debug";
import { ClassifiedError, isClassifiedError, LogicError, WorkflowPausedError } from "../errors";
import type { ConnectionManager } from "@app/connectors";

export interface SandboxAPIConfig {
  api: KeepDbApi;
  type: TaskType | "workflow";
  getContext: () => EvalContext;
  userPath?: string;
  /** Connection manager for OAuth-based tools (Gmail, etc.) */
  connectionManager?: ConnectionManager;
  /** Workflow ID for pause checking and item tracking. When set, tool calls will check if workflow is still active. */
  workflowId?: string;
  /** Script run ID for item tracking. Used to record which run created/updated items. */
  scriptRunId?: string;
  /** Task run ID for item tracking. Used when in task mode (planner/maintainer). */
  taskRunId?: string;
  /**
   * Abort controller for terminating script on fatal errors (workflow mode only).
   * When set along with workflowId, invalid input errors will abort execution immediately
   * to prevent the script from catching and ignoring the error.
   */
  abortController?: AbortController;
}

/**
 * SandboxAPI creates the JavaScript API that gets injected into the sandbox.
 * This is separate from AgentEnv to allow workflows to use the same API without 
 * needing the full agentic loop infrastructure.
 */
export class SandboxAPI {
  private api: KeepDbApi;
  private type: TaskType | "workflow";
  private getContext: () => EvalContext;
  private userPath?: string;
  private connectionManager?: ConnectionManager;
  private workflowId?: string;
  private scriptRunId?: string;
  private taskRunId?: string;
  private abortController?: AbortController;
  private debug = debug("SandboxAPI");
  private toolDocs = new Map<string, string>();

  // Item tracking state for withItem scope enforcement
  private activeItem: { id: string; title: string } | null = null;
  private activeItemIsDone: boolean = false;

  constructor(config: SandboxAPIConfig) {
    this.api = config.api;
    this.type = config.type;
    this.getContext = config.getContext;
    this.userPath = config.userPath;
    this.connectionManager = config.connectionManager;
    this.workflowId = config.workflowId;
    this.scriptRunId = config.scriptRunId;
    this.taskRunId = config.taskRunId;
    this.abortController = config.abortController;
  }

  /**
   * Check if the workflow is still active. Throws WorkflowPausedError if paused.
   * This is called before each tool execution to enable early abort when user pauses.
   */
  private async checkWorkflowActive(): Promise<void> {
    if (!this.workflowId) return;

    try {
      const workflow = await this.api.scriptStore.getWorkflow(this.workflowId);
      if (!workflow || workflow.status !== 'active') {
        this.debug(`Workflow ${this.workflowId} is no longer active (status: ${workflow?.status}), aborting execution`);
        throw new WorkflowPausedError(this.workflowId);
      }
    } catch (error) {
      // If it's already a WorkflowPausedError, re-throw it
      if (error instanceof WorkflowPausedError) {
        throw error;
      }
      // For database errors, log but don't block execution
      this.debug(`Error checking workflow status: ${error}`);
    }
  }

  get tools() {
    return this.toolDocs;
  }

  async createGlobal(): Promise<EvalGlobal> {
    const toolDocs: Map<string, string> = new Map();
    const docs: any = {};
    
    const addTool = (global: any, ns: string, name: string, tool: any) => {
      // Format docs
      const desc = [
        "===DESCRIPTION===",
        tool.description +
          `
Example: await ${ns}.${name}(<input>)
`,
      ];
      if (tool.inputSchema)
        desc.push(...["===INPUT===", printSchema(tool.inputSchema)]);
      if (tool.outputSchema)
        desc.push(...["===OUTPUT===", printSchema(tool.outputSchema)]);
      const doc = desc.join("\n");

      // Init ns
      if (!(ns in global)) global[ns] = {};

      // Create a wrapper function that validates input and output
      global[ns][name] = async (input: any) => {
        // Check if workflow is still active before each tool call
        // This enables early abort when user pauses a running workflow
        await this.checkWorkflowActive();

        // Validate input using inputSchema if present
        let validatedInput = input;
        if (tool.inputSchema) {
          try {
            validatedInput = tool.inputSchema.parse(input);
          } catch (error) {
            this.debug(
              `Bad input for '${ns}.${name}' input ${JSON.stringify(
                input
              )} schema ${tool.inputSchema} error ${error}`
            );

            // NOTE: do not print zod error codes as those are too verbose, we're
            // already printing Usage which is more useful.
            const message = `Invalid input for ${ns}.${name}.\nUsage: ${desc}`;
            const logicError = new LogicError(message, { source: `${ns}.${name}` });

            // In workflow mode, invalid input is a fatal error that must terminate execution.
            // Store the error before abort so it survives the QuickJS boundary.
            if (this.workflowId && this.abortController) {
              this.getContext().classifiedError = logicError;
              this.abortController.abort(message);
            }

            throw logicError;
          }
        }

        // Execute the tool with validated input
        let result: unknown;
        try {
          result = await tool.execute(validatedInput);
          this.debug("Tool called", {
            name,
            input,
            context: this.getContext(),
            result,
          });
        } catch (e) {
          // Preserve classified errors - they contain type information for routing
          if (isClassifiedError(e)) {
            // Add context to message but preserve error type
            const contextMessage = `Failed at ${ns}.${name}: ${e.message}`;
            // Create new error of same type with enhanced message
            const EnhancedError = e.constructor as new (
              message: string,
              options?: { cause?: Error; source?: string }
            ) => ClassifiedError;
            throw new EnhancedError(contextMessage, { cause: e.cause, source: e.source || `${ns}.${name}` });
          }
          // Wrap unclassified errors as LogicError (script bug or unexpected issue)
          const message = `Failed at ${ns}.${name}: ${e}.\nUsage: ${desc}`;
          throw new LogicError(message, {
            cause: e instanceof Error ? e : undefined,
            source: `${ns}.${name}`
          });
        }

        // Validate output using outputSchema if present
        if (tool.outputSchema) {
          try {
            tool.outputSchema.parse(result);
          } catch (error) {
            throw new LogicError(
              `Invalid output from ${ns}.${name}: ${error instanceof Error ? error.message : 'Unknown validation error'}`,
              { source: `${ns}.${name}` }
            );
          }
        }

        return result;
      };

      if (!("docs" in global)) global["docs"] = {};
      if (!(ns in global["docs"])) global["docs"][ns] = {};
      docs[ns + "." + name] = doc;
      toolDocs.set(`${ns}.${name}`, doc);
    };

    const global: any = {};
    
    // Docs function
    global.getDocs = (name: string) => {
      if (name in docs) return docs[name];
      let result = "";
      for (const key of Object.keys(docs)) {
        if (key.startsWith(name)) {
          result += "# " + key + "\n" + docs[key] + "\n\n";
        }
      }
      if (result) return result;
      throw new Error("Not found " + name);
    };

    // Console logging for all task types
    addTool(global, "Console", "log", makeConsoleLogTool(this.getContext));

    // Tools
    addTool(global, "Utils", "weather", makeGetWeatherTool(this.getContext));

    addTool(global, "Utils", "atob", makeAtobTool());
    addTool(global, "Web", "search", makeWebSearchTool(this.getContext));
    addTool(global, "Web", "fetchParse", makeWebFetchTool(this.getContext));
    addTool(
      global,
      "Web",
      "download",
      makeWebDownloadTool(this.api.fileStore, this.userPath, this.getContext)
    );

    // Memory
    // Notes
    addTool(global, "Memory", "getNote", makeGetNoteTool(this.api.noteStore));
    addTool(
      global,
      "Memory",
      "listNotesMetadata",
      makeListNotesTool(this.api.noteStore)
    );
    addTool(
      global,
      "Memory",
      "searchNotes",
      makeSearchNotesTool(this.api.noteStore)
    );

    // Worker only
    addTool(
      global,
      "Memory",
      "createNote",
      makeCreateNoteTool(this.api.noteStore, this.getContext)
    );
    addTool(
      global,
      "Memory",
      "updateNote",
      makeUpdateNoteTool(this.api.noteStore, this.getContext)
    );
    addTool(
      global,
      "Memory",
      "deleteNote",
      makeDeleteNoteTool(this.api.noteStore, this.getContext)
    );

    // Note: Memory.listEvents removed (Spec 01) - use execution_logs table instead
    // Note: Tasks.* tools removed (deprecated, no longer part of agent workflow)

    // File tools for router and worker
    addTool(
      global,
      "Files",
      "read",
      makeReadFileTool(this.api.fileStore, this.userPath)
    );
    addTool(
      global,
      "Files",
      "save",
      makeSaveFileTool(this.api.fileStore, this.userPath, this.getContext)
    );
    addTool(global, "Files", "list", makeListFilesTool(this.api.fileStore));
    addTool(
      global,
      "Files",
      "search",
      makeSearchFilesTool(this.api.fileStore)
    );

    // Image tools for worker only
    addTool(
      global,
      "Images",
      "generate",
      makeImagesGenerateTool(
        this.api.fileStore,
        this.userPath,
        this.getContext
      )
    );
    addTool(
      global,
      "Images",
      "explain",
      makeImagesExplainTool(this.api.fileStore, this.userPath, this.getContext)
    );
    addTool(
      global,
      "Images",
      "transform",
      makeImagesTransformTool(
        this.api.fileStore,
        this.userPath,
        this.getContext
      )
    );

    // PDF tools for worker only
    addTool(
      global,
      "PDF",
      "explain",
      makePdfExplainTool(this.api.fileStore, this.userPath, this.getContext)
    );

    // Audio tools for worker only
    addTool(
      global,
      "Audio",
      "explain",
      makeAudioExplainTool(this.api.fileStore, this.userPath, this.getContext)
    );

    // Text tools for worker only
    addTool(global, "Text", "extract", makeTextExtractTool(this.getContext));
    addTool(global, "Text", "classify", makeTextClassifyTool(this.getContext));
    addTool(
      global,
      "Text",
      "summarize",
      makeTextSummarizeTool(this.getContext)
    );
    addTool(global, "Text", "generate", makeTextGenerateTool(this.getContext));

    // Google service tools for worker only
    // Tools are always registered - connection check happens internally when called
    if (this.connectionManager) {
      addTool(
        global,
        "Gmail",
        "api",
        makeGmailTool(this.getContext, this.connectionManager)
      );
      addTool(
        global,
        "GoogleDrive",
        "api",
        makeGDriveTool(this.getContext, this.connectionManager)
      );
      addTool(
        global,
        "GoogleSheets",
        "api",
        makeGSheetsTool(this.getContext, this.connectionManager)
      );
      addTool(
        global,
        "GoogleDocs",
        "api",
        makeGDocsTool(this.getContext, this.connectionManager)
      );
      addTool(
        global,
        "Notion",
        "api",
        makeNotionTool(this.getContext, this.connectionManager)
      );
    }

    // User tools - with workflow context for notifications (Spec 01)
    // When running in workflow context, messages become notifications
    const userSendContext = this.workflowId ? {
      workflowId: this.workflowId,
      workflowTitle: '', // Will be fetched by the tool if needed
      scriptRunId: this.getContext()?.scriptRunId || '',
    } : undefined;
    addTool(global, "Users", "send", makeUserSendTool(this.api, userSendContext));

    // Script tools for worker only
    addTool(
      global,
      "Scripts",
      "get",
      makeGetScriptTool(this.api.scriptStore, this.getContext)
    );
    addTool(
      global,
      "Scripts",
      "list",
      makeListScriptsTool(this.api.scriptStore)
    );
    addTool(
      global,
      "Scripts",
      "history",
      makeScriptHistoryTool(this.api.scriptStore)
    );
    addTool(
      global,
      "Scripts",
      "listScriptRuns",
      makeListScriptRunsTool(this.api.scriptStore, this.getContext)
    );
    addTool(
      global,
      "Scripts",
      "getScriptRun",
      makeGetScriptRunTool(this.api.scriptStore)
    );

    // Items tools - logical items infrastructure
    // Items.list for querying processed items
    const itemsListTool = makeItemsListTool(
      this.api.itemStore,
      () => this.workflowId
    );
    addTool(global, "Items", "list", itemsListTool);

    // Items.withItem - built-in function for processing items with state tracking
    if (!("Items" in global)) {
      global["Items"] = {};
    }
    (global["Items"] as Record<string, unknown>)["withItem"] = this.createWithItemFunction();

    // Add documentation for Items.withItem
    const withItemDoc = `===DESCRIPTION===
Process work in a discrete logical item with automatic state tracking.

All mutations MUST be called inside Items.withItem() - mutations outside will abort the script.

Example:
await Items.withItem(
  'email:\${email.id}',  // Stable ID based on external identifier
  'Email from \${email.from}: "\${email.subject}"',  // Human-readable title
  async (ctx) => {
    if (ctx.item.isDone) {
      Console.log({ type: 'log', line: 'Skipping already processed item' });
      return;
    }
    // Process the item
    await Gmail.api({ method: 'users.messages.modify', ... });
  }
);

===INPUT===
{ id: string; title: string; handler: (ctx: ItemContext) => Promise<unknown> }

===OUTPUT===
unknown (result of handler)`;
    toolDocs.set("Items.withItem", withItemDoc);

    // Store
    this.toolDocs = toolDocs;

    return global;
  }

  /**
   * Create the Items.withItem function for processing items with state tracking.
   */
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

      // Check for nested/concurrent withItem
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
      const createdBy: ItemCreatedBy = this.type === 'planner' || this.type === 'maintainer'
        ? this.type
        : 'workflow';

      // Start item (creates or updates status to 'processing')
      const item = await this.api.itemStore.startItem(
        workflowId,
        logicalItemId,
        title,
        createdBy,
        runId
      );

      const isDone = item.status === 'done';

      // Set active item state
      this.activeItem = { id: logicalItemId, title };
      this.activeItemIsDone = isDone;

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
        this.activeItemIsDone = false;
      }
    };
  }

  /**
   * Abort execution with a logic error.
   */
  private abortWithLogicError(message: string): never {
    const error = new LogicError(message, { source: 'Items.withItem' });

    if (this.abortController) {
      this.getContext().classifiedError = error;
      this.abortController.abort(message);
    }

    throw error;
  }
}

type Any = z.ZodTypeAny;

export const printSchema = (schema: Any): string => {
  const t = schema._def.typeName as K;

  // For primitive types, return description if available
  const isPrimitive = [
    K.ZodString,
    K.ZodNumber,
    K.ZodBoolean,
    K.ZodBigInt,
    K.ZodDate,
    K.ZodUndefined,
    K.ZodNull,
    K.ZodLiteral,
    K.ZodEnum,
    K.ZodNativeEnum,
  ].includes(t);

  if (schema.description && isPrimitive) {
    return "<" + schema.description + ">";
  }

  let result: string;

  switch (t) {
    case K.ZodString:
      result = "string";
      break;
    case K.ZodNumber:
      result = "number";
      break;
    case K.ZodBoolean:
      result = "boolean";
      break;
    case K.ZodBigInt:
      result = "bigint";
      break;
    case K.ZodDate:
      result = "date";
      break;
    case K.ZodUndefined:
      result = "undefined";
      break;
    case K.ZodNull:
      result = "null";
      break;

    case K.ZodLiteral:
      result = JSON.stringify((schema as z.ZodLiteral<any>)._def.value);
      break;

    case K.ZodEnum:
      result = `enum(${(
        schema as z.ZodEnum<[string, ...string[]]>
      )._def.values.join(", ")})`;
      break;

    case K.ZodNativeEnum:
      result = `enum(${Object.values(
        (schema as z.ZodNativeEnum<any>)._def.values
      ).join(", ")})`;
      break;

    case K.ZodArray: {
      const inner = (schema as z.ZodArray<Any>)._def.type;
      result = `[${printSchema(inner)}]`;
      break;
    }

    case K.ZodOptional:
      result = `${printSchema((schema as z.ZodOptional<Any>)._def.innerType)}?`;
      break;

    case K.ZodNullable:
      result = `${printSchema(
        (schema as z.ZodNullable<Any>)._def.innerType
      )} | null`;
      break;

    case K.ZodDefault:
      result = `${printSchema(
        (schema as z.ZodDefault<Any>)._def.innerType
      )} (default)`;
      break;

    case K.ZodPromise:
      result = `Promise<${printSchema(
        (schema as z.ZodPromise<Any>)._def.type
      )}>`;
      break;

    case K.ZodUnion:
      result = (schema as z.ZodUnion<[Any, ...Any[]]>)._def.options
        .map(printSchema)
        .join(" | ");
      break;

    case K.ZodIntersection: {
      const s = schema as z.ZodIntersection<Any, Any>;
      result = `${printSchema(s._def.left)} & ${printSchema(s._def.right)}`;
      break;
    }

    case K.ZodRecord: {
      const s = schema as z.ZodRecord<Any, Any>;
      result = `{ [key: ${printSchema(s._def.keyType)}]: ${printSchema(
        s._def.valueType
      )} }`;
      break;
    }

    case K.ZodTuple:
      result = `[${(schema as z.ZodTuple)._def.items
        .map(printSchema)
        .join(", ")}]`;
      break;

    case K.ZodObject: {
      const obj = schema as z.ZodObject<any>;
      // In Zod v3, the shape is a function on _def:
      const shape = obj._def.shape();
      const body = Object.entries(shape)
        .map(([k, v]) => `${k}: ${printSchema(v as Any)}`)
        .join("; ");
      result = `{ ${body} }`;
      break;
    }

    case K.ZodDiscriminatedUnion: {
      const du = schema as z.ZodDiscriminatedUnion<string, any>;
      // options is a Map in Zod; get its values:
      const options: any[] = Array.from(du._def.options.values());
      result = options.map(printSchema).join(" | ");
      break;
    }

    case K.ZodEffects: {
      // If you want to "ignore" refinements/transforms for printing:
      const inner = (schema as z.ZodEffects<Any>)._def.schema;
      result = printSchema(inner);
      break;
    }

    case K.ZodBranded: {
      const inner = (schema as z.ZodBranded<Any, any>)._def.type;
      result = `${printSchema(inner)} /* branded */`;
      break;
    }

    default:
      // Fallback: show the Zod kind
      result = t.replace("Zod", "").toLowerCase();
      break;
  }

  // Add description as a comment for complex types
  if (schema.description && !isPrimitive) {
    result = `${result} /* ${schema.description} */`;
  }

  return result;
};
