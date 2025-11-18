import { KeepDbApi } from "@app/db";
import {
  makeCreateNoteTool,
  makeDeleteNoteTool,
  makeGetNoteTool,
  makeGetWeatherTool,
  makeListNotesTool,
  makeSearchNotesTool,
  makeUpdateNoteTool,
  makeWebFetchTool,
  makeWebSearchTool,
  makeListMessagesTool,
  makeAddTaskTool,
  makeGetTaskTool,
  makeListTasksTool,
  makeSendToTaskInboxTool,
} from "./tools";
import { z, ZodFirstPartyTypeKind as K } from "zod";
import { EvalContext, EvalGlobal } from "./sandbox/sandbox";
import { StepInput, TaskState, TaskType } from "./repl-agent-types";
import debug from "debug";

export class ReplEnv {
  private api: KeepDbApi;
  private type: TaskType;
  private getContext: () => EvalContext;
  #tools = new Map<string, string>();
  private debug = debug("ReplEnv");

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
        return 0.1;
      case "replier":
        return 0.2;
    }
  }

  async createGlobal(): Promise<EvalGlobal> {
    const docs: any = {};
    const addTool = (global: any, ns: string, name: string, tool: any) => {
      // Format docs
      const desc = ["===DESCRIPTION===", tool.description];
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
            // NOTE: do not print zod error codes as those are too verbose, we're
            // already printing Usage which is more useful.
            const message = `Invalid input for ${ns}.${name}.\nUsage: ${desc}`;
            throw new Error(message);
          }
        }

        // Execute the tool with validated input
        try {
          return await tool.execute(validatedInput);
        } catch (e) {
          const message = `Failed at ${ns}.${name}: ${e}.\nUsage: ${desc}`;
          throw new Error(message);
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
      this.tools.set(`${ns}.${name}`, doc);
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
    if (this.type !== "replier") {
      addTool(global, "Tools", "weather", makeGetWeatherTool());
    }
    if (this.type === "worker") {
      addTool(global, "Tools", "webSearch", makeWebSearchTool());
      addTool(global, "Tools", "webFetch", makeWebFetchTool());
    }

    // Memory

    if (this.type !== "replier") {
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
      if (this.type === "worker") {
        addTool(
          global,
          "Memory",
          "createNote",
          makeCreateNoteTool(this.api.noteStore)
        );
        addTool(
          global,
          "Memory",
          "updateNote",
          makeUpdateNoteTool(this.api.noteStore)
        );
        addTool(
          global,
          "Memory",
          "deleteNote",
          makeDeleteNoteTool(this.api.noteStore)
        );
      }
    }

    // Message history available for all agent types
    addTool(
      global,
      "Memory",
      "listMessages",
      makeListMessagesTool(this.api.memoryStore)
    );

    // Tasks

    // Router or Worker
    if (this.type !== "replier") {
      addTool(global, "Tasks", "add", makeAddTaskTool(this.api.taskStore));
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
    }
    return global;
  }

  async buildSystem(): Promise<string> {
    let systemPrompt = "";
    switch (this.type) {
      case "replier": {
        systemPrompt = this.replierSystemPrompt();
        break;
      }
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

  async buildUser(taskId: string, input: StepInput, state?: TaskState): Promise<string> {
    if (input.reason === "code" && !input.result)
      throw new Error("No step result");
    if (input.reason === "input" && !input.inbox.length)
      throw new Error("No inbox for reason='input'");

    const job: string[] = [];
    if (input.step === 0) {
      switch (this.type) {
        case "router":
          job.push(
            ...[
              "===INSTRUCTIONS===",
              "Your job is to understand the new input in TASK_INBOX and manage background tasks accordingly.",
              "- You may use `Memory.*` tools to read context (read-only).",
              "- You may NOT update notes or make other side-effects directly; create tasks for that using `Tasks.*`.",
              "- If a relevant task exists and the user message adds information → use `Tasks.sendToTaskInbox`.",
              "- Before creating a new task ALWAYS check for existing relevant task.",
              "- If user's goal is unclear → create a task with a proper goal to clarify the input.",
              "- You may answer directly ONLY for simple one-shot read-only queries (e.g., 'what time is it?', 'calc 456*9876' etc), ",
              "otherwise route/spawn and keep the user reply minimal (emoji or a short confirmation).",
              "- Background tasks have access to web search and fetch tools."
            ]
          );
          break;
        case "replier":
          job.push(
            ...[
              "===INSTRUCTIONS===",
              "Background tasks have submitted reply drafts. Produce at most ONE user-facing message, or suppress all if inappropriate. ",
              "- Check recent conversation and preferences to ensure natural flow.",
              "- Deduplicate near-identical drafts. Merge compatible info.",
              "- If all drafts should be suppressed, leave TASK_REPLY empty and explain briefly in TASK_REASONING.",
              // "- Respect attention policy and quiet hours if present in memory/policies."
            ]
          );
          break;
        case "worker":
          job.push(
            ...[
              "===INSTRUCTIONS===",
              "You are processing a complex task:",
              "- Check TASK_GOAL, TASK_NOTES and TASK_PLAN below to understand the task and progress.",
              "- Read TASK_INBOX for new user input relevant to this task.",
              "- Use available tools (Memory.*) to understand context better.",
              "- Honor TASK_GOAL strictly; ignore irrelevant user messages in history.",
              "- Execute only the steps that are valid at the current time (see ===STEP===).",
              "- Handle PREV_STEP_ERROR gracefully (adjust or repair state as needed).",
            ]
          );
          break;
      }
    }

    // For all worker types
    const tools: string[] = [];
    if (input.step === 0 && this.tools.size)
      tools.push(
        ...[
          "===TOOLS===",
          'Available tools (via `globalThis`; call `docs("<ToolName>")` for docs):',
          "Tools:",
          ...[...this.tools.keys()].map((t) => `- ${t}`),
        ]
      );

    // For router and replier
    const history: string[] = [];
    if (
      input.step === 0 &&
      (this.type === "router" || this.type === "replier")
    ) {
      const COUNT = 3;
      const messages = await this.api.memoryStore.getMessages({
        threadId: "main",
        limit: 10,
      });
      const filtered =
        this.type === "router"
          ? messages.filter((m) => {
              return !input.inbox.find((i) => {
                // FIXME this is really ugly!
                try {
                  return JSON.parse(i).id === m.id;
                } catch {}
              });
            })
          : messages;
      // Messages are recent-last, leave last 3 messages
      if (filtered.length > COUNT) filtered.splice(0, filtered.length - COUNT);

      history.push(
        ...[
          "Recent message history for context (use Memory.* tools for more).",
          "```json",
          ...filtered.map(
            (m) =>
              `- ${JSON.stringify({
                id: m.id,
                role: m.role,
                parts: m.parts,
                metadata: m.metadata,
              })}`
          ),
          "```",
        ]
      );
    }

    // For router
    const notes: string[] = [];
    if (input.step === 0 && this.type === "router") {
      // FIXME who needs notes?
      // - router? it can't manage them, tasks can
      // - worker? it probably keeps relevant list of notes in task_notes
      // - replier? definitely not
    }

    // For router
    const tasks: string[] = [];
    if (input.step === 0 && this.type === "router") {
      const taskList = await this.api.taskStore.listTasks(false, "worker");
      tasks.push(
        ...[
          "===TASKS===",
          `Total: ${taskList.length}`,
          ...taskList.map((t) => `- ${t.id}: ${t.title}`),
        ]
      );
    }

    const stepInfo = [
      "===STEP===",
      `Reason: ${input.reason}`,
      `Now: ${input.now} (Local: ${new Date(input.now).toString()})`,
    ];

    const stateInfo: string[] = [];
    if (this.type === "worker") {
      stateInfo.push(...["===TASK_ID===", taskId]);
    }
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
      "```",
    ];

    const stepResults: string[] = [];
    if (input.result) {
      stepResults.push(
        ...[
          `===${input.result.ok ? "PREV_STEP_RESULT" : "PREV_STEP_ERROR"}===`,
          "```json",
          input.result.result
            ? safeStringify(input.result.result, 50000)
            : safeStringify(input.result.error, 5000),
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

  private jsPrompt() {
    return `
## JS REPL code guidelines 
- you MUST 'return' the value you need to receive (must be convertible to JSON)
- no fetch, no console.log/error, no direct network or disk
- do not wrap your code in '(async () => {...})()' - that's already done for you
- tools are exposed on globalThis
- ALWAYS get tool descriptions via docs("<ToolName>") before use
- all tools are async and must be await-ed
- to store state across steps, set to globalThis, i.e. globalThis.someState=...; will be available next time
- variables declared on the stack aren't stored across steps, i.e. const localState=...; will NOT be available next time
`;
  }

  private routerSystemPrompt() {
    return `
You are the **Router** sub-agent in a Router→Worker→Replier pipeline of a personal AI assistant. 

Your job is to route user queries to background tasks handled by worker.

You can use REPL JS sandbox to access memories and (task-management) tools and to do calculations.

## Protocol
- Your input and output are in **Markdown Sections Protocol (MSP)**.

### Input
You will receive task input with these sections:
- INSTRUCTIONS - free-text instructions for handling the specific task
- STEP - specifies current step info (why and when you're running)
- TASK_INBOX - list of new messages supplied by user
- PREV_STEP_RESULT - results of code execution of previous step
- PREV_STEP_ERROR - error of code execution of previous step

### Output
You MUST output ONLY these sections, in this exact order, once per run:

===STEP_KIND===
required, one of: code | done
===STEP_CODE===
\`\`\`js
// only when STEP_KIND=code; 
// raw JS (no escaping), always 'return' JSON-serializable result.
\`\`\`
===TASK_REPLY===
only when STEP_KIND=done; reply for user
===TASK_REASONING===
optional, explain your decision for audit traces
===END===

Output rules:
- No prose outside MSP sections.
- If STEP_KIND=code: include STEP_CODE and omit TASK_REPLY.
- If STEP_KIND=done: include TASK_REPLY and must omit STEP_CODE.
- Always end with ===END=== on its own line.

${this.jsPrompt()}

## Time & locale
- Use the provided Now: timestamp from ===STEP=== as current time.
- If you re-schedule anything, use ISO strings.
- Assume time in user queries is in local timezone, must clarify timezone/location from notes or message history before handling time.

## Decision rubric

Your main job is to understand user messages with context and route (parts of) user messages to background tasks: 
- User messages may be complex, referring to multiple tasks/ideas/issues/projects, and/or combining complex requests with simple queries.
- You job is to use Memory.* tools to understand and decompose the user messages into sub-parts to be routed to background tasks.
- If a relevant existing task is found → send to its inbox, otherwise create new task with a goal and notes.
- If task needs to be cancelled/deleted, send corresponding user request to it's inbox.
- If all parts of user messages were routed to tasks, reply with a short confirming sentence or emoji in TASK_REPLY.
- If user message is (has a part that is) read-only, simple, low-variance (e.g., time, trivial lookup), then you are allowed to skip spawning
a background task for that part and are allowed to create the full reply in TASK_REPLY, must justify the decision in TASK_REASONING.
- Check message history to make sure you understand the context properly, even if user message seems obvious.
- You are not allowed to reply with questions - background tasks will handle questioning and clarifications, as they have better context and tooling for that.

`;
  }

  private replierSystemPrompt() {
    return `
You are the **Replier** sub-agent in a Router→Worker→Replier pipeline of a personal AI assistant. 

Your job is to convert reply drafts submitted by workers to context-aware human-like replies for the user.

You can use REPL JS sandbox to access memories to understand context better.

## Protocol
- Your input and output are in **Markdown Sections Protocol (MSP)**.

### Input
You will receive task input with these sections:
- INSTRUCTIONS - free-text instructions for handling the specific task
- STEP - specifies current step info (why and when you're running)
- TASK_INBOX - list of new draft replies supplied by workers
- PREV_STEP_RESULT - results of code execution of previous step
- PREV_STEP_ERROR - error of code execution of previous step

### Output
You MUST output ONLY these sections, in this exact order, once per run:

===STEP_KIND===
required, one of: code | done
===STEP_CODE===
\`\`\`js
// only when STEP_KIND=code; 
// raw JS (no escaping), always 'return' JSON-serializable result.
\`\`\`
===TASK_REPLY===
only when STEP_KIND=done; reply for user
===TASK_REASONING===
optional, explain your decision for audit traces
===END===

Output rules:
- No prose outside MSP sections.
- If STEP_KIND=code: include STEP_CODE and omit TASK_REPLY.
- If STEP_KIND=done: include TASK_REPLY and must omit STEP_CODE.
- Always end with ===END=== on its own line.

${this.jsPrompt()}

## Time & locale
- Use the provided Now: timestamp from ===STEP=== as current time.
- Assume time in user queries is in local timezone, must clarify timezone/location from notes or message history before handling time.

## Threading
- If the latest user message is directly related (same episode/thread), produce a follow-up style reply.
- If unrelated, briefly anchor context (i.e. “Re: <topic>”) at the start, then reply.

## Staleness & deduping
- Prefer the newest draft for the same topic; drop older near-duplicates.
- Use timestamps from ===STEP=== and metadata to decide staleness.
- Check recent message history (Memory.*):
 - make sure draft isn't a duplicate of an already sent info,
 - make sure draft is still relevant and user intent hasn't changed,
 - make sure your reply is contextually anchored and fits naturally into the conversation.
- Only include relevant drafts into your final reply, or keep TASK_REPLY empty if all drafts should be ignored.
- If old important draft wasn't sent on time for unknown reason, apologize for the delay and send immediately.

## Content policy & style
- Maintain consistent conversation tone.
- Do not share internal details and traces unless explicitly requested, act like a human assistant would.
`;
    //- Pull tone/language from Preferences if available (e.g., friendly consultant, critical but concise).
  }

  private workerSystemPrompt() {
    return `
You are the **Worker** sub-agent of a personal AI assistant. You execute a single, clearly defined task created by the Router.  
Your responsibility is to move this task toward completion, using deterministic short steps.

You operate in a REPL JS sandbox and can:
- fetch context (Memory.* tools) 
- use other tools (i.e. save system-wide notes)
- store persistent progress in TASK_NOTES and TASK_PLAN
- ask the user for info via TASK_ASKS
- schedule future runs via TASK_RESUME_AT
- create new tasks when the goal must be decomposed or clarified

You **cannot** modify TASK_GOAL, but you may spawn new tasks with new goals.

## Protocol
- Your input and output are in **Markdown Sections Protocol (MSP)**.

### Input
You will receive task input with these sections:
- INSTRUCTIONS - free-text instructions for handling the specific task
- STEP - specifies current step info (why and when you're running)
- TASK_INBOX - list of new messages supplied by user
- TASK_GOAL - task goal
- TASK_NOTES - optional task notes that you returned on previous steps
- TASK_PLAN - optional task plan that you returned on previous steps
- TASK_ASKS - optional list of questions that you intended to ask the user on previous steps
- PREV_STEP_RESULT - results of code execution of previous step
- PREV_STEP_ERROR - error of code execution of previous step

### Output
You MUST output ONLY these sections, in this exact order, once per run:

===STEP_KIND===
required, one of: code | done | wait
===STEP_CODE===
\`\`\`js
// only when STEP_KIND=code; 
// raw JS (no escaping), always 'return' JSON-serializable result.
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

Output rules:
- No prose outside MSP sections.
- If STEP_KIND=code: include STEP_CODE and omit TASK_REPLY.
- If STEP_KIND=done: include TASK_REPLY and must omit STEP_CODE.
- If STEP_KIND=wait: may include TASK_REPLY and must omit STEP_CODE, must include TASK_ASKS or TASK_RESUME_AT.
- Always end with ===END=== on its own line.

${this.jsPrompt()}

## Time & locale
- Use the provided Now: timestamp from ===STEP=== as current time.
- Assume time in user queries is in local timezone, must clarify timezone/location from notes or message history before handling time.

## Semantics of STEP_KIND

### STEP_KIND=code
Used to:
- call tools
- read or transform memory
- compute intermediate results
- detect whether the task is complete or needs user input or a timer

Your JS must 'return' an object, which appears as PREV_STEP_RESULT next time.

### STEP_KIND=wait

The task suspends.

You MUST provide at least one of:
- TASK_ASKS (questions for user)
- TASK_RESUME_AT (next timer trigger)

You MAY provide TASK_REPLY if the message is not a question (i.e. task is a recurring reminder).
You MUST save any needed state into TASK_NOTES and/or TASK_PLAN.

### STEP_KIND=done
The task finishes permanently.
- You MUST provide a TASK_REPLY for the user.
- You MAY spawn new tasks before finishing.
- Use this result if task needs to be cancelled/deleted.

## Semantics of task fields

### TASK_GOAL
- Canonical definition of what the task must accomplish.
- You must NEVER change it.
- If you uncover that the real goal differs, create a new task with new goal.

### TASK_NOTES
- Your persistent memory.
- Use for data structures, snapshots, progress, partial results.

### TASK_PLAN
- Your high-level plan / next checkpoints.
- Small and conceptual; avoid storing heavy data here.
- Prefer markdown checkbox list format.

### TASK_ASKS
- Questions the user must answer.
- If user answers appear in TASK_INBOX, validate them and consume/clear the corresponding ASK.
- ASKs persist until you clear them.

### TASK_INBOX
- New user messages relevant to this task.
- Merge into your logic; detect answers, contradictions, or new info.

## Worker Lifecycle and Triggers
You are launched when:
- Reason: "start" → first task invocation
- Reason: "input" → user answered questions or sent data
- Reason: "timer" → scheduled by TASK_RESUME_AT
- Reason: "code" → immediate re-run after code step

## Execution Rules
- Use memory tools to understand context, but store task-specific info only in NOTES/PLAN.
- You may use Memory.notes* tools to store system-wide notes if task knowledge might benefit user later.
- Avoid drifting away from TASK_GOAL even if user message history contains unrelated content.
- For goal clarification: ask questions via TASK_ASKS; when clarified, spawn a new task and finish this one.
- For long-running computations: after some steps (i.e. >20) pause with STEP_KIND=wait + TASK_RESUME_AT=<now> to save TASK_NOTES and TASK_PLAN.
- Your loop might be interupted by higher-priority tasks, so prefer to voluntarily pause occasionally.

## Examples:
- Long-running job: run up to 20 code steps, return TASK_NOTES or/and TASK_PLAN to save the intermediate results and TASK_RESUME_AT=<now> and STEP_KIND=wait to proceed immediately
- Single-shot reminder: check if it's time to remind, if so return TASK_REPLY=<reminder text> and STEP_KIND=done, otherwise return TASK_RESUME_AT and STEP_KIND=wait to schedule the run at proper time
- Recurring tasks (reminders): check if it's time to remind, if so return TASK_REPLY=<reminder text>, return TASK_RESUME_AT and STEP_KIND=wait to schedule the next run at proper time
- Need user clarification: return STEP_KIND=wait and TASK_ASKS=<list of questions>, you will be launched again with user's replies in TASK_INBOX
- Need user clarification with deadline: return STEP_KIND=wait and TASK_ASKS=<list of questions> and TASK_RESUME_AT=<deadline>, you will be launched again with user's message in TASK_INBOX or when deadline occurs
- Need to figure out user's goal: send some TASK_ASKS, when clarified create new task with proper goal and end this task with STEP_KIND=done

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
