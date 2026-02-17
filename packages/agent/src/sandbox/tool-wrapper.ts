import { KeepDbApi, type Mutation } from "@app/db";
import { EvalContext, EvalGlobal } from "./sandbox";
import debug from "debug";
import { ClassifiedError, isClassifiedError, LogicError, WorkflowPausedError } from "../errors";
import type { ConnectionManager } from "@app/connectors";
import { Tool } from "../tools/types";
import { validateJsonSchema, printJsonSchema } from "../json-schema";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyTool = Tool<any, any>;

/**
 * Execution phases for the handler state machine.
 * - producer: Producer handlers that emit events to topics
 * - prepare: Consumer prepare phase - peek topics and select work
 * - mutate: Consumer mutate phase - execute single external mutation
 * - next: Consumer next phase - emit downstream events
 * - null: Not in handler execution (e.g., task mode)
 */
export type ExecutionPhase = 'producer' | 'prepare' | 'mutate' | 'next' | null;

/**
 * Operation types for phase restriction checks.
 */
export type OperationType = 'read' | 'mutate' | 'topic_peek' | 'topic_publish' | 'register_input';

export interface ToolWrapperConfig {
  /** Array of tools to register */
  tools: AnyTool[];
  /** Database API */
  api: KeepDbApi;
  /** Function to get current execution context */
  getContext: () => EvalContext;
  /** User file storage path */
  userPath?: string;
  /** Connection manager for OAuth-based tools */
  connectionManager?: ConnectionManager;
  /** Workflow ID for pause checking and item tracking */
  workflowId?: string;
  /** Script run ID for tracking */
  scriptRunId?: string;
  /** Handler run ID for mutation tracking (exec-04) */
  handlerRunId?: string;
  /** Task run ID for tracking */
  taskRunId?: string;
  /** Task type (planner/maintainer) */
  taskType?: 'planner' | 'maintainer';
  /**
   * Abort controller for terminating script on fatal errors (workflow mode only).
   * When set along with workflowId, invalid input errors will abort execution immediately.
   */
  abortController?: AbortController;
}

/**
 * Phase restriction matrix.
 * Defines which operations are allowed in each execution phase.
 *
 * register_input is only allowed in producer phase per exec-15.
 */
const PHASE_RESTRICTIONS: Record<Exclude<ExecutionPhase, null>, Record<OperationType, boolean>> = {
  producer: { read: true, mutate: false, topic_peek: false, topic_publish: true, register_input: true },
  prepare:  { read: true, mutate: false, topic_peek: true, topic_publish: false, register_input: false },
  mutate:   { read: false, mutate: true, topic_peek: false, topic_publish: false, register_input: false },
  next:     { read: false, mutate: false, topic_peek: false, topic_publish: true, register_input: false },
};

/**
 * ToolWrapper creates the JavaScript API that gets injected into the sandbox.
 *
 * It provides:
 * - Tool registration with input/output validation
 * - Workflow pause checking
 * - Phase-based access control for handler execution (exec-03a/exec-04)
 *
 * Note: Items.withItem() has been removed (exec-02). Use the new Topics-based
 * event-driven execution model instead.
 */
export class ToolWrapper {
  private tools: AnyTool[];
  private api: KeepDbApi;
  private getContext: () => EvalContext;
  private userPath?: string;
  private connectionManager?: ConnectionManager;
  private workflowId?: string;
  private scriptRunId?: string;
  private handlerRunId?: string;
  private taskRunId?: string;
  private taskType?: 'planner' | 'maintainer';
  private abortController?: AbortController;
  private debug = debug("ToolWrapper");
  private toolDocs = new Map<string, string>();

  // Phase tracking state (exec-03a/exec-04)
  private currentPhase: ExecutionPhase = null;
  private mutationExecuted: boolean = false;
  /** Context for lazy mutation creation — set before mutate phase, used when mutation tool is called */
  private mutateContext: { handlerRunId: string; workflowId: string; uiTitle?: string } | null = null;
  /** Mutation record created on demand when mutation tool is actually called */
  private createdMutation: Mutation | null = null;
  /** Whether a mutation was successfully applied and script should terminate */
  private mutationApplied: boolean = false;

  constructor(config: ToolWrapperConfig) {
    this.tools = config.tools;
    this.api = config.api;
    this.getContext = config.getContext;
    this.userPath = config.userPath;
    this.connectionManager = config.connectionManager;
    this.workflowId = config.workflowId;
    this.scriptRunId = config.scriptRunId;
    this.handlerRunId = config.handlerRunId;
    this.taskRunId = config.taskRunId;
    this.taskType = config.taskType;
    this.abortController = config.abortController;
  }

