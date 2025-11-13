import { KeepDbApi } from "@app/db";
import {
  makeCreateNoteTool,
  makeDeleteNoteTool,
  makeGetNoteTool,
  makeGetWeatherTool,
  makeListNotesTool,
  makeSearchNotesTool,
  makeUpdateNoteTool,
} from "./tools";
import { z, ZodFirstPartyTypeKind as K } from "zod";
import { generateId } from "ai";
import { EvalContext, EvalGlobal } from "./sandbox/sandbox";
import { StepInput, TaskState, TaskType } from "./repl-agent-types";

export class ReplEnv {
  private api: KeepDbApi;
  private type: TaskType;
  private getContext: () => EvalContext;
  #tools: string[] = [];

  constructor(api: KeepDbApi, type: TaskType, getContext: () => EvalContext) {
    this.api = api;
    this.type = type;
    this.getContext = getContext;
  }

  get tools() {
    return this.#tools;
  }

  get temperature() {
    switch (this.type) {
      case "router":
      case "worker":
      case "replier":
        return 0.2;
    }
  }

  async createGlobal(): Promise<EvalGlobal> {
    const docs: any = {};
    const addTool = (global: any, ns: string, name: string, tool: any) => {
      if (!(ns in global)) global[ns] = {};
      global[ns][name] = tool.execute;
      this.tools.push(`${ns}.${name}`);

      if (!("docs" in global)) global["docs"] = {};
      if (!(ns in global["docs"])) global["docs"][ns] = {};
      let desc = ["===Description===", tool.description];
      if (tool.inputSchema)
        desc.push(...["===Input===", printSchema(tool.inputSchema)]);
      if (tool.outputSchema)
        desc.push(...["===Output===", printSchema(tool.outputSchema)]);
      docs[ns + "." + name] = desc.join("\n");
    };

    const global: any = {};
    // Docs function
    global.docs = (name: string) => {
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

    // Tools
    addTool(global, "tools", "weather", makeGetWeatherTool());
    addTool(global, "memory", "getNote", makeGetNoteTool(this.api.noteStore));
    addTool(
      global,
      "memory",
      "listNotes",
      makeListNotesTool(this.api.noteStore)
    );
    addTool(
      global,
      "memory",
      "searchNotes",
      makeSearchNotesTool(this.api.noteStore)
    );
    addTool(
      global,
      "memory",
      "createNote",
      makeCreateNoteTool(this.api.noteStore)
    );
    addTool(
      global,
      "memory",
      "updateNote",
      makeUpdateNoteTool(this.api.noteStore)
    );
    addTool(
      global,
      "memory",
      "deleteNote",
      makeDeleteNoteTool(this.api.noteStore)
    );
    addTool(global, "memory", "listMessages", {
      execute: async (opts?: { limit: number }) => {
        return await this.api.memoryStore.getMessages({
          // default limit
          limit: 3,
          // copy other options
          ...opts,
          // override thread
          threadId: "main",
        });
      },
      description:
        "Get list of messages exchanged with user, most-recent-first.",
      inputSchema: z.object({
        limit: z
          .number()
          .optional()
          .default(10)
          .describe("Number of most recent user messages to fetch"),
      }),
      outputSchema: z.array(
        z.object({
          id: z.string().describe("Id of message"),
          metadata: z.object({
            createdAt: z.string().describe("Date and time of message"),
          }),
          role: z
            .string()
            .describe("Message author's role - 'user' or 'assistant'"),
          parts: z.array(
            z.object({
              type: z.string().describe("Type of part, 'text' or others"),
              text: z.string().describe("Text of message part"),
            })
          ),
        })
      ),
    });

    // Tasks
    addTool(global, "tasks", "add", {
      execute: async (opts: {
        title: string;
        goal?: string;
        notes?: string;
      }) => {
        const id = generateId();
        await this.api.taskStore.addTask(
          id,
          Math.floor(Date.now() / 1000),
          "",
          "worker",
          "",
          opts.title
        );
        await this.api.taskStore.saveState({
          id,
          goal: opts.goal || "",
          notes: opts.notes || "",
          asks: "",
          plan: "",
        });
      },
      description: "Create a background task",
      inputSchema: z.object({
        title: z.string().describe("Task title for task management and audit"),
        goal: z
          .string()
          .optional()
          .nullable()
          .describe("Task goal for worker agent"),
        notes: z
          .string()
          .optional()
          .nullable()
          .describe("Task notes for worker agent"),
      }),
      outputSchema: z.array(z.string().describe("Task id")),
    });

    addTool(global, "tasks", "get", {
      execute: async (id: string) => {
        const task = await this.api.taskStore.getTask(id);
        const state = await this.api.taskStore.getState(id);
        return {
          id: task.id,
          title: task.title,
          state: task.state,
          error: task.error,
          runTime: new Date(task.timestamp * 1000),
          goal: state?.goal || "",
          notes: state?.notes || "",
          plan: state?.plan || "",
          asks: state?.asks || "",
        };
      },
      description: "Get a background task",
      inputSchema: z.string().describe("Task id"),
      outputSchema: z.array(
        z.object({
          id: z.string(),
          title: z.string(),
          state: z.string(),
          error: z.string(),
          runTime: z
            .string()
            .describe("Date time when task is scheduled to run"),
        })
      ),
    });

    addTool(global, "tasks", "list", {
      execute: async (opts?: {
        include_finished?: boolean;
        until?: string;
      }) => {
        const tasks = await this.api.taskStore.listTasks(
          opts?.include_finished,
          "worker",
          opts?.until
            ? Math.floor(new Date(opts.until).getTime() / 1000)
            : undefined
        );
        return tasks.map((task) => ({
          id: task.id,
          title: task.title,
          state: task.state,
          error: task.error,
        }));
      },
      description: "List background tasks",
      inputSchema: z.object({
        include_finished: z
          .boolean()
          .optional()
          .nullable()
          .describe("Include finished tasks to the list"),
        until: z
          .string()
          .optional()
          .nullable()
          .describe(
            "Max runTime field of task, can be used for pagination through older tasks"
          ),
      }),
      outputSchema: z.array(
        z.object({
          id: z.string(),
          title: z.string(),
          state: z.string(),
          error: z.string(),
          runTime: z
            .string()
            .describe("Date time when task is scheduled to run"),
        })
      ),
    });

    addTool(global, "tasks", "cancel", {
      execute: async (opts: { id: string; reason?: string }) => {
        let { id, reason } = opts;
        if (typeof opts === "string") id = opts;

        const task = await this.api.taskStore.getTask(id);
        if (!task) throw new Error("Task not found");

        await this.api.taskStore.finishTask(
          id,
          "",
          "Cancelled",
          reason || "Cancelled"
        );
      },
      description: "Cancel a task.",
      inputSchema: z.object({
        id: z.string(),
        reason: z
          .string()
          .optional()
          .nullable()
          .describe("Cancel reason for audit traces"),
      }),
    });

    addTool(global, "tasks", "sendToTaskInbox", {
      execute: async (opts: { id: string; message: string }) => {
        const task = await this.api.taskStore.getTask(opts.id);
        if (!task) throw new Error("Task not found");

        const context = this.getContext();
        if (!context) throw new Error("No eval context");
        if (context.type === "replier")
          throw new Error("Replier can't send to inbox");

        await this.api.inboxStore.saveInbox({
          id: `${context.taskThreadId}.${context.step}.${generateId()}`,
          source: context.type,
          source_id: context.taskId,
          target: "worker",
          target_id: opts.id,
          timestamp: new Date().toISOString(),
          content: JSON.stringify({ role: "assistant", content: opts.message }),
          handler_thread_id: "",
          handler_timestamp: "",
        });
      },
      description: "Send a message to task inbox",
      inputSchema: z.object({
        id: z.string().describe("Task id"),
        message: z.string().describe("Message for the task handler"),
      }),
    });

    return global;
  }

  async buildSystem(): Promise<string> {
    let systemPrompt = "";
    switch (this.type) {
      case "replier":
      case "router": {
        systemPrompt = this.routerSystemPrompt();
        break;
      }
      case "worker": {
        systemPrompt = this.workerSystemPrompt();
      }
    }

    return `
${systemPrompt}
`.trim();
  }

  async buildUser(input: StepInput, state?: TaskState): Promise<string> {
    if (input.reason === "code" && !input.result)
      throw new Error("No step result");
    if (input.reason === "input" && !input.inbox.length)
      throw new Error("No inbox for reason='input'");

    const job: string[] = [];
    if (input.step === 0) {
      switch (this.type) {
        case "router":
          // FIXME parse user query, only one-shot replies, create tasks for anything else
          job.push(
            ...[
              "Read user messages in TASK_INBOX and act accordingly. Use memory.* tools to understand the context better.",
            ]
          );
          break;
        case "replier":
          job.push(
            ...[
              "Some background tasks have submitted their reply drafts for user into your TASK_INBOX. Your job is to check the user message history",
              "and prepare a context-aware reply for user, maintaining a natural flow of the conversation. You might need to deduplicate the",
              "drafts, or even suppress some of them if the draft is no longer relevant/answered according to recent message history. Leave TASK_REPLY empty ",
              "in case all drafts should be suppressed, but explain your reasoning in STEP_REASONING.",
            ]
          );
          break;
      }
    }

    // For all worker types
    const tools: string[] = [];
    if (input.step === 0 && this.tools.length)
      tools.push(
        ...[
          "Available REPL tools (JS functions) are listed below and are available through 'globalThis'. ",
          "Check docs(<tool.Name.String>) to get tool descriptions.",
          "Tools:",
          ...this.tools.map((t) => `- ${t}`),
        ]
      );

    // For router and replier
    const history: string[] = [];
    // if (
    //   input.step === 0 &&
    //   (this.type === "router" || this.type === "replier")
    // ) {
    //   let messages = await this.api.memoryStore.getMessages({
    //     threadId: "main",
    //     limit: 3,
    //   });
    //   // if (this.type === "router") {
    //   //   messages = messages.filter(m => m.id )
    //   // }

    //   history.push(
    //     ...[
    //       "Recent message history for context (use memory.* tools for more):",
    //       "```json",
    //       ...messages.map(
    //         (m) =>
    //           `- ${JSON.stringify({
    //             id: m.id,
    //             role: m.role,
    //             parts: m.parts,
    //             createdAt: m.metadata?.createdAt,
    //           })}`
    //       ),
    //       "```",
    //     ]
    //   );
    // }

    // For router
    const notes: string[] = [];
    if (input.step === 0 && this.type === "router") {
    }

    // For router
    const tasks: string[] = [];
    if (input.step === 0 && this.type === "router") {
      const tasks = await this.api.taskStore.listTasks(false, "worker");
    }

    const stepInfo = [
      "===STEP===",
      `Reason: ${input.reason}`,
      `Now: ${input.now}`,
    ];

    const stateInfo: string[] = [];
    if (state && this.type === "worker") {
      if (state.goal) stateInfo.push(...["===TASK_GOAL===", state.goal]);
      if (state.plan) stateInfo.push(...["===TASK_PLAN===", state.plan]);
      if (state.asks) stateInfo.push(...["===TASK_ASKS===", state.asks]);
      if (state.notes) stateInfo.push(...["===TASK_NOTES===", state.notes]);
    }

    const inbox = [
      "===TASK_INBOX===",
      "```json",
      input.inbox.map((s, i) => `${s}`).join("\n"),
      "```"
    ];

    const stepResults: string[] = [];
    if (input.result) {
      stepResults.push(
        ...[
          `===${input.result.ok ? "PREV_STEP_RESULT" : "PREV_STEP_ERROR"}===`,
          "```json",
          safeStringify(input.result.result || input.result.error, 10000),
          "```",
        ]
      );
    }

    return `
${job.join("\n")}

${tools.join("\n")}

${history.join("\n")}

${notes.join("\n")}

${tasks.join("\n")}

${stepInfo.join("\n")}

${stateInfo.join("\n")}

${inbox.join("\n")}

${stepResults.join("\n")}

`.trim();
  }

  private routerSystemPrompt() {
    return `
You are a sub-agent of a personal AI assistant. You can use REPL JS sandbox
to access memories and tools, to do calculations and to store intermediate data between steps.

You will process tasks generated by user or the host system. 
Task input and output will be in Markdown Sections Protocol (MSP).

You will receive task input including these sections:
- STEP - specifies current step info (why and when you're running)
- TASK_INBOX - list of new messages supplied by user
- PREV_STEP_RESULT - results of code execution of previous step
- PREV_STEP_ERROR - error of code execution of previous step

You must respond with task output using MSP sections below.
Do NOT include any prose outside these sections.

===STEP_KIND===
required, one of: code | done
===STEP_CODE===
\`\`\`js
// only when STEP_KIND=code; raw JS here, no escaping
\`\`\`
===TASK_REPLY===
only when STEP_KIND=done; reply for user
===STEP_REASONING===
optional, explain your decision for audit traces
===END===

Output guidelines:
- Prefer minimal, high-quality code cells.
- Do not add any extra sections or commentary to your output.

JS code guidelines:
- you MUST 'return' the value you need to receive (must be convertible to JSON)
- no 'fetch', no console.log/error, no direct network or disk
- do not wrap your code in '(async () => {...})()' - that's already done for you
- all tools are async and must be await-ed
`;
  }

  private workerSystemPrompt() {
    return `
You are a sub-agent of a personal AI assistant. You can use REPL JS sandbox
to access memories and tools, to do calculations and to store intermediate data between steps.

You will process tasks generated by user or the host system. 
Task input and output will be in Markdown Sections Protocol (MSP).

You MUST focus on the task goal, and avoid performing irrelevant actions.

You will receive task input including these sections:
- STEP - specifies current step info (why and when you're running)
- TASK_INBOX - list of new messages supplied by user
- TASK_GOAL - task goal
- TASK_NOTES - optional task notes that you returned on previous steps
- TASK_PLAN - optional task plan that you returned on previous steps
- TASK_ASKS - optional list of questions that you intended to ask the user on previous steps
- PREV_STEP_RESULT - results of code execution of previous step
- PREV_STEP_ERROR - error of code execution of previous step

You must respond with task output using MSP sections below.
Do NOT include any prose outside these sections.

===STEP_KIND===
required, one of: code | done | wait
===STEP_CODE===
\`\`\`js
// only when STEP_KIND=code, raw JS here, no escaping
\`\`\`
===TASK_REPLY===
optional, only when STEP_KIND = done or wait, message for user
===TASK_REASONING===
optional, only when STEP_KIND = done or wait, explain your decision for audit traces
===TASK_NOTES===
optional, only when STEP_KIND = wait, task context you want to save for yourself for later launch
===TASK_PLAN===
optional, only when STEP_KIND = wait, task plan you want to save for yourself for later launch
===TASK_ASKS===
optional, only when STEP_KIND = wait, list of questions you intend to ask the user
===TASK_RESUME_AT===
optional, only when STEP_KIND = wait, only when STEP_KIND=wait, ISO timestamp when you want to be launched next time
===END===

Task semantics:
- you cannot change TASK_GOAL, but you can use tools to create new tasks with clarified/new goal
- task may receive relevant user input in TASK_INBOX
- task will be launched on new user input or on timer you've set with TASK_RESUME_AT
- task may be interrupted at any step by host, and will be interrupted if you return STEP_KIND=wait
- code step results are not saved across interrupts, use TASK_NODES and TASK_PLAN to save important state

Workflow:
- You can generate code with STEP_KIND=code to use tools and fetch context
- You must end the coding loop with STEP_KIND=done or wait 
- If STEP_KIND=done, the task is marked as finished, TASK_REPLY must be specified
- If STEP_KIND=wait, the task is maked as waiting for user input or/and timer
- TASK_ASKS or/and TASK_RESUME_AT must be specified if STEP_KIND=wait
- use TASK_ASKS to schedule questions for user (will be asked multiple times until answered)
- use TASK_RESUME_AT to proceed later at specific time
- your loop might be interupted by higher-priority tasks, and your TASK_NOTES and TASK_PLAN are only saved if STEP_KIND=wait, so prefer to pause on long-running tasks (see example below).

Examples:
- Long-running job: run up to 20 code steps, return TASK_NOTES or/and TASK_PLAN to save the intermediate results and TASK_RESUME_AT=<now> and STEP_KIND=wait to get restarted immediately
- Single-shot reminder: check if it's time to remind, if so return TASK_REPLY=<reminder text> and STEP_KIND=done, otherwise return TASK_RESUME_AT and STEP_KIND=wait to schedule the run at proper time
- Recurring tasks (reminders): check if it's time to remind, if so return TASK_REPLY=<reminder text>, return TASK_RESUME_AT and STEP_KIND=wait to schedule the run at proper time
- Need user clarification: return STEP_KIND=wait and TASK_ASKS=<list of questions>, you will be launched again with user's message in TASK_INBOX
- Need user clarification with deadline: return STEP_KIND=wait and TASK_ASKS=<list of questions> and TASK_RESUME_AT=<deadline>, you will be launched again with user's message in TASK_INBOX or when deadline occurs
- Need to figure out user's goal: send some TASK_ASKS, when clarified create new task with proper goal and end this task with STEP_KIND=done

Output guidelines:
- Prefer minimal, high-quality code cells.
- Do not add any extra sections or commentary to your output.

JS code guidelines:
- you MUST 'return' the value you need to receive (must be convertible to JSON)
- code is sandboxed, no 'fetch', no console.log/error, no direct network or disk
- do not wrap your code in '(async () => {...})()' - that's already done for you
- all tools are async and must be await-ed
`;
  }
}

type Any = z.ZodTypeAny;

export const printSchema = (schema: Any): string => {
  const t = schema._def.typeName as K;

  if (schema.description) return "<" + schema.description + ">";

  switch (t) {
    case K.ZodString:
      return "string";
    case K.ZodNumber:
      return "number";
    case K.ZodBoolean:
      return "boolean";
    case K.ZodBigInt:
      return "bigint";
    case K.ZodDate:
      return "date";
    case K.ZodUndefined:
      return "undefined";
    case K.ZodNull:
      return "null";

    case K.ZodLiteral:
      return JSON.stringify((schema as z.ZodLiteral<any>)._def.value);

    case K.ZodEnum:
      return `enum(${(
        schema as z.ZodEnum<[string, ...string[]]>
      )._def.values.join(", ")})`;

    case K.ZodNativeEnum:
      return `enum(${Object.values(
        (schema as z.ZodNativeEnum<any>)._def.values
      ).join(", ")})`;

    case K.ZodArray: {
      const inner = (schema as z.ZodArray<Any>)._def.type;
      return `array<${printSchema(inner)}>`;
    }

    case K.ZodOptional:
      return `${printSchema((schema as z.ZodOptional<Any>)._def.innerType)}?`;

    case K.ZodNullable:
      return `${printSchema(
        (schema as z.ZodNullable<Any>)._def.innerType
      )} | null`;

    case K.ZodDefault:
      return `${printSchema(
        (schema as z.ZodDefault<Any>)._def.innerType
      )} (default)`;

    case K.ZodPromise:
      return `Promise<${printSchema((schema as z.ZodPromise<Any>)._def.type)}>`;

    case K.ZodUnion:
      return (schema as z.ZodUnion<[Any, ...Any[]]>)._def.options
        .map(printSchema)
        .join(" | ");

    case K.ZodIntersection: {
      const s = schema as z.ZodIntersection<Any, Any>;
      return `${printSchema(s._def.left)} & ${printSchema(s._def.right)}`;
    }

    case K.ZodRecord: {
      const s = schema as z.ZodRecord<Any, Any>;
      return `{ [key: ${printSchema(s._def.keyType)}]: ${printSchema(
        s._def.valueType
      )} }`;
    }

    case K.ZodTuple:
      return `[${(schema as z.ZodTuple)._def.items
        .map(printSchema)
        .join(", ")}]`;

    case K.ZodObject: {
      const obj = schema as z.ZodObject<any>;
      // In Zod v3, the shape is a function on _def:
      const shape = obj._def.shape();
      const body = Object.entries(shape)
        .map(([k, v]) => `${k}: ${printSchema(v as Any)}`)
        .join("; ");
      return `{ ${body} }`;
    }

    case K.ZodDiscriminatedUnion: {
      const du = schema as z.ZodDiscriminatedUnion<string, any>;
      // options is a Map in Zod; get its values:
      const options: any[] = Array.from(du._def.options.values());
      return options.map(printSchema).join(" | ");
    }

    case K.ZodEffects: {
      // If you want to "ignore" refinements/transforms for printing:
      const inner = (schema as z.ZodEffects<Any>)._def.schema;
      return printSchema(inner);
    }

    case K.ZodBranded: {
      const inner = (schema as z.ZodBranded<Any, any>)._def.type;
      return `${printSchema(inner)} /* branded */`;
    }

    default:
      // Fallback: show the Zod kind
      return t.replace("Zod", "").toLowerCase();
  }
};

function safeStringify(obj: any, cap: number): string {
  try {
    if (obj === undefined) return "undefined";
    const s = JSON.stringify(obj);
    return s.length > cap ? s.slice(0, cap - 1) + "…" : s;
  } catch {
    return "[unserializable result]";
  }
}
