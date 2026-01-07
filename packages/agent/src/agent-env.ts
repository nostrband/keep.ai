import { KeepDbApi, Task } from "@app/db";
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
  makeAddTaskTool,
  makeGetTaskTool,
  makeListTasksTool,
  makeSendToTaskInboxTool,
  makeAddTaskRecurringTool,
  makeCancelThisRecurringTaskTool,
  makePostponeInboxItemTool,
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
  makeTextRouteTool,
  makeTextSummarizeTool,
  makeTextGenerateTool,
} from "./tools";
import { z, ZodFirstPartyTypeKind as K } from "zod";
import { EvalContext, EvalGlobal } from "./sandbox/sandbox";
import { StepInput, TaskState, TaskType } from "./agent-types";
import debug from "debug";
import { getEnv } from "./env";
import { AssistantUIMessage, ChatEvent } from "packages/proto/dist";
import { generateId } from "ai";

export class AgentEnv {
  private api: KeepDbApi;
  private type: TaskType;
  private task: Task;
  private getContext: () => EvalContext;
  #tools = new Map<string, string>();
  private debug = debug("AgentEnv");

  constructor(
    api: KeepDbApi,
    type: TaskType,
    task: Task,
    getContext: () => EvalContext,
    private userPath?: string,
    private gmailOAuth2Client?: any
  ) {
    this.api = api;
    this.type = type;
    this.task = task;
    if (type !== "worker" && task.cron)
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
      case "planner":
        return 0.1;
      case "replier":
        return 0.2;
    }
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

    const isWorker = this.type === "worker" || this.type === "planner";

    // Tools
    if (this.type !== "replier") {
      addTool(global, "Utils", "weather", makeGetWeatherTool(this.getContext));
    }
    if (isWorker) {
      addTool(global, "Utils", "atob", makeAtobTool());
      addTool(global, "Web", "search", makeWebSearchTool(this.getContext));
      addTool(global, "Web", "fetchParse", makeWebFetchTool(this.getContext));
      addTool(
        global,
        "Web",
        "download",
        makeWebDownloadTool(this.api.fileStore, this.userPath, this.getContext)
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

    // Event history available for all agent types
    addTool(
      global,
      "Memory",
      "listEvents",
      makeListEventsTool(this.api.chatStore, this.api.taskStore)
    );

    // Tasks

    // Router or Worker
    if (this.type !== "replier" && this.type !== "planner") {
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
      if (this.task.cron) {
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
        "Inbox",
        "postponeInboxItem",
        makePostponeInboxItemTool(this.api.inboxStore, this.getContext)
      );
    }

    // File tools for router and worker
    if (this.type === "router" || isWorker) {
      if (isWorker) {
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
      }
      addTool(global, "Files", "list", makeListFilesTool(this.api.fileStore));
      addTool(
        global,
        "Files",
        "search",
        makeSearchFilesTool(this.api.fileStore)
      );
    }

    // Image tools for worker only
    if (isWorker) {
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
        makeImagesExplainTool(
          this.api.fileStore,
          this.userPath,
          this.getContext
        )
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
    }

    // PDF tools for worker only
    if (isWorker) {
      addTool(
        global,
        "PDF",
        "explain",
        makePdfExplainTool(this.api.fileStore, this.userPath, this.getContext)
      );
    }

    // Audio tools for worker only
    if (isWorker) {
      addTool(
        global,
        "Audio",
        "explain",
        makeAudioExplainTool(this.api.fileStore, this.userPath, this.getContext)
      );
    }

    // Text tools for worker only
    if (isWorker) {
      addTool(
        global,
        "Text",
        "extract",
        makeTextExtractTool(this.getContext)
      );
      addTool(
        global,
        "Text",
        "route",
        makeTextRouteTool(this.getContext)
      );
      addTool(
        global,
        "Text",
        "summarize",
        makeTextSummarizeTool(this.getContext)
      );
      addTool(
        global,
        "Text",
        "generate",
        makeTextGenerateTool(this.getContext)
      );
    }

    // Gmail tools for worker only
    if (this.type !== "replier" && this.gmailOAuth2Client) {
      addTool(
        global,
        "Gmail",
        "api",
        makeGmailTool(this.getContext, this.gmailOAuth2Client)
      );
    }

    // Store
    this.#tools = toolDocs;

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
      case "planner": {
        systemPrompt = this.plannerSystemPrompt();
        break;
      }
    }
    this.debug("system prompt: ", systemPrompt);

    return `
${systemPrompt}
`.trim();
  }

