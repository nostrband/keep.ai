import { KeepDbApi, TaskType } from "@app/db";
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
  makeTopicsPeekTool,
  makeTopicsGetByIdsTool,
  makeTopicsPublishTool,
} from "../tools";
import { EvalContext, EvalGlobal } from "./sandbox";
import debug from "debug";
import { ClassifiedError, isClassifiedError, LogicError, WorkflowPausedError } from "../errors";
import type { ConnectionManager } from "@app/connectors";
import { validateJsonSchema, printJsonSchema } from "../json-schema";

/**
 * @deprecated SandboxAPI is deprecated. Use ToolWrapper from './tool-wrapper' instead.
 * This class is kept for backwards compatibility but will be removed in a future version.
 * The Items.withItem() and Items.list functionality has been removed as part of exec-02.
 * Use the new Topics-based event-driven execution model instead.
 */
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
 *
 * @deprecated Use ToolWrapper from './tool-wrapper' instead.
 * Items.withItem() and Items.list have been removed (exec-02).
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
        desc.push(...["===INPUT===", printJsonSchema(tool.inputSchema)]);
      if (tool.outputSchema)
        desc.push(...["===OUTPUT===", printJsonSchema(tool.outputSchema)]);
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
          const result = validateJsonSchema(tool.inputSchema, input);
          if (!result.valid) {
            this.debug(
              `Bad input for '${ns}.${name}' input ${JSON.stringify(
                input
              )} errors ${result.errors.join("; ")}`
            );

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
          validatedInput = result.value;
        }

        // Note: Mutation restrictions via Items.withItem() have been removed (exec-02)
        // Phase-based restrictions will be enforced by ToolWrapper in the new execution model

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
          const outResult = validateJsonSchema(tool.outputSchema, result);
          if (!outResult.valid) {
            throw new LogicError(
              `Invalid output from ${ns}.${name}: ${outResult.errors.join("; ")}`,
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

    // Note: Items.list and Items.withItem have been removed (exec-02)
    // Use the new Topics-based event-driven execution model instead.

    // Topics API (exec-03) - event-driven execution model
    // Note: Phase restrictions (prepare/producer/next) are enforced by the handler state machine (exec-06),
    // not by these tools directly. The tools are always available but misuse will cause handler failures.
    addTool(
      global,
      "Topics",
      "peek",
      makeTopicsPeekTool(
        this.api.eventStore,
        () => this.workflowId,
        () => this.scriptRunId
      )
    );
    addTool(
      global,
      "Topics",
      "getByIds",
      makeTopicsGetByIdsTool(
        this.api.eventStore,
        () => this.workflowId
      )
    );
    addTool(
      global,
      "Topics",
      "publish",
      makeTopicsPublishTool(
        this.api.eventStore,
        () => this.workflowId,
        () => this.scriptRunId
      )
    );

    // Store
    this.toolDocs = toolDocs;

    return global;
  }
}

