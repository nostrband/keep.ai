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
      if (!(ns in global)) global[ns] = {};
      global[ns][name] = tool.execute;

      if (!("docs" in global)) global["docs"] = {};
      if (!(ns in global["docs"])) global["docs"][ns] = {};
      let desc = ["===Description===", tool.description];
      if (tool.inputSchema)
        desc.push(...["===Input===", printSchema(tool.inputSchema)]);
      if (tool.outputSchema)
        desc.push(...["===Output===", printSchema(tool.outputSchema)]);

      const doc = desc.join("\n");
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
      addTool(global, "tools", "weather", makeGetWeatherTool());
    }

    // Memory

    if (this.type !== "replier") {
      // Notes
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

      // Worker only
      if (this.type === "worker") {
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
      }
    }

    // Message history available for all agent types
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
        "Get list of recent messages exchanged with user, oldest-first.",
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

    // Router or Worker
    if (this.type !== "replier") {
      addTool(global, "tasks", "add", {
        execute: async (opts: {
          title: string;
          goal?: string;
          notes?: string;
          startAt?: string;
        }) => {
          const id = generateId();
          const timestamp = Math.floor(
            (opts.startAt ? new Date(opts.startAt).getTime() : Date.now()) /
              1000
          );
          await this.api.taskStore.addTask(
            id,
            timestamp,
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
          return {
            id,
            ...opts,
          };
        },
        description: "Create a background task",
        inputSchema: z.object({
          title: z
            .string()
            .describe("Task title for task management and audit"),
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
          startAt: z
            .string()
            .optional()
            .nullable()
            .describe("ISO date-time when task should be launched"),
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

      if (this.type === "worker") {
        //   addTool(global, "tasks", "cancelCurrentTask", {
        //     execute: async (opts: { reason?: string }) => {
        //       let { reason } = opts;
        //       if (typeof opts === "string") reason = opts;
        //       const context = this.getContext();
        //       if (!context) throw new Error("No eval context");
        //       if (context.type !== "worker")
        //         throw new Error("Only worker can cancel it's own task");
        //       this.debug("Cancel task", context.taskId);
        //       await this.api.taskStore.finishTask(
        //         context.taskId,
        //         "",
        //         "Cancelled",
        //         reason || "Cancelled"
        //       );
        //     },
        //     description: "Cancel this current task.",
        //     inputSchema: z.object({
        //       reason: z
        //         .string()
        //         .optional()
        //         .nullable()
        //         .describe("Cancel reason for audit traces"),
        //     }),
        //   });
      }

      addTool(global, "tasks", "sendToTaskInbox", {
        execute: async (opts: { id: string; message: string }) => {
          const task = await this.api.taskStore.getTask(opts.id);
          if (!task) throw new Error("Task not found");

          const context = this.getContext();
          if (!context) throw new Error("No eval context");
          if (context.type === "replier")
            throw new Error("Replier can't send to inbox");

          const id = `${context.taskThreadId}.${context.step}.${generateId()}`;
          await this.api.inboxStore.saveInbox({
            id,
            source: context.type,
            source_id: context.taskId,
            target: "worker",
            target_id: opts.id,
            timestamp: new Date().toISOString(),
            content: JSON.stringify({
              id,
              role: "assistant",
              content: opts.message,
            }),
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

  async buildUser(input: StepInput, state?: TaskState): Promise<string> {
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
              "- You may use `memory.*` tools to read context (read-only).",
              "- You may NOT update notes or make other side-effects directly; create tasks for that using `tasks.*`.",
              "- If a relevant task exists and the user message adds information → use `tasks.sendToTaskInbox`.",
              "- Before creating a new task ALWAYS check for existing relevant task.",
              "- If user's goal is unclear → create a task with a proper goal to clarify the input.",
              "- You may answer directly ONLY for simple one-shot read-only queries (e.g., 'what time is it?', 'calc 456*9876' etc), ",
              "otherwise route/spawn and keep the user reply minimal (emoji or a short confirmation).",
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
              "- Use available tools (memory.*) to understand context better.",
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
          'Available tools (via `globalThis`; call `docs("<ToolName>")` for details):',
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
      const messages = await this.api.memoryStore.getMessages({
        threadId: "main",
        limit: 3,
      });

      history.push(
        ...[
          "Recent message history for context (use memory.* tools for more).",
          "```json",
          ...messages.map(
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

## JS REPL code guidelines 
- you MUST 'return' the value you need to receive (must be convertible to JSON)
- no fetch, no console.log/error, no direct network or disk
- do not wrap your code in '(async () => {...})()' - that's already done for you
- tools are exposed on globalThis
- ALWAYS get tool descriptions via docs("<ToolName>") before use
- all tools are async and must be await-ed

## Time & locale
- Use the provided Now: timestamp from ===STEP=== as current time.
- If you re-schedule anything, use ISO strings.
- Assume time in user queries is in local timezone, must clarify timezone/location from notes or message history before handling time.

## Decision rubric

Your main job is to understand user messages with context and route (parts of) user messages to background tasks: 
- User messages may be complex, referring to multiple tasks/ideas/issues/projects, and/or combining complex requests with simple queries.
- You job is to use memory.* tools to understand and decompose the user messages into sub-parts to be routed to background tasks.
- If a relevant existing task is found → send to its inbox, otherwise create new task with a goal and notes.
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

## JS REPL code guidelines 
- you MUST 'return' the value you need to receive (must be convertible to JSON)
- no fetch, no console.log/error, no direct network or disk
- do not wrap your code in '(async () => {...})()' - that's already done for you
- tools are exposed on globalThis, get descriptions via docs("<ToolName>")
- all tools are async and must be await-ed

## Time & locale
- Use the provided Now: timestamp from ===STEP=== as current time.
- Assume time in user queries is in local timezone, must clarify timezone/location from notes or message history before handling time.

## Threading
- If the latest user message is directly related (same episode/thread), produce a follow-up style reply.
- If unrelated, briefly anchor context (i.e. “Re: <topic>”) at the start, then reply.

## Staleness & deduping
- Prefer the newest draft for the same topic; drop older near-duplicates.
- Use timestamps from ===STEP=== and metadata to decide staleness.
- Check recent message history (memory.*):
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
- fetch context (memory.* tools) 
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

## JS REPL code guidelines 
- you MUST 'return' the value you need to receive (must be convertible to JSON)
- no fetch, no console.log/error, no direct network or disk
- do not wrap your code in '(async () => {...})()' - that's already done for you
- tools are exposed on globalThis, get descriptions via docs("<ToolName>")
- all tools are async and must be await-ed

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
- You may use memory.notes* tools to store system-wide notes if task knowledge might benefit user later.
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