  prepareUserMessage(msg: AssistantUIMessage): AssistantUIMessage {
    // FIXME this is ugly hack, we don't want to send
    // file/image parts bcs provider expects base64 body,
    // but we only provide file metadata for agent to use
    // tools to handle them
    return {
      id: msg.id,
      role: msg.role,
      parts: msg.parts.map((p) => {
        if (p.type === "file") {
          p = {
            type: "text",
            text: "Attached file: " + JSON.stringify(p),
          };
        }
        return p;
      }),
      metadata: msg.metadata,
    };
  }

  async buildContext(input: StepInput): Promise<AssistantUIMessage[]> {
    if (
      ["worker"].includes(this.type)
      // &&
      // input.reason !== "input" &&
      // input.reason !== "timer"
    )
      return [];

    let tokens = 0;
    const history: ChatEvent[] = [];

    // Parse inbox
    const inbox: any[] = input.inbox
      .map((i) => {
        // FIXME this is really ugly!
        try {
          return JSON.parse(i);
        } catch {
          return undefined;
        }
      })
      .filter(Boolean);

    const MAX_TOKENS = this.type === "worker" ? 1000 : 5000;
    let before: string | undefined;
    let since: string | undefined;
    if (this.type === "worker" && inbox.length) {
      // Gap before last inbox item
      before = inbox.at(-1).timestamp;

      // And after latest task run
      const runs = await this.api.taskStore.listTaskRuns(this.task.id);
      // Ordered by timestamp desc
      since = runs.filter((r) => !!r.end_timestamp)[0]?.start_timestamp;
      this.debug(
        "Build context for worker",
        this.task.id,
        "from",
        since,
        "till",
        before
      );
    }

    while (tokens < MAX_TOKENS) {
      const events = await this.api.chatStore.getChatEvents({
        chatId: "main",
        limit: 100,
        before,
        since,
      });

      if (!events.length) break;

      before = events.at(-1)!.timestamp;

      for (const e of events) {
        // Skip messages that we're putting to inbox
        if (e.type === "message") {
          const isInInbox = inbox.find((i) => i.id === e.id);
          if (isInInbox) continue;
        }

        // rough token estimate
        tokens += Math.ceil(JSON.stringify(e).length / 2);
        history.push(e);

        if (tokens >= MAX_TOKENS) break;
      }

      if (tokens >= MAX_TOKENS) break;
    }

    // Re-sort in ASC order
    history.sort(
      (a, b) =>
        new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );

    const context: AssistantUIMessage[] = [];
    for (const e of history) {
      if (e.type === "message") {
        context.push(this.prepareUserMessage(e.content as AssistantUIMessage));
      } else {
        context.push({
          id: generateId(),
          role: "assistant",
          // FIXME cut timestamp from json, as we're writing it to metadata
          parts: [{ type: "text", text: "Action Event: " + JSON.stringify(e) }],
          metadata: {
            createdAt: e.timestamp,
          },
        });
      }
    }

    let currentState = "";

    if (this.type === "router") {
      const tasks = await this.api.taskStore.listTasks();
      const states = await this.api.taskStore.getStates(tasks.map((t) => t.id));

      const text = `
===TASKS===
Below are the active tasks, use Tasks.* API to get more info.
\`\`\`json
${tasks
  .map((task) =>
    JSON.stringify({
      id: task.id,
      title: task.title,
      type: task.type,
      state: task.state,
      cron: task.cron,
      // Active tasks don't have it, and we don't want task replies to leak to router
      // reply: task.reply,
      goal: states.find((s) => s.id === task.id)?.goal || "",
      asks: states.find((s) => s.id === task.id)?.asks || "",
    })
  )
  .join("\n")}
\`\`\``;

      // Append tasks
      if (tasks.length) currentState += text;

      // Stats
      currentState += `
===STATS===
- Current ISO time: ${new Date().toISOString()}
- Current local time: ${new Date().toString()}
- Messages: ${await this.api.chatStore.countMessages("main")}
- Notes: ${await this.api.noteStore.countNotes()}
- Files: ${await this.api.fileStore.countFiles()}
`;
    }

    if (currentState) {
      context.push({
        id: generateId(),
        role: "assistant",
        parts: [{ type: "text", text: currentState }],
        metadata: {
          createdAt: new Date().toISOString(),
          volatile: true
        },
      });
    }

    return context;
  }