  // ============================================================================
  // Phase Tracking Methods (exec-03a/exec-04)
  // ============================================================================

  /**
   * Set the current execution phase.
   * Resets mutation tracking when phase changes.
   *
   * @param phase - The new execution phase, or null to exit handler execution
   */
  setPhase(phase: ExecutionPhase): void {
    this.currentPhase = phase;
    this.mutationExecuted = false;
    this.mutateContext = null;
    this.createdMutation = null;
    this.mutationApplied = false;
  }

  /**
   * Get the current execution phase.
   */
  getPhase(): ExecutionPhase {
    return this.currentPhase;
  }

  /**
   * Set context for lazy mutation creation in the mutate phase.
   * Must be called before entering mutate phase.
   * The actual mutation record is created only when a mutation tool is called.
   */
  setMutateContext(ctx: { handlerRunId: string; workflowId: string; uiTitle?: string } | null): void {
    this.mutateContext = ctx;
    this.createdMutation = null;
  }

  /**
   * Get the mutation record created during this mutate phase.
   * Returns null if mutate handler didn't call any mutation tool.
   */
  getCreatedMutation(): Mutation | null {
    return this.createdMutation;
  }

  /**
   * Check if a mutation was successfully applied during this phase.
   * When true, the script was aborted because mutation is terminal — not an error.
   */
  wasMutationApplied(): boolean {
    return this.mutationApplied;
  }

  /**
   * Check if an operation is allowed in the current phase.
   * Throws LogicError if the operation is not allowed.
   *
   * When phase is null (task mode), all operations are allowed.
   *
   * @param operation - The operation type to check
   * @throws LogicError if operation not allowed in current phase
   */
  checkPhaseAllowed(operation: OperationType): void {
    // Skip phase check if not in handler execution (e.g., task mode)
    if (this.currentPhase === null) {
      return;
    }

    const allowed = PHASE_RESTRICTIONS[this.currentPhase][operation];
    if (!allowed) {
      throw new LogicError(
        `Operation '${operation}' not allowed in '${this.currentPhase}' phase`,
        { source: 'ToolWrapper' }
      );
    }

    // Enforce single mutation per mutate phase
    if (operation === 'mutate') {
      if (this.mutationExecuted) {
        throw new LogicError(
          'Only one mutation allowed per mutate phase',
          { source: 'ToolWrapper' }
        );
      }
      this.mutationExecuted = true;
    }
  }

  /**
   * Determine the operation type for a tool call.
   * Topics tools have special operation types; other tools are read or mutate.
   */
  private getOperationType(tool: AnyTool, validatedInput: unknown): OperationType {
    // Topics tools have special operation types
    if (tool.namespace === 'Topics') {
      if (tool.name === 'peek' || tool.name === 'getByIds') {
        return 'topic_peek';
      }
      if (tool.name === 'publish') {
        return 'topic_publish';
      }
      if (tool.name === 'registerInput') {
        return 'register_input';
      }
    }

    // For other tools, check if read-only
    const isReadOnly = tool.isReadOnly?.(validatedInput) ?? false;
    return isReadOnly ? 'read' : 'mutate';
  }

