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
  makeGetTaskTool,
  makeListTasksTool,
  makeSendToTaskInboxTool,
  makeTaskUpdateTool,
  makeListEventsTool,
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
} from "../tools";
import { z, ZodFirstPartyTypeKind as K } from "zod";
import { EvalContext, EvalGlobal } from "./sandbox";
import debug from "debug";
import { ClassifiedError, isClassifiedError, LogicError } from "../errors";

export interface SandboxAPIConfig {
  api: KeepDbApi;
  type: TaskType | "workflow";
  getContext: () => EvalContext;
  userPath?: string;
  gmailOAuth2Client?: any;
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
  private gmailOAuth2Client?: any;
  private debug = debug("SandboxAPI");
  private toolDocs = new Map<string, string>();

  constructor(config: SandboxAPIConfig) {
    this.api = config.api;
    this.type = config.type;
    this.getContext = config.getContext;
    this.userPath = config.userPath;
    this.gmailOAuth2Client = config.gmailOAuth2Client;
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
            throw new Error(message);
          }
        }

        // Execute the tool with validated input
        try {
          const result = await tool.execute(validatedInput);
          this.debug("Tool called", {
            name,
            input,
            context: this.getContext(),
            result,
          });
          return result;
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
        // FIXME not sure if all tools return all declared fields
        // if (tool.outputSchema) {
        //   try {
        //     tool.outputSchema.parse(result);
        //   } catch (error) {
        //     throw new Error(`Invalid output from ${ns}.${name}: ${error instanceof Error ? error.message : 'Unknown validation error'}`);
        //   }
        // }
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

    // Event history available for all agent types
    addTool(
      global,
      "Memory",
      "listEvents",
      makeListEventsTool(this.api.chatStore, this.api.taskStore)
    );

    // Tasks
    addTool(global, "Tasks", "get", makeGetTaskTool(this.api.taskStore));
    addTool(global, "Tasks", "list", makeListTasksTool(this.api.taskStore));
    addTool(
      global,
      "Tasks",
      "sendToTaskInbox",
      makeSendToTaskInboxTool(
        this.api.taskStore,
        this.api.inboxStore,
        this.getContext
      )
    );
    addTool(
      global,
      "Tasks",
      "update",
      makeTaskUpdateTool(this.api, this.getContext)
    );

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

    // Gmail tools for worker only
    if (this.gmailOAuth2Client) {
      addTool(
        global,
        "Gmail",
        "api",
        makeGmailTool(this.getContext, this.gmailOAuth2Client)
      );
    }

    // User tools for planner only
    addTool(global, "Users", "send", makeUserSendTool(this.api));

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

    // Store
    this.toolDocs = toolDocs;

    return global;
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