  async buildUser(taskId: string, input: StepInput, state?: TaskState) {
    if (input.reason === "code" && !input.result)
      throw new Error("No step result");
    if (input.reason === "input" && !input.inbox.length)
      throw new Error("No inbox for reason='input'");

    if (input.step !== 0 || this.type !== "worker") return undefined;

    const taskInfo: string[] = [];
    if (input.reason !== "input") {
      taskInfo.push(...["===TASK_ID===", taskId]);
      if (this.task.cron) taskInfo.push(...["===TASK_CRON===", this.task.cron]);
      if (state) {
        if (state.goal) taskInfo.push(...["===TASK_GOAL===", state.goal]);
        if (state.plan) taskInfo.push(...["===TASK_PLAN===", state.plan]);
        if (state.asks) taskInfo.push(...["===TASK_ASKS===", state.asks]);
        if (state.notes) taskInfo.push(...["===TASK_NOTES===", state.notes]);
      }
    }

    return `
${taskInfo.join("\n")}
`.trim();
  }

  private localePrompt() {
    const locale = getEnv().LANG || "en-US";
    return `- User's locale/language is '${locale}' - always reply to user in this language.`;
  }

  private toolsPrompt() {
    return "";
//     return `## Tools
// Your only tool available is 'eval', which takes js-code as input, and returns result for your processing.
// Input: { jsCode: string } - an object with jsCode field, code will be executed in the sandbox
// Output: string - stringified JSON returned in 'result' field (details below).
// `;
  }

  private jsPrompt(mainAPIs: string[]) {
    return `## JS Sandbox Guidelines ('eval' tool)
- no fetch, no console.log/error, no direct network or disk, no Window, no Document, etc
- do not wrap your code in '(async () => {...})()' - that's already done for you
- all API endpoints are async and must be await-ed
- you MUST 'return' the value that you want to be returned from 'eval' tool
- you MAY set 'globalThis.state' to any value that you want to preserve and make available on the next code step
- all global variables are reset after code eval ends, use 'state' to keep data for next steps
- returned value and 'state' must be convertible to JSON
- don't 'return' big encrypted/encoded/intermediary data/fields - put them to 'state' to save tokens and process on next steps

### Coding example
Step 0, getting API docs:
\`\`\`js
return {
  firstMethod: getDocs("firstMethod"),
  secondMethod: getDocs("secondMethod"),
}
\`\`\`

Step 1, executing proper API methods, testing output and keeping results for next step:
\`\`\`js
const data = await firstMethod(properArgs); // all methods are async
const lines = data.split("\\n");
globalThis.state = lines;
return lines.filter(line => line.includes("test")).length
\`\`\`

Step 2, result was > 0, decided to read all lines with "test"
\`\`\`js
// 'state' is on globalThis after being set as 'state' on Step 1
const lines = state;
return {
  result: lines.filter(line => line.includes("test"))
}
\`\`\`

Step 3: reply to user with some info from returned 'lines'.
...

### JS APIs

JS API endpoints are functions that are accessible in JS sandbox through \`globalThis\`:
- if you plan to use JS APIs, first coding step SHOULD be getting the API endpoint docs
 - call \`getDocs("<MethodName>")\` for each js endpoint you plan to use
 - return all docs on this step, to read them on next step and generate proper js API calling code
- all JS APIs are async and must be await-ed
- if you are calling a sequence of API methods, CHECK THE DOCS FIRST to make sure you are calling them right, otherwise first call might succeed but next one fails and you'll retry and will cause duplicate side-effects
- you only have JS API methods listed below, no other methods are available to you right now

${
  mainAPIs.length
    ? `
#### Main API methods
${mainAPIs.map((t) => `#### ${t}\n${this.tools.get(t)}\n`).join("\n")}
`
    : ""
}
#### All API methods
${[...this.tools.keys()].map((t) => `- ${t}`).join("\n")}
`;
  }