  /**
   * Check if the workflow is still active. Throws WorkflowPausedError if paused.
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
      if (error instanceof WorkflowPausedError) {
        throw error;
      }
      this.debug(`Error checking workflow status: ${error}`);
    }
  }

  get docs() {
    return this.toolDocs;
  }

  async createGlobal(): Promise<EvalGlobal> {
    const toolDocs = new Map<string, string>();
    const docs: Record<string, string> = {};
    const global: Record<string, unknown> = {};

    // Group tools by namespace and register them
    for (const tool of this.tools) {
      const ns = tool.namespace;
      const name = tool.name;

      // Format documentation — classify mutation behavior for docs:
      // - No isReadOnly → always a mutation
      // - isReadOnly returns true for empty input → always read-only
      // - isReadOnly returns false for empty input → mixed (some methods are mutations)
      let mutationNotice: string;
      if (!tool.isReadOnly) {
        mutationNotice = `\n⚠️ Mutation — can only be used in the 'mutate' consumer phase.`;
      } else if (tool.isReadOnly({} as any)) {
        mutationNotice = ``;
      } else {
        mutationNotice = `\n⚠️ Some methods are mutations — mutations can only be used in the 'mutate' consumer phase.`;
      }
      const desc = [
        "===DESCRIPTION===",
        tool.description + mutationNotice +
          `
Example: await ${ns}.${name}(<input>)
`,
      ];
      if (tool.inputSchema)
        desc.push(...["===INPUT===", printJsonSchema(tool.inputSchema)]);
      if (tool.outputSchema)
        desc.push(...["===OUTPUT===", printJsonSchema(tool.outputSchema)]);
      if (tool.outputType)
        desc.push(...[
          "===INPUT REGISTRATION===",
          `When registering data from this tool as input, use: Topics.registerInput({ source: '${ns}', type: '${tool.outputType}', ... })`
        ]);
      const doc = desc.join("\n");

      // Initialize namespace
      if (!(ns in global)) {
        global[ns] = {};
      }

      // Create wrapped function
      (global[ns] as Record<string, unknown>)[name] = this.wrapTool(tool, doc);

      // Store documentation
      docs[`${ns}.${name}`] = doc;
      toolDocs.set(`${ns}.${name}`, doc);
    }

    // Note: Items.withItem has been removed (exec-02).
    // Topics API is available via tool-lists.ts (exec-03).

    // Add getDocs helper
    global["getDocs"] = (name: string) => {
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

    this.toolDocs = toolDocs;
    return global;
  }

  /**
   * Wrap a tool with validation and mutation enforcement.
   */
  private wrapTool(tool: AnyTool, doc: string) {
    const ns = tool.namespace;
    const name = tool.name;

    return async (input: unknown) => {
      // Check if workflow is still active
      await this.checkWorkflowActive();

      // Validate input
      let validatedInput = input;
      if (tool.inputSchema) {
        const result = validateJsonSchema(tool.inputSchema, input, { strict: true });
        if (!result.valid) {
          this.debug(
            `Bad input for '${ns}.${name}' input ${JSON.stringify(input)} errors ${result.errors.join("; ")}`
          );

          const message = `Invalid input for ${ns}.${name}.\nUsage: ${doc}`;
          const logicError = new LogicError(message, { source: `${ns}.${name}` });

          if (this.workflowId) {
            this.getContext().classifiedError = logicError;
            this.abortController?.abort(message);
          }

          throw logicError;
        }
        validatedInput = result.value;
      }

      // Check phase restrictions (exec-03a/exec-04)
      // In handler execution mode (currentPhase != null), enforces operation restrictions
      const operationType = this.getOperationType(tool, validatedInput);
      this.checkPhaseAllowed(operationType);

      // Before executing a mutation tool, create the mutation record directly in in_flight status.
      // No "pending" state — the record is only created when a mutation is actually called.
      // This enables crash recovery (in_flight detection) and output tracking
      // (tool_namespace/tool_method are used by the UI to display outputs).
      if (operationType === 'mutate' && this.mutateContext && this.currentPhase === 'mutate') {
        this.createdMutation = await this.api.mutationStore.createInFlight({
          handler_run_id: this.mutateContext.handlerRunId,
          workflow_id: this.mutateContext.workflowId,
          tool_namespace: ns,
          tool_method: name,
          params: JSON.stringify(validatedInput),
          ui_title: this.mutateContext.uiTitle,
        });
      }

      // Execute the tool
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
        let classified: ClassifiedError;
        if (isClassifiedError(e)) {
          // Don't re-create classified errors — re-throw original to preserve
          // identity (especially AuthError with serviceId/accountId).
          classified = e;
        } else {
          const message = `Failed at ${ns}.${name}: ${e}.\nUsage: ${doc}`;
          classified = new LogicError(message, {
            cause: e instanceof Error ? e : undefined,
            source: `${ns}.${name}`
          });
        }

        // Store classified error on context so it survives the QuickJS boundary.
        // Without this, error class info is lost when crossing the sandbox boundary
        // and the handler state machine falls back to LogicError.
        if (this.workflowId) {
          this.getContext().classifiedError = classified;
          this.abortController?.abort(classified.message);
        }

        throw classified;
      }

      // Validate output
      if (tool.outputSchema) {
        const outResult = validateJsonSchema(tool.outputSchema, result);
        if (!outResult.valid) {
          const outError = new LogicError(
            `Invalid output from ${ns}.${name}: ${outResult.errors.join("; ")}`,
            { source: `${ns}.${name}` }
          );
          if (this.workflowId) {
            this.getContext().classifiedError = outError;
            this.abortController?.abort(outError.message);
          }
          throw outError;
        }
      }

      // Mutation is terminal: store the tool's return value in the ledger
      // and abort the script. The handler state machine uses the ledger
      // as the source of truth — the mutate handler's return value is discarded.
      if (this.createdMutation && this.currentPhase === 'mutate') {
        await this.api.mutationStore.markApplied(
          this.createdMutation.id,
          JSON.stringify(result)
        );
        this.mutationApplied = true;
        this.abortController?.abort("mutation_applied");
      }

      return result;
    };
  }
}
