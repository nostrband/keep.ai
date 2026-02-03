import { KeepDbApi, Mutation } from "@app/db";
import { z, ZodFirstPartyTypeKind as K } from "zod";
import { EvalContext, EvalGlobal } from "./sandbox";
import debug from "debug";
import { ClassifiedError, isClassifiedError, LogicError, WorkflowPausedError } from "../errors";
import type { ConnectionManager } from "@app/connectors";
import { Tool } from "../tools/types";

type Any = z.ZodTypeAny;
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
export type OperationType = 'read' | 'mutate' | 'topic_peek' | 'topic_publish';

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
 */
const PHASE_RESTRICTIONS: Record<Exclude<ExecutionPhase, null>, Record<OperationType, boolean>> = {
  producer: { read: true, mutate: false, topic_peek: false, topic_publish: true },
  prepare:  { read: true, mutate: false, topic_peek: true, topic_publish: false },
  mutate:   { read: false, mutate: true, topic_peek: false, topic_publish: false },
  next:     { read: false, mutate: false, topic_peek: false, topic_publish: true },
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
  private currentMutation: Mutation | null = null;

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
    this.currentMutation = null;
  }

  /**
   * Get the current execution phase.
   */
  getPhase(): ExecutionPhase {
    return this.currentPhase;
  }

  /**
   * Set the current mutation record for the mutate phase.
   * Must be called before entering mutate phase to enable mutation tracking.
   *
   * @param mutation - The mutation record from the mutations table
   */
  setCurrentMutation(mutation: Mutation | null): void {
    this.currentMutation = mutation;
  }

  /**
   * Get the current mutation record.
   * Used by mutation tools to record tool info before external calls.
   *
   * @returns The current mutation record, or null if not in mutate phase
   */
  getCurrentMutation(): Mutation | null {
    return this.currentMutation;
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

      // Format documentation
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
        try {
          validatedInput = tool.inputSchema.parse(input);
        } catch (error) {
          this.debug(
            `Bad input for '${ns}.${name}' input ${JSON.stringify(input)} error ${error}`
          );

          const message = `Invalid input for ${ns}.${name}.\nUsage: ${doc}`;
          const logicError = new LogicError(message, { source: `${ns}.${name}` });

          if (this.workflowId && this.abortController) {
            this.getContext().classifiedError = logicError;
            this.abortController.abort(message);
          }

          throw logicError;
        }
      }

      // Check phase restrictions (exec-03a/exec-04)
      // In handler execution mode (currentPhase != null), enforces operation restrictions
      const operationType = this.getOperationType(tool, validatedInput);
      this.checkPhaseAllowed(operationType);

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
        if (isClassifiedError(e)) {
          const contextMessage = `Failed at ${ns}.${name}: ${e.message}`;
          const EnhancedError = e.constructor as new (
            message: string,
            options?: { cause?: Error; source?: string }
          ) => ClassifiedError;
          throw new EnhancedError(contextMessage, { cause: e.cause, source: e.source || `${ns}.${name}` });
        }
        const message = `Failed at ${ns}.${name}: ${e}.\nUsage: ${doc}`;
        throw new LogicError(message, {
          cause: e instanceof Error ? e : undefined,
          source: `${ns}.${name}`
        });
      }

      // Validate output
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
  }
}

/**
 * Print a Zod schema as human-readable documentation.
 */
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
      result = JSON.stringify((schema as z.ZodLiteral<unknown>)._def.value);
      break;

    case K.ZodEnum:
      result = `enum(${(
        schema as z.ZodEnum<[string, ...string[]]>
      )._def.values.join(", ")})`;
      break;

    case K.ZodNativeEnum:
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
      const obj = schema as z.ZodObject<Record<string, Any>>;
      const shape = obj._def.shape();
      const body = Object.entries(shape)
        .map(([k, v]) => `${k}: ${printSchema(v as Any)}`)
        .join("; ");
      result = `{ ${body} }`;
      break;
    }

    case K.ZodDiscriminatedUnion: {
      const du = schema as z.ZodDiscriminatedUnion<string, z.ZodDiscriminatedUnionOption<string>[]>;
      const options: Any[] = Array.from(du._def.options.values());
      result = options.map(printSchema).join(" | ");
      break;
    }

    case K.ZodEffects: {
      const inner = (schema as z.ZodEffects<Any>)._def.schema;
      result = printSchema(inner);
      break;
    }

    case K.ZodBranded: {
      const inner = (schema as z.ZodBranded<Any, string>)._def.type;
      result = `${printSchema(inner)} /* branded */`;
      break;
    }

    default:
      result = t.replace("Zod", "").toLowerCase();
      break;
  }

  // Add description as a comment for complex types
  if (schema.description && !isPrimitive) {
    result = `${result} /* ${schema.description} */`;
  }

  return result;
};
