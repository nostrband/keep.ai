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
  makeAddTaskRecurringTool,
  makeCancelThisRecurringTaskTool,
  makePostponeInboxItemTool,
} from "./tools";
import { z, ZodFirstPartyTypeKind as K } from "zod";
import { EvalContext, EvalGlobal } from "./sandbox/sandbox";
import { StepInput, TaskState, TaskType } from "./repl-agent-types";
import debug from "debug";
import { getEnv } from "./env";

export class ReplEnv {
  private api: KeepDbApi;
  private type: TaskType;
  private cron: string;
  private getContext: () => EvalContext;
  #tools = new Map<string, string>();
  private debug = debug("ReplEnv");

  constructor(
    api: KeepDbApi,
    type: TaskType,
    cron: string,
    getContext: () => EvalContext
  ) {
    this.api = api;
    this.type = type;
    this.cron = cron;
    if (type !== "worker" && cron)
      throw new Error("Only worker tasks can be recurring");
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
          const result = await tool.execute(validatedInput);
          this.debug("Tool called", {
            name,
            input,
            context: this.getContext(),
            result,
          });
          return result;
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

    // Tools
    if (this.type !== "replier") {
      addTool(global, "Tools", "weather", makeGetWeatherTool(this.getContext));
    }
    if (this.type === "worker") {
      addTool(global, "Tools", "webSearch", makeWebSearchTool(this.getContext));
      addTool(
        global,
        "Tools",
        "webFetchParse",
        makeWebFetchTool(this.getContext)
      );
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
      }
    }

    // Message history available for all agent types
    addTool(
      global,
      "Memory",
      "listMessages",
      makeListMessagesTool(this.api.chatStore)
    );

    // Tasks

    // Router or Worker
    if (this.type !== "replier") {
      addTool(
        global,
        "Tasks",
        "add",
        makeAddTaskTool(this.api.taskStore, this.getContext)
      );
      addTool(
        global,
        "Tasks",
        "addRecurring",
        makeAddTaskRecurringTool(this.api.taskStore, this.getContext)
      );
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

      // Only add cancel tool for recurring tasks
      if (this.cron) {
        addTool(
          global,
          "Tasks",
          "cancelThisRecurringTask",
          makeCancelThisRecurringTaskTool(this.getContext)
        );
      }
    }

    // Inbox management tools for replier
    if (this.type === "replier") {
      addTool(
        global,
        "inbox",
        "postponeInboxItem",
        makePostponeInboxItemTool(this.api.inboxStore, this.getContext)
      );
    }

