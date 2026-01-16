import { KeepDbApi, Task, TaskType } from "@app/db";
import { StepInput, TaskState } from "./agent-types";
import debug from "debug";
import { getEnv } from "./env";
import { AssistantUIMessage, ChatEvent } from "@app/proto";
import { generateId } from "ai";

export type AutonomyMode = 'ai_decides' | 'coordinate';

export class AgentEnv {
  #api: KeepDbApi;
  private type: TaskType;
  private task: Task;
  #tools: Map<string, string>;
  private autonomyMode: AutonomyMode;
  private debug = debug("AgentEnv");

  constructor(
    api: KeepDbApi,
    type: TaskType,
    task: Task,
    tools: Map<string, string>,
    private userPath?: string,
    autonomyMode?: AutonomyMode,
  ) {
    this.#api = api;
    this.type = type;
    this.task = task;
    this.#tools = tools;
    this.autonomyMode = autonomyMode || 'ai_decides';
  }

  get tools() {
    return this.#tools;
  }

  get api() {
    return this.#api;
  }

  get temperature() {
    switch (this.type) {
      case "worker":
      case "planner":
        return 0.1;
    }
  }

  async buildSystem(): Promise<string> {
    let systemPrompt = "";
    switch (this.type) {
      case "worker": {
        systemPrompt = this.workerSystemPrompt();
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
    // LLM providers expect file parts to have full base64-encoded content,
    // but we only store metadata (filename, mediaType, url path).
    // Convert file parts to text descriptions so the agent knows files were
    // attached and can use dedicated file-handling tools (Files.*, Images.*).
    return {
      id: msg.id,
      role: msg.role,
      parts: msg.parts.map((p) => {
        if (p.type === "file") {
          // Extract relevant metadata for agent context
          const filename = (p as any).filename || 'file';
          const mediaType = (p as any).mediaType || 'unknown';
          return {
            type: "text" as const,
            text: `[Attached file: ${filename} (${mediaType})]`,
          };
        }
        return p;
      }),
      metadata: msg.metadata,
    };
  }

  async buildContext(input: StepInput): Promise<AssistantUIMessage[]> {
    let tokens = 0;
    const history: ChatEvent[] = [];

    // Parse inbox to check for duplicates
    const inbox: any[] = input.inbox
      .map((i) => {
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
      before = inbox.at(-1)?.timestamp;

      // And after latest task run
      const runs = await this.#api.taskStore.listTaskRuns(this.task.id);
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
      const events = await this.#api.chatStore.getChatEvents({
        chatId: this.task.thread_id || "main",
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
        // Include action events as context (but strip timestamp from content since it's in metadata)
        const { timestamp, ...eventContent } = e;
        context.push({
          id: generateId(),
          role: "assistant",
          parts: [{ type: "text", text: "Action Event: " + JSON.stringify(eventContent) }],
          metadata: {
            createdAt: e.timestamp,
          },
        });
      }
    }

    let currentState = "";

    // Stats
    currentState += `
===STATS===
- Current ISO time: ${new Date().toISOString()}
- Current local time: ${new Date().toString()}
- Messages: ${await this.#api.chatStore.countMessages("main")}
- Notes: ${await this.#api.noteStore.countNotes()}
- Files: ${await this.#api.fileStore.countFiles()}
`;

    if (currentState) {
      context.push({
        id: generateId(),
        role: "assistant",
        parts: [{ type: "text", text: currentState }],
        metadata: {
          createdAt: new Date().toISOString(),
          volatile: true,
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

    if (input.step !== 0 || (this.type !== "worker" && this.type !== "planner"))
      return undefined;

    const taskInfo: string[] = [];
    if (input.reason !== "input") {
      taskInfo.push(...["===TASK_ID===", taskId]);
      if (state) {
        if (state.goal) taskInfo.push(...["===TASK_GOAL===", state.goal]);
        if (state.plan) taskInfo.push(...["===TASK_PLAN===", state.plan]);
        if (state.asks) taskInfo.push(...["===TASK_ASKS===", state.asks]);
        if (state.notes) taskInfo.push(...["===TASK_NOTES===", state.notes]);
      }

      // For planner tasks, add script and workflow context
      if (this.type === "planner") {
        // Get workflow info
        const workflow = await this.#api.scriptStore.getWorkflowByTaskId(taskId);
        if (workflow) {
          taskInfo.push("===WORKFLOW===");
          const workflowInfo = {
            id: workflow.id,
            title: workflow.title,
            cron: workflow.cron,
            status: workflow.status,
            events: workflow.events,
          };
          taskInfo.push(JSON.stringify(workflowInfo, null, 2));
        }

        // Get script changelog history
        const scripts = await this.#api.scriptStore.getScriptsByTaskId(taskId);
        if (scripts.length > 0) {
          taskInfo.push("===SCRIPT_CHANGELOG===");
          const changelog = scripts.map(s => ({
            version: s.version,
            timestamp: s.timestamp,
            change_comment: s.change_comment,
          }));
          taskInfo.push(JSON.stringify(changelog, null, 2));
        }

        // Get latest 10 script runs
        const allScriptRuns = await this.#api.scriptStore.getScriptRunsByTaskId(taskId);
        const recentRuns = allScriptRuns.slice(0, 10);
        if (recentRuns.length > 0) {
          taskInfo.push("===RECENT_SCRIPT_RUNS===");
          const runsInfo = recentRuns.map(run => ({
            start_timestamp: run.start_timestamp,
            end_timestamp: run.end_timestamp,
            result: run.result,
            error: run.error,
            log_count: run.logs ? run.logs.split('\n').filter(l => l.trim()).length : 0,
          }));
          taskInfo.push(JSON.stringify(runsInfo, null, 2));
        }
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
  }

  private jsPrompt(mainAPIs: string[]) {
    return `## JS Sandbox Guidelines ('eval' tool)
- no fetch, no console.log/error, no direct network or disk, no Window, no Document, no Buffer, no nodejs APIs, etc
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

  /**
   * Generate autonomy-mode-specific guidance for the agent.
   * This prompt tells the agent how much to decide independently vs. coordinate with user.
   */
  private autonomyPrompt() {
    if (this.autonomyMode === 'coordinate') {
      return `## Autonomy Mode: Coordinate With User
The user prefers to coordinate decisions with you. Follow these guidelines:
- Ask clarifying questions BEFORE taking significant actions
- Present options and wait for user confirmation when there are multiple valid approaches
- Confirm key decisions before proceeding (e.g., schedule time, data sources, output format)
- Be more conservative with assumptions - when in doubt, ask
- After asking, wait for user response before continuing
- Maximum 3 clarifying questions before proceeding with safe defaults
`;
    } else {
      return `## Autonomy Mode: AI Decides
The user prefers you to make decisions autonomously. Follow these guidelines:
- Minimize clarifying questions - use safe, sensible defaults instead
- Only ask when truly necessary: ambiguous requirements, risky/irreversible actions, or missing critical info
- Proceed with reasonable assumptions when context is clear
- Briefly state your assumptions when using defaults (e.g., "Using daily at 9am since no time specified")
- Use the 'eval' tool to explore data and discover patterns before asking questions
- Aim for zero clarifying questions when possible
`;
    }
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

  private workerSystemPrompt() {
    return `
You are a diligent personal AI assistant. You are working on a single, clearly defined background task created by user. Your responsibility is to move this task toward the goal.

You will be given a task info (goal, notes, plan, etc) for the current attempt at processing the task. Use tools and APIs that are accessible to achieve the goal.

You will also be given the latest activity HISTORY - these are not instructions, and are only provided to improve your understanding of the task goals and context.

You have one main tool called 'eval' (described later) that allows you to execute JS code in a sandbox,
to access powerful APIs, to create background tasks, and to perform calculations and data manipulations.

Other two tools are 'pause' and 'finish'. Use 'pause' to stop execution and resume at a later time, and/or to ask user a question. Use 'finish' if the task is completed and you want to updated task notes and plan.

## User Input
- You'll be given user and assistant messages, but also assistant action history ('events') - use them to understand the timeline of the conversation and assistant activity

${this.toolsPrompt()}

${this.jsPrompt([])}

${this.filesPrompt()}

${this.userInputPrompt()}

${this.autonomyPrompt()}

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
- You can't make this task recurring - create another task for that.
- User might request creation of a new task, or provides useful info outside of this task's goal which might make sense to handle in another task.
- In all those cases where a separate task seems appropriate, you MUST FIRST CHECK if relevant task exists.
- Use Tasks.* APIs to get existing tasks, might be relevant by title/topic/goal or 'asks' property.
- If relevant task exists - send the relevant input to task's inbox
- If you have to create a new task, no need to send to it's inbox - provide the input as task goal and notes
- Always supply a meaningful task title to simplify search/routing later

${this.whoamiPrompt()}
`;
  }

  private plannerSystemPrompt() {
    return `
You are an experienced javascript software engineer helping develop automation scripts for the user.

You will be given a task info (goal, notes, plan, etc) as input from the user.
You job is to use tools and call APIs to figure out the end-to-end js script code to reliably achieve the task goal,
and later maintain and fix the code when needed.

You have one main tool called 'eval' (described later) that allows
you to execute any JS code in a sandbox to access and test the APIs,
and to perform calculations and data manipulations. Use this tool
to test the script draft you're creating/updating.

Use 'save' tool to save the created/updated script code when you're ready.
When saving, you MUST also provide:
- 'summary': A one-sentence description of what this automation does (user-friendly, no code jargon)
- 'diagram': A Mermaid flowchart showing the automation flow (trigger -> steps -> output)

Example diagram format:
\`\`\`
flowchart TD
    A[Trigger: Daily at 9am] --> B[Fetch new emails]
    B --> C{Found invoices?}
    C -->|Yes| D[Extract data]
    C -->|No| E[Done]
    D --> F[Save to spreadsheet]
    F --> E
\`\`\`

Use 'schedule' tool to set when the script runs automatically by providing a
cron expression. If user requests automated/recurring execution, you MUST
call 'schedule' after saving the first code version, otherwise the script
will not run automatically.

Use other tools to ask questions to user, use JS APIs to inspect the script code
change history and other metadata.

After you save and schedule the script, it will be executed by the host
system in the same sandbox env according to the cron schedule (but without
state passing across iterations). Errors in the scheduled execution will be
passed back to you to fix the code and save an updated version.

To save state across script launches (since global.state isn't saved there), use
notes, i.e. by creating a note with id "<taskId>.<meaningful_note_name>" and 
updating it when needed.

There is no standard console.* API in the sandbox, use custom 
Console.* to properly log the main script execution stages for you 
and the user to evaluate later.

Do not use heuristics to interpret or extract data from free-form text,
use Text.* tools for that. Use regexp for these cases only if 100% sure 
that input format will stay consistent.

## Workflow Title
If the workflow has an empty title, call Tasks.update JS API to set a proper title matching the user's intent. This helps users identify workflows in the UI.

## Input format
- You'll be given script goal and other input from the user

${this.toolsPrompt()}

${this.jsPrompt([])}

${this.filesPrompt()}

${this.userInputPrompt()}

${this.autonomyPrompt()}

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