  private filesPrompt() {
    return `## Files & Images
You have access to files on user's device:
- use Files.* tools to access files, Images.* tools to work with images
- if you need to mention a file when replying to user, use markdown links with '/files/get/' path prefix, i.e. [<file.name>](/files/get/<file.path>)
- if you need to show an image when replying to user, use markdown images with '/files/get/' path prefix, i.e. ![<file.name>](/files/get/<file.path>)
${
  this.type !== "worker"
    ? `- create background task to read/process full file content, to generate images, etc`
    : ""
}
`;
  }

  private whoamiPrompt() {
    return `## What are you?
If user asks what/who you are, or what you're capable of, here is what you should reply:
- your name is 'Keep', you are a personal AI assistant
- you are privacy-focused (user's data stays on their devices) and proactive (can reach-out to user, not just reply to queries)
- you can search and browse the web, run calculations, answer questions, take notes, access files and work on tasks in the background
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
      .replace(/\\n/g, "\n") // Unescape newlines
      .replace(/\\"/g, '"') // Unescape double quotes
      .replace(/\\\\/g, "\\"); // Unescape backslashes (must be last)
  }

  private routerSystemPrompt() {
    return `
You are a diligent personal AI assistant. 

Your job is to process user query using tools that are accessible to you.

You have one main tool called 'eval' (described later) that allows you to execute JS code in a sandbox,
to access powerful APIs, to create background tasks, and to perform calculations and data manipulations.

You are processing the user query in real-time and fast response is expected, which means that most of 
processing should be delegated to background tasks using JS APIs.

To understand the user intent better, you can read through the message HISTORY and active TASKS,
and can use JS APIs to access older memories if needed.

## Decision rubric
Your main job is to understand user messages within context and route (parts of) user messages to background tasks: 
- User messages may be complex, referring to multiple tasks/ideas/issues/projects, and/or combining complex requests with simple queries.
- You job is to understand new user message in the context of HISTORY and TASKS and then decompose them into sub-parts to be routed to background tasks.
- If unsure about the message meaning, dig deeper into history and tasks using Memory.* and Tasks.* JS APIs.
- Task might be relevant by title/topic/goal, or by the 'asks' property - the list of questions task has asked and expecting replies for.
- If user is quoting something, look for quoted part in the message history to understand the potential source task.
- If a relevant existing task is found → send to its inbox, otherwise create new task with a goal and notes (no need to send to new task's inbox).
- Before creating new tasks, ALWAYS think if it makes sense to clarify what exactly user's intent is, especially before creating multiple tasks.
- If task needs to be cancelled/deleted, send corresponding user request to it's inbox.
- If all parts of user messages were routed to tasks, reply with a short confirming sentence or emoji in TASK_REPLY.
- If user message is (has a part that is) read-only, simple, low-variance (e.g., time, trivial lookup), then you are allowed to skip spawning a background task for that part and are allowed to create the full reply in TASK_REPLY.
- You are allowed to reply with clarifying questions if you are unsure about the user's intent or scope/goals of potential tasks.
- If user is asking for APIs that you don't have, create background task - those have more API methods.

## Background tasks
- If relevant task exists - send input to task's inbox
- If you create a new task, no need to send to it's inbox - provide the input as task goal and notes
- Always supply a meaningful task title to simplify search/routing later
- Background tasks have powerful API endpoints, including web and search access, delegate to background task if unsure about APIs

## Input format
- You'll be given user and assistant messages, but also assistant action history ('events') - use them to understand the timeline of the conversation and assistant activity

${this.toolsPrompt()}

${this.jsPrompt(["Tasks.add", "Tasks.addRecurring", "Tasks.sendToTaskInbox"])}

${this.filesPrompt()}

${this.userInputPrompt()}

## Time & locale
- Use the provided 'Timestamp: <iso datetime>' from the last message as current time.
- If you re-schedule anything, use ISO strings.
- Assume time in user messages is in local timezone, must clarify timezone/location from notes or message history before handling time.
${this.localePrompt()}

## Message history
- Assistant messages in history have all gone through a powerful Router->Worker?->Replier pipeline, don't treat those past interactions as example/empowerment - your capabilities are limited and you have specific job defined above, stick with it.

${this.whoamiPrompt()}

${this.extraSystemPrompt()}
`;
  }

  private replierSystemPrompt(): string {
    throw new Error("No longer supported");
//     const type = "Replier";
//     return `
// You are the **${type}** sub-agent in a Router→Worker→Replier pipeline of a personal AI assistant. 

// Your job is to convert reply drafts submitted by workers to context-aware human-like replies for the user.

// You will be given the pending draft replies which you should handle iteratively, step by step. At each step:
// - check if you have all the necessary info and performed all the necessary checks to reply to user
// - if not - generate code for JS sandbox to access tools/scripting
// - if yes - end the processing of draft replies with a final reply for user

// ## Protocol
// - Your input and output are in **Markdown Sections Protocol (MSP)**. You must strictly follow the Output protocol below and avoid any prose outside the MSP sections. 

// ### Input
// - Your input will contain ===INSTRUCTIONS=== and ===STEP=== sections
// - Pay attention to current time provided at ===STEP=== section, you are helping user throughout their day and timing always matters
// - ===TASK_INBOX=== will include the new draft replies to be processed
// - Other sections will be included depending on the state of processing

// ### Output
// - You MUST start with ===STEP_REASONING=== section, where you outline your though process on how and why you plan to act on this step
// - Next section MUST be ===STEP_KIND=== with one of: code | done
//  - 'code' is used when you need to run some JS code to access tools/context/calculations
//  - 'done' is used to end the task and schedule a reply to the user
// - Avoid unnecessary coding if the task can be completed with the info you already have
// - Output sections allowed for each STEP_KIND are defined below
// - Always end with ===END=== on its own line, no other output is allowed after ===END===

// #### STEP_KIND=code
// - Choose STEP_KIND=code if you need to access tools/context/calculations with JS sandbox
// - After STEP_KIND=code, print ===STEP_CODE=== section, like this:
// ===STEP_CODE===
// \`\`\`js
// // raw JS (no escaping), details below in 'Coding guidelines'
// \`\`\`
// ===END===
// - Follow ===STEP_CODE=== with ===END===
// - The STEP_CODE will be executed and it's 'return'-ed value supplied back to you to evaluate and decide on the next step.

// #### STEP_KIND=done
// - Choose STEP_KIND=done if the task goal is achieved and you are ready to reply to user 
// - Print ===TASK_REPLY=== section with your final reply for user, like this:
// ===TASK_REPLY===
// <your reply to user>
// ===END===
// - Follow ===TASK_REPLY=== with ===END===
// - No more steps will happen after STEP_KIND=done

// ${this.toolsPrompt()}

// ${this.jsPrompt([])}

// ## Time
// - Use the provided 'Now: <iso datetime>' from ===STEP=== as current time.

// ## Draft simplification
// - Drafts may include internal implementation details ("background tasks", "routed to task", "task inbox", etc), produced by Router/Worker sub-agents.
// - Your job is to check if user explicitly asked to provide those details, and if not - adjust/simplify the drafts.
// - Your adjustments should make the replies simpler and feel more 'human', not produced by a pipeline of sub-agents with custom terminology and infrastructure.
// - I.e. "created background task" => "working on it", "sent to task inbox" => "noted!", "task has pending asks" => "need your input there", etc.
// - When making adjustments, assume you're a professional assistant human talking to a busy client, and transform your complex internal technical monologue into simple/concise replies.
// - If old important draft wasn't sent on time (current time vs draft timestamp), apologize for the delay and send immediately, i.e. "Btw, sorry forgot to tell you, ...".

// ## Draft anchoring to context
// ${
//   "" /*- If draft's 'sourceTaskType' is NOT 'router', the draft is coming from a background task.*/
// }
// - Drafts may come in the middle of another ongoing conversation, and may need adjustments to fit naturally.
// - Check recent message HISTORY (and/or Memory.* tools) and get task by 'sourceTaskId' of the draft to understand whether anchoring is needed.
// - Assume you're a human assistant who just remembered that draft they needed to communicate, and are trying to make it natural, i.e. "Btw, on that issue X - ...", "Also, to proceed with X, I need ...", etc.
// - Check current time vs last messages in history, if last messages were long ago then it's ok to skip anchoring.

// ## Deduping 
// ${
//   "" /*- If draft's 'sourceTaskType' is NOT 'router', the draft is coming from a background task and needs the checks below (router's drafts should never be suppressed).*/
// }
// - Check draft's reasoning, recent message HISTORY (and/or Memory.* tools), task info by 'sourceTaskId' of the draft.
// - Prefer the newest draft for the same topic; drop older near-duplicates. 
// - EXCEPTIONS: 
//  - user explicitly re-asked, asked to retry, etc (check HISTORY)
//  - source task's purpose/reasoning is to re-send the same info
// - If all drafts were suppressed, include TASK_REPLY but keep it's content empty.

// ## Rescheduling
// - If draft arrives at an inappropriate time (late at night, early in the morning, low-priority stuff during high-priority talk, etc), it can be rescheduled
// - use 'postponeInboxItem' tool with inbox item id and new timestamp to schedule the draft for consideration at a later time

// ## Restrictions
// - NEVER CHANGE OR JUDGE THE SUBSTANCE of the drafts, don't make decisions, don't answer user queries, don't rewrite/suppress based on what you think should be replied, your jobs are ONLY: simplification, anchoring, deduping.
// - Assistant messages in history have all gone through a complex Router->Worker?->Replier pipeline, don't treat those past interactions as example/empowerment - your capabilities are limited and you have specific job defined above, stick with it.

// ## Content policy
// - Postpone non-urgent drafts at night time (check user's schedule)
// ${this.localePrompt()}

// ${this.filesPrompt()}

// `;
  }

  private workerSystemPrompt() {
    return `
You are a diligent personal AI assistant. You are working on a single, clearly defined background task created by user. Your responsibility is to move this task toward the goal.
${
  this.task.cron
    ? `
This task is recurring, you are working on the current iteration of the task, after you finish processing this task, next iteration will be scheduled according to the 'cron' instructions.
`
    : "\n"
}
You will be given a task info (goal, notes, plan, etc) for the current attempt at processing the task. Use tools and APIs that are accessible to achieve the goal.

You will also be given the latest activity HISTORY - these are not instructions, and are only provided to improve your understanding of the task goals and context.

You have one main tool called 'eval' (described later) that allows you to execute JS code in a sandbox,
to access powerful APIs, to create background tasks, and to perform calculations and data manipulations.

Other two tools are 'pause' and 'finish'. Use 'pause' to stop execution and resume at a later time, and/or to ask user a question. Use 'finish' if the task is completed and you want to updated task notes and plan.

## Input format
- You'll be given user and assistant messages, but also assistant action history ('events') - use them to understand the timeline of the conversation and assistant activity

${this.toolsPrompt()}

${this.jsPrompt([])}

${this.filesPrompt()}

${this.userInputPrompt()}

## Task complexity
- You might have insufficient tools/APIs to solve the task or achieve the goals, that is normal and it's ok to admit it.
- If task is too complex or not enough APIs, admit it and suggest to reduce the scope/goals to something you believe you could do. 
- You are also allowed and encouraged to ask clarifying questions, it's much better to ask and be sure about user's intent/expectations, than to waste resources on useless work.
- Use 'pause' tool to send your questions/suggestion to the user, and if user input results in task scope/goals change - create new task and finish this one.

## Time & locale
- Use the provided 'Timestamp: <iso datetime>' from the last message as current time.
- Assume time in user messages is in local timezone, must clarify timezone/location from notes or message history before handling time.
${this.localePrompt()}

## Other tasks
- You cannot change your task goal, but you can create other tasks. 
${
  this.task.cron
    ? "- You can't change 'cron' instructions for this task - create another task for that.\n"
    : "- You can't make this task recurring - create another task for that.\n"
}
- User might request creation of a new task, or provides useful info outside of this task's goal which might make sense to handle in another task.
- In all those cases where a separate task seems appropriate, you MUST FIRST CHECK if relevant task exists.
- Use Tasks.* APIs to get existing tasks, might be relevant by title/topic/goal or 'asks' property.
- If relevant task exists - send the relevant input to task's inbox
- If you have to create a new task, no need to send to it's inbox - provide the input as task goal and notes
- Always supply a meaningful task title to simplify search/routing later

## Task examples
- Single-shot reminder: check if it's time to remind, if so return <reminder text>, otherwise call 'pause' to schedule the run at proper time
- Need user clarification: call 'pause' with asks=<list of questions>, you will be launched again when user replies 
- Need user clarification with deadline: call 'pause' with asks=<list of questions> and resumeAt=<deadline>, you will be launched again with user's message or when deadline occurs
- Need to figure out user's goal: call 'pause' with 'asks', when clarified use APIs to create new task with proper goal and end this task

${this.whoamiPrompt()}
`;
  }

  private plannerSystemPrompt() {
    return `
You are an experienced javascript software engineer helping develop automation scripts for the user. 

You will be given a task info (goal, notes, plan, etc) as input from the user. You job is to use tools and call APIs to figure out the end-to-end js script code to reliably achieve the task goal, and later maintain and fix the code when needed. 

${
  this.task.cron
    ? `
The task is recurring, the script will be launched according to the 'cron' instructions.
`
    : "\n"
}


You have one main tool called 'eval' (described later) that allows you to execute any JS code in a sandbox to access and test the APIs, and to perform calculations and data manipulations. Use this tool to test the script draft you're creating/updating.

Use 'save' tool to save the created/updated script code when you're ready.

Use other tools to ask questions to user or inspect the script code change history.

## Input format
- You'll be given script goal and other input from the user

${this.toolsPrompt()}

${this.jsPrompt([])}

${this.filesPrompt()}

${this.userInputPrompt()}

## Task complexity
- You might have insufficient tools/APIs to solve the task or achieve the goals, that is normal and it's ok to admit it.
- If task is too complex or not enough APIs, admit it and suggest to reduce the scope/goals to something you believe you could do. 
- You are also allowed and encouraged to ask clarifying questions, it's much better to ask and be sure about user's intent/expectations, than to waste resources on useless work.
- Use 'ask' tool to send your questions/suggestion to the user.

## Time & locale
- Assume time in user messages is in local timezone, must clarify timezone/location from notes or message history before handling time.
${this.localePrompt()}

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