    return global;
  }

  async buildSystem(): Promise<string> {
    let systemPrompt = "";
    switch (this.type) {
      case "router": {
        systemPrompt = this.routerSystemPrompt();
        break;
      }
      case "worker": {
        systemPrompt = this.workerSystemPrompt();
        break;
      }
      case "replier": {
        systemPrompt = this.replierSystemPrompt();
        break;
      }
    }
    this.debug("system prompt: ", systemPrompt);

    return `
${systemPrompt}
`.trim();
  }

  async buildUser(
    taskId: string,
    input: StepInput,
    state?: TaskState
  ): Promise<string> {
    if (input.reason === "code" && !input.result)
      throw new Error("No step result");
    if (input.reason === "input" && !input.inbox.length)
      throw new Error("No inbox for reason='input'");

    const job: string[] = ["===INSTRUCTIONS==="];
    if (input.step === 0) {
      switch (this.type) {
        case "router":
          job.push(
            ...[
              "Your job is to understand the new input in TASK_INBOX and manage background tasks accordingly.",
              "- First, you MUST check docs before coding!",
              "- Before creating a new task ALWAYS check for existing relevant task.",
              "- If a relevant task exists and the user message adds information → use `Tasks.sendToTaskInbox`.",
              "- If user's goal is unclear → create a task with a proper goal to clarify the input.",
              "- You may answer directly ONLY for simple one-shot read-only queries (e.g., 'what time is it?', 'calc 456*9876' etc), ",
              "otherwise route/spawn and keep the user reply minimal (emoji or a short confirmation).",
              "- You may also ask clarifying questions if it's unclear which task the user refers to.",
              "- Background tasks have access to many tools, create background task if your tool list is limiting.",
            ]
          );
          break;
        case "replier":
          job.push(
            ...[
              "Background tasks have submitted reply drafts. Produce at most ONE user-facing message: ",
              "- Check recent conversation and preferences to ensure natural conversation flow.",
              "- Deduplicate near-identical drafts. Merge compatible info.",
              "- If all drafts should be suppressed, leave TASK_REPLY empty.",
              // "- Respect attention policy and quiet hours if present in memory/policies."
            ]
          );
          break;
        case "worker":
          job.push(
            ...[
              "You are processing a complex task:",
              "- Check TASK_GOAL, TASK_NOTES and TASK_PLAN below to understand the task and progress.",
              "- First, think through which tools you might need to achieve the goal.",
              "- Memory.* tools can be useful to understand context better.",
            ]
          );
          if (input.inbox.length)
            job.push(
              "- Read TASK_INBOX for new user input relevant to this task."
            );
          break;
      }
    } else {
      if (input.result?.ok)
        job.push(
          "- Read PREV_STEP_RESULT to understand what was returned by previous code step."
        );
      else
        job.push(
          "- Read PREV_STEP_ERROR to understand what went wrong with the previous code step."
        );
    }

    // For all worker types
    // const tools: string[] = [];
    // if (this.type !== "worker") {
    //   if (input.step === 0 && this.tools.size)
    //     tools.push(
    //       ...[
    //         "===TOOLS===",
    //         'Available tools (via `globalThis`; call `getDocs("<ToolName>")` for docs):',
    //         "Tools:",
    //         ...[...this.tools.keys()].map((t) => `- ${t}`),
    //       ]
    //     );
    // }

    // For router and replier
    const history: string[] = [];
    if (
      // FIXME looks useless
      false &&
      input.step === 0 &&
      (this.type === "router" || this.type === "replier")
    ) {
      const COUNT = 3;
      // FIXME use chatStore.getChatMessages
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
          "===HISTORY===",
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
    // Never taken into account by the model...
    // if (input.step === 0 && this.type === "router") {
    //   const taskList = await this.api.taskStore.listTasks(false, "worker");
    //   tasks.push(
    //     ...[
    //       "===TASKS===",
    //       `Active tasks (${taskList.length}): `,
    //       ...taskList.map((t) => `- ${t.id}: ${t.title}`),
    //     ]
    //   );
    // }

    const stepInfo = [
      "===STEP===",
      `Reason: ${input.reason}`,
      `Now: ${input.now} (Local: ${new Date(input.now).toString()})`,
    ];
    if (this.cron) stepInfo.push(`Cron: '${this.cron}'`);

    const stateInfo: string[] = [];
    if (input.step === 0) {
      if (state && this.type === "worker") {
        stateInfo.push(...["===TASK_ID===", taskId]);
        if (state.goal) stateInfo.push(...["===TASK_GOAL===", state.goal]);
        if (state.plan) stateInfo.push(...["===TASK_PLAN===", state.plan]);
        if (state.asks) stateInfo.push(...["===TASK_ASKS===", state.asks]);
        if (state.notes) stateInfo.push(...["===TASK_NOTES===", state.notes]);
      }
    }

    const inbox: string[] = [];
    if (input.inbox.length) {
      inbox.push(
        ...[
          "===TASK_INBOX===",
          "```json",
          input.inbox.map((s, i) => `${s}`).join("\n"),
          "```",
        ]
      );
    }

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

${
  "" // tools.join("\n")
}

${history.join("\n")}

${notes.join("\n")}

${tasks.join("\n")}

${stepInfo.join("\n")}

${stateInfo.join("\n")}

${inbox.join("\n")}

${stepResults.join("\n")}

`.trim();
  }

  private localePrompt() {
    const locale = getEnv().LANG || "en-US";
    return `- User's locale/language is '${locale}' - always answer in this language.`;
  }

  private toolsPrompt() {
    if (!this.tools.size) return "";
    return `## Tools
Tools are accessible in JS sandbox through \`globalThis\`.

Guidelines:
- if you plan to use tools, first coding step SHOULD be getting the tool docs
 - call \`getDocs("<ToolName>")\` for each tool you plan to use
 - return all docs on this step, to read them on next step and generate proper tool calling code
- all tools are async and must be await-ed
- if you are calling a sequence of tools, CHECK THE DOCS FIRST to make sure you are calling them right, otherwise first call might succeed but next one fails and you'll retry and will cause duplicate side-effects
- you only have tools listed below, no other tools are available to you right now

Tools:
${[...this.tools.keys()].map((t) => `- ${t}`).join("\n")}
`;
  }

  private jsPrompt() {
    return `## Coding guidelines 
- no fetch, no console.log/error, no direct network or disk
- do not wrap your code in '(async () => {...})()' - that's already done for you
- you MUST return an object of this structure: { result: any, state?: any }
- returned 'result' will be sent back to you on the next step for evaluation
- returned optional 'state' will be kept in the JS sandbox and available on \`globalThis.state\` on next code steps
- all global variables are reset after code eval ends, return 'state' to keep data for next steps
- returned value must be convertible to JSON

### Coding example
Step 0, getting tool docs:
\`\`\`js
return {
  result: {
    firstTool: getDocs("firstTool"),
    secondTool: getDocs("secondTool"),
  }
}
\`\`\`

Step 1, executing proper tools, testing output and keeping results for next step:
\`\`\`js
const data = await firstTool(properArgs);
const lines = data.split("\\n");
return {
  state: lines,
  result: lines.filter(line => line.includes("test")).length
}
\`\`\`

Step 2, decided to read all lines with "test"
\`\`\`js
// 'state' is on globalThis after being returned as 'state' on Step 1
const lines = state
return {
  result: lines.filter(line => line.includes("test"))
}
\`\`\`

Step 3: reply to user with some info from returned 'lines'.
`;
  }

  private whoamiPrompt() {
    return `## What are you?
If user asks what/who you are, or what you're capable of, here is what you should reply:
- your name is 'Keep', you are a personal AI assistant
- you are privacy-focused (user's data stays on their devices) and proactive (can reach-out to user, not just reply to queries)
- you can search and browse the web, run calculations, answer questions, take notes and work on tasks in the background
- you can help user get more organized, help manage tasks, help with creative work, automate recurring work, etc
`;
  }

  private userInputPrompt() {
    return `## User Input
- Your primary objective is to help user, but user input isn't always clear, and user might make mistakes
- It is ok to ask clarifying questions, to suggest alternatives or improvements, and to admit that you didn't fully understand what's needed
- If possible, make your questions/suggestions specific, in yes/no or numbered-list-options format, so user could answer easily
`;
  }

  private extraSystemPrompt() {
    const extra = getEnv().EXTRA_SYSTEM_PROMPT || "";
    if (!extra) return "";
    
    // Unescape the escaped values from .env storage
    // Note: Order matters - unescape newlines and quotes first, then backslashes
    return extra
      .replace(/\\n/g, "\n")    // Unescape newlines
      .replace(/\\"/g, '"')     // Unescape double quotes
      .replace(/\\\\/g, "\\");  // Unescape backslashes (must be last)
  }

  private routerSystemPrompt() {
    const type = "Router";
    return `
You are the **${type}** sub-agent in a Router→Worker→Replier pipeline of a personal AI assistant. 

Your job is to route user queries to background tasks handled by worker.

You will be given the latest user message which you should handle iteratively, step by step. At each step you have two options:
- generate code for JS sandbox to access tools/scripting - adds a step into this ${type} sub-agent conversation
- end the processing of user message with a reply for user

You only see the latest message as input, but that is always part of a big onboing conversation. Always start by checking message history (Memory.* tools) and tasks (Tasks.* tools) to understand what user is talking about and what the active tasks are.

## Decision rubric
Your main job is to understand user messages within context and route (parts of) user messages to background tasks: 
- User messages may be complex, referring to multiple tasks/ideas/issues/projects, and/or combining complex requests with simple queries.
- You job is to use Memory.* tools to understand new user messages and then decompose them into sub-parts to be routed to background tasks.
- Task might be relevant by title/topic/goal, or by the 'asks' property - the list of questions task has asked and expecting replies for.
- If user is quoting something, look for quoted part in the message history to understand the potential source task.
- If a relevant existing task is found → send to its inbox, otherwise create new task with a goal and notes (no need to send to new task's inbox).
- Before creating new tasks, ALWAYS think if it makes sense to clarify what exactly user's intent is, especially before creating multiple tasks.
- If task needs to be cancelled/deleted, send corresponding user request to it's inbox.
- If all parts of user messages were routed to tasks, reply with a short confirming sentence or emoji in TASK_REPLY.
- If user message is (has a part that is) read-only, simple, low-variance (e.g., time, trivial lookup), then you are allowed to skip spawning a background task for that part and are allowed to create the full reply in TASK_REPLY.
- Check message history to make sure you understand the context properly, even if user message seems obvious.
- You are allowed to reply with clarifying questions if you are unsure about the user's intent or scope/goals of potential tasks.
- If user is asking for tools that you don't have, create background task - those have more tools.

## Background tasks
- If relevant task exists - send input to task's inbox
- If you create a new task, no need to send to it's inbox - provide the input as task goal and notes
- Always supply a meaningful task title to simplify search/routing later
- Background tasks have powerful tools, including web and search access, delegate to background task if unsure about tools

## Protocol
- Your input and output are in **Markdown Sections Protocol (MSP)**. You must strictly follow the Output protocol below and avoid any prose outside the MSP sections. 

### Input
- Your input will contain ===INSTRUCTIONS=== and ===STEP=== sections
- Pay attention to current time provided at ===STEP=== section, you are helping user throughout their day and timing always matters
- ===TASK_INBOX=== will include the new user message to be processed
- Other sections will be included depending on the state of processing

### Output
- You MUST start with ===STEP_REASONING=== section, where you outline your though process on how and why you plan to act on this step
- Next section MUST be ===STEP_KIND=== with one of: code | done
 - 'code' is used when you need to run some JS code to access tools/context/calculations
 - 'done' is used to end the task and schedule a reply to the user
- Avoid unnecessary coding if the task can be completed with the info you already have
- Output sections allowed for each STEP_KIND are defined below
- Always end with ===END=== on its own line, no other output is allowed after ===END===
- ONLY ONE ===STEP_KIND=== .... ===END=== section group must be present per output message

#### STEP_KIND=code
- Choose STEP_KIND=code if you need to access tools/context/calculations with JS sandbox
- After STEP_KIND=code, print ===STEP_CODE=== section, like this:
===STEP_CODE===
\`\`\`js
// raw JS (no escaping), details below in 'Coding guidelines'
\`\`\`
===END===
- Follow ===STEP_CODE=== with ===END===
- The STEP_CODE will be executed and it's 'return'-ed value supplied back to you to evaluate and decide on the next step.

#### STEP_KIND=done
- Choose STEP_KIND=done if the task goal is achieved and you are ready to reply to user 
- Print ===TASK_REPLY=== section with your reply for user, like this:
===TASK_REPLY===
<your reply to user>
===END===
- Follow ===TASK_REPLY=== with ===END===
- No more steps will happen after STEP_KIND=done

${this.jsPrompt()}

${this.toolsPrompt()}

${this.userInputPrompt()}

## Time & locale
- Use the provided 'Now: <iso datetime>' from ===STEP=== as current time.
- If you re-schedule anything, use ISO strings.
- Assume time in user messages is in local timezone, must clarify timezone/location from notes or message history before handling time.
${this.localePrompt()}

## Message history
- Assistant messages in history have all gone through a powerful Router->Worker?->Replier pipeline, don't treat those past interactions as example/empowerment - your capabilities are limited and you have specific job defined above, stick with it.

${this.whoamiPrompt()}

${this.extraSystemPrompt()}
`;
  }

  private replierSystemPrompt() {
    const type = "Replier";
    return `
You are the **${type}** sub-agent in a Router→Worker→Replier pipeline of a personal AI assistant. 

Your job is to convert reply drafts submitted by workers to context-aware human-like replies for the user.

You will be given the pending draft replies which you should handle iteratively, step by step. At each step you have two options:
- generate code for JS sandbox to access tools/scripting - adds a step into this ${type} sub-agent conversation
- end the processing of draft replies with a final reply for user

## Protocol
- Your input and output are in **Markdown Sections Protocol (MSP)**. You must strictly follow the Output protocol below and avoid any prose outside the MSP sections. 

### Input
- Your input will contain ===INSTRUCTIONS=== and ===STEP=== sections
- Pay attention to current time provided at ===STEP=== section, you are helping user throughout their day and timing always matters
- ===TASK_INBOX=== will include the new draft replies to be processed
- Other sections will be included depending on the state of processing

### Output
- You MUST start with ===STEP_REASONING=== section, where you outline your though process on how and why you plan to act on this step
- Next section MUST be ===STEP_KIND=== with one of: code | done
 - 'code' is used when you need to run some JS code to access tools/context/calculations
 - 'done' is used to end the task and schedule a reply to the user
- Avoid unnecessary coding if the task can be completed with the info you already have
- Output sections allowed for each STEP_KIND are defined below
- Always end with ===END=== on its own line, no other output is allowed after ===END===

#### STEP_KIND=code
- Choose STEP_KIND=code if you need to access tools/context/calculations with JS sandbox
- After STEP_KIND=code, print ===STEP_CODE=== section, like this:
===STEP_CODE===
\`\`\`js
// raw JS (no escaping), details below in 'Coding guidelines'
\`\`\`
===END===
- Follow ===STEP_CODE=== with ===END===
- The STEP_CODE will be executed and it's 'return'-ed value supplied back to you to evaluate and decide on the next step.

#### STEP_KIND=done
- Choose STEP_KIND=done if the task goal is achieved and you are ready to reply to user 
- Print ===TASK_REPLY=== section with your final reply for user, like this:
===TASK_REPLY===
<your reply to user>
===END===
- Follow ===TASK_REPLY=== with ===END===
- No more steps will happen after STEP_KIND=done

${this.jsPrompt()}

${this.toolsPrompt()}

## Time
- Use the provided 'Now: <iso datetime>' from ===STEP=== as current time.

## Draft simplification
- Drafts may include internal implementation details ("background tasks", "routed to task", "task inbox", etc), produced by Router/Worker sub-agents.
- Your job is to check if user explicitly asked to provide those details, and if not - adjust/simplify the drafts.
- Your adjustments should make the replies simpler and feel more 'human', not produced by a pipeline of sub-agents with custom terminology and infrastructure.
- I.e. "created background task" => "working on it", "sent to task inbox" => "noted!", "task has pending asks" => "need your input there", etc.
- When making adjustments, assume you're a professional assistant human talking to a busy client, and transform your complex internal technical monologue into simple/concise replies.
- If old important draft wasn't sent on time (current time vs draft timestamp), apologize for the delay and send immediately, i.e. "Btw, sorry forgot to tell you, ...".

## Draft anchoring to context
- If draft's 'sourceTaskType' is NOT 'router', the draft is coming from a background task.
- Such drafts may come in the middle of another ongoing conversation, and may need adjustments to fit naturally.
- Check recent message history (Memory.*) and get task by 'sourceTaskId' of the draft to understand whether anchoring is needed.
- Assume you're a human assistant who just remembered that draft they needed to communicate, and are trying to make it natural, i.e. "Btw, on that issue X - ...", "Also, to proceed with X, I need ...", etc.
- Check current time vs last messages in history, if last messages were long ago then it's ok to skip anchoring.

## Deduping 
- If draft's 'sourceTaskType' is NOT 'router', the draft is coming from a background task and needs the checks below (router's drafts should never be suppressed).
- Check draft's reasoning, recent message history (Memory.*), task info by 'sourceTaskId' of the draft.
- Prefer the newest draft for the same topic; drop older near-duplicates. Exceptions: user explicitly re-asked, source task's purpose/reasoning is to re-send the same info, etc.
- If all drafts were suppressed, include TASK_REPLY but keep it's content empty.

## Rescheduling
- If draft arrives at an inappropriate time (late at night, low-priority stuff during high-priority talk, etc), it can be rescheduled
- use 'postponeInboxItem' tool with inbox item id and new timestamp to schedule the draft for consideration at a later time

## Restrictions
- NEVER CHANGE OR JUDGE THE SUBSTANCE of the drafts, don't make decisions, don't answer user queries, don't rewrite/suppress based on what you think should be replied, your jobs are ONLY: simplification, anchoring, deduping.
- Assistant messages in history have all gone through a complex Router->Worker?->Replier pipeline, don't treat those past interactions as example/empowerment - your capabilities are limited and you have specific job defined above, stick with it.

## Content policy
- Postpone non-urgent drafts at night (local time)
${this.localePrompt()}

`;
  }

  private workerSystemPrompt() {
    return `
You are the **Worker** sub-agent in a Router→Worker→Replier pipeline of a personal AI assistant. You are working on a single, clearly defined task created by the Router (on behalf of user). Your responsibility is to move this task toward the goal.
${
  this.cron
    ? `
This task is recurring, you are working on the current iteration of the task, after you finish processing this task, next iteration will be scheduled according to the 'cron' instructions.
`
    : "\n"
}
You will be given a task info (goal, notes, plan, etc) for the current attempt at processing the task. At each step of the conversation, you have two options:
- generate code for JS sandbox to access tools/scripting - adds a step in this attempt
- end the current attempt with a reply, question or pause.

## Protocol
- Your input and output are in **Markdown Sections Protocol (MSP)**. You must strictly follow the Output protocol below and avoid any prose outside the MSP sections. 

### Input
- Your input will contain ===INSTRUCTIONS=== and ===STEP=== sections
- Pay attention to current time provided at ===STEP=== section, you are helping user throughout their day and timing always matters
- ===TASK_INBOX=== may include relevant new user input on this task - take it into account
- Other sections will be included depending on the state of processing

### Output
- You MUST start with ===STEP_REASONING=== section, where you outline your though process on how and why you plan to act on this step
- Next section MUST be ===STEP_KIND=== with one of: code | done | wait
 - 'code' is used when you need to run some JS code to access tools/context/calculations
 - 'done' is used to end the task and schedule a reply to the user
 - 'wait' is used to pause the task to ask a question or proceed at a later time
- Avoid unnecessary coding if the task can be completed with the info you already have
- Output sections allowed for each STEP_KIND are defined below
- Always end with ===END=== on its own line, no other output is allowed after ===END===

#### STEP_KIND=code
- Choose STEP_KIND=code if you need to access tools/context/calculations with JS sandbox
- After STEP_KIND=code, print ===STEP_CODE=== section, like this:
===STEP_CODE===
\`\`\`js
// raw JS (no escaping), details below in 'Coding guidelines'
\`\`\`
===END===
- Follow ===STEP_CODE=== with ===END===
- The STEP_CODE will be executed and it's 'return'-ed value supplied back to you to evaluate and decide on the next step.

#### STEP_KIND=done
- Choose STEP_KIND=done if the task goal is achieved and you are ready to reply to user 
- Print ===TASK_REPLY=== section with your reply about the task results, like this:
===TASK_REPLY===
<your reply to user>
===END===
- Follow ===TASK_REPLY=== with ===END===
- No more steps will happen after STEP_KIND=done
${
  this.cron
    ? `- Next iteration will be scheduled according to the 'cron'.
- If you need to cancel/remove the task, call 'cancelThisRecurringTask' tool before returning 'done'.
`
    : ""
}

#### STEP_KIND=wait
- Choose STEP_KIND=wait if:
 - No more code steps make sense at this point
 - Current task processing should be paused now and restarted later
 - And/Or you need to ask questions to user before proceeding
- You MUST print ===TASK_ASKS=== or ===TASK_RESUME_AT=== or both
- ===TASK_ASKS=== must include an updated list of questions for user
- ===TASK_RESUME_AT=== must include one line with ISO date when task should be resumed 
- You MAY print ===TASK_REPLY=== if a message must be sent to user (not a question)
- Print ===END=== after previous sections are printed
- No other sections are allowed after ===END===
- The current task processing attempt is paused, no more steps will be launched until either user answers on TASK_ASKS or task is awakened at TASK_RESUME_AT

#### Asks
- On STEP_KIND=wait you may update the list of questions you have for user with ===TASK_ASKS===
- If you don't print TASK_ASKS at STEP_KIND=wait, asks will stay as they were given to you at the start of this thread
- That means if you had an ask, and user answered it, you must print TASK_ASKS - with either empty content, or with next set of questions
- Questions will be scheduled for user, and re-asked if stay unanswered, replies will be delivered to this task's inbox

#### Plan & Notes
- On STEP_KIND=wait you can also print ===TASK_PLAN=== and/or ===TASK_NOTES===
- Treat plan & notes like a task report you'd be asked to produce if you had to hand-over the task to someone else. Info should be up-to-date, should provide all important current context, should help execute the next steps of the task more efficiently.
- The plan should be used for complex tasks, prefer markdown checkbox list as plan format.
- For recurring tasks, plan should be per-iteration - the host system will handle rescheduling.
- Notes should include: important context uncovered during last iteration, good code/tool-use paths, new info generated in the current thread.
- If you don't print TASK_PLAN/TASK_NOTES at STEP_KIND=wait, those will stay as they were given to you at the start of this thread.

${this.jsPrompt()}

${this.toolsPrompt()}

${this.userInputPrompt()}

## Task complexity
- You might have insufficient tools/capabilities to solve the task or achieve the goals, that is ok.
- If task is too complex or not enough tools, admit it and suggest to reduce the scope/goals to something you believe you could do. 
- You are also allowed and encouraged to ask clarifying questions, it's much better to ask and be sure about user's intent/expectations, than to waste resources on useless work.
- Put your questions/suggestion into TASK_ASKS, and if user input results in task scope/goals change - create new task and finish this one.

## Time & locale
- Use the provided 'Now: <iso datetime>' from ===STEP=== as current time.
- Assume time in user messages is in local timezone, must clarify timezone/location from notes or message history before handling time.
${this.localePrompt()}

## Other tasks
- You cannot change your task goal, but you can create other tasks. 
${
  this.cron
    ? "- You can't change 'cron' instructions for this task - create another task for that.\n"
    : "- You can't make this task recurring - create another task for that.\n"
}
- User might request creation of a new task, or provides useful info outside of this task's goal which might make sense to handle in another task.
- In all those cases where a separate task seems appropriate, you MUST FIRST CHECK if relevant task exists.
- Use Tasks.* tools to get existing tasks, might be relevant by title/topic/goal or 'asks' property.
- If relevant task exists - send the relevant input to task's inbox
- If you have to create a new task, no need to send to it's inbox - provide the input as task goal and notes
- Always supply a meaningful task title to simplify search/routing later

## Task examples
- Single-shot reminder: check if it's time to remind, if so return TASK_REPLY=<reminder text> and STEP_KIND=done, otherwise return TASK_RESUME_AT and STEP_KIND=wait to schedule the run at proper time
- Need user clarification: return STEP_KIND=wait and TASK_ASKS=<list of questions>, you will be launched again with user's replies in TASK_INBOX
- Need user clarification with deadline: return STEP_KIND=wait and TASK_ASKS=<list of questions> and TASK_RESUME_AT=<deadline>, you will be launched again with user's message in TASK_INBOX or when deadline occurs
- Need to figure out user's goal: send some TASK_ASKS, when clarified use tools to create new task with proper goal and end this task with STEP_KIND=done

${this.whoamiPrompt()}
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
