# @app/agent

> Core AI agent functionality with tools, REPL environment, and task processing

The `@app/agent` package provides the core AI agent capabilities for Keep.AI, including tool execution, conversational AI flows, task management, and safe code execution in a sandboxed environment.

## 🚀 Features

- **AI Agent Tools**: Pre-built tools for notes, tasks, weather, web search, and more
- **REPL Agent**: Step-by-step conversational AI flow with reasoning capabilities
- **Task Worker**: Background task processing and scheduling system
- **Safe Sandbox**: QuickJS-based sandbox for secure code execution
- **Environment Management**: Configurable AI models and API keys
- **Multi-step Reasoning**: Iterative problem solving with state management

## 📦 Installation

```bash
npm install @app/agent
```

## 🛠️ Usage

### Basic Agent Setup

```typescript
import { 
  ReplAgent, 
  TaskWorker, 
  getOpenRouter, 
  getModelName,
  initSandbox,
  ReplEnv 
} from '@app/agent';

// Initialize model and environment
const model = getOpenRouter()(getModelName());
const sandbox = await initSandbox();
const env = new ReplEnv(api, 'worker', undefined, () => sandbox.context!);

// Create agent
const agent = new ReplAgent(model, env, sandbox, {
  id: 'task-123',
  type: 'worker',
  state: { goal: 'Complete the task' }
});

// Run agent loop
const result = await agent.loop('start', {
  inbox: ['user message'],
  onStep: async (step, input, output, result) => {
    console.log(`Step ${step}:`, output);
    return { proceed: true };
  }
});
```

### Task Worker

```typescript
import { TaskWorker } from '@app/agent';
import { KeepDbApi } from '@app/db';

// Initialize task worker
const worker = new TaskWorker({
  api: dbApi,
  stepLimit: 50
});

// Start background processing
worker.start();

// Process tasks manually
await worker.checkWork();

// Cleanup
await worker.close();
```

### Using Built-in Tools

```typescript
import {
  makeCreateNoteTool,
  makeWebSearchTool,
  makeGetWeatherTool,
  makeAddTaskTool
} from '@app/agent';

// Create tools with API access
const createNote = makeCreateNoteTool(dbApi);
const webSearch = makeWebSearchTool();
const getWeather = makeGetWeatherTool();
const addTask = makeAddTaskTool(dbApi);

// Tools are compatible with AI SDK
const tools = {
  createNote,
  webSearch,
  getWeather,
  addTask
};
```

## 🔧 Environment Configuration

Set up environment variables for AI functionality:

```typescript
import { setEnv, type Env } from '@app/agent';

const env: Env = {
  OPENROUTER_API_KEY: 'your_openrouter_key',
  OPENROUTER_BASE_URL: 'https://openrouter.ai/api/v1',
  AGENT_MODEL: 'anthropic/claude-3-sonnet',
  EXA_API_KEY: 'your_exa_key' // Optional, for web search
};

setEnv(env);
```

Or set environment variables in `~/.keep.ai/.env`:

```bash
OPENROUTER_API_KEY=your_openrouter_key
OPENROUTER_BASE_URL=https://openrouter.ai/api/v1
AGENT_MODEL=anthropic/claude-3-sonnet
EXA_API_KEY=your_exa_key
```

## 🛠️ Available Tools

### Notes Management
- [`makeCreateNoteTool`](src/tools/create-note.ts) - Create new notes
- [`makeUpdateNoteTool`](src/tools/update-note.ts) - Update existing notes
- [`makeDeleteNoteTool`](src/tools/delete-note.ts) - Delete notes
- [`makeGetNoteTool`](src/tools/get-note.ts) - Retrieve specific notes
- [`makeSearchNotesTool`](src/tools/search-notes.ts) - Search through notes
- [`makeListNotesTool`](src/tools/list-notes.ts) - List all notes

### Task Management
- [`makeAddTaskTool`](src/tools/add-task.ts) - Create new tasks
- [`makeAddTaskRecurringTool`](src/tools/add-task-recurring.ts) - Create recurring tasks
- [`makeGetTaskTool`](src/tools/get-task.ts) - Retrieve task information
- [`makeListTasksTool`](src/tools/list-tasks.ts) - List all tasks
- [`makeCancelThisRecurringTaskTool`](src/tools/cancel-this-recurring-task.ts) - Cancel recurring tasks

### Communication & Inbox
- [`makeListMessagesTool`](src/tools/list-messages.ts) - List message history
- [`makeSendToTaskInboxTool`](src/tools/send-to-task-inbox.ts) - Send messages to task inbox
- [`makePostponeInboxItemTool`](src/tools/postpone-inbox-item.ts) - Postpone inbox items

### External Services
- [`makeGetWeatherTool`](src/tools/get-weather.ts) - Get weather information
- [`makeWebSearchTool`](src/tools/web-search.ts) - Search the web using Exa API
- [`makeWebFetchTool`](src/tools/web-fetch.ts) - Fetch web page contents

## 🔄 Task Types

The agent supports three main task types:

### Worker Tasks
- Execute user-requested operations
- Can run for extended periods with state persistence
- Support for waiting and resuming based on conditions
- Return structured results with reasoning

### Router Tasks
- Route incoming messages to appropriate handlers
- Persistent tasks that process incoming requests
- Always in "asks" state for continuous processing

### Replier Tasks
- Generate responses to user messages
- Handle conversational flows
- Format and deliver replies to users

## 🏗️ Architecture

### ReplAgent
The [`ReplAgent`](src/repl-agent.ts) class provides:
- **Step-by-step execution**: Iterative problem solving
- **State management**: Persistent state across steps
- **History tracking**: Conversation history management
- **Usage tracking**: Token and cost monitoring

### TaskWorker
The [`TaskWorker`](src/task-worker.ts) class handles:
- **Task scheduling**: Automatic task execution based on timestamps
- **Inbox processing**: Handle incoming messages and notifications
- **Error handling**: Retry logic with exponential backoff
- **Status updates**: Real-time agent status reporting

### Sandbox Environment
The sandbox system provides:
- **Safe execution**: QuickJS-based isolated environment
- **Tool integration**: Access to agent tools within sandbox
- **State persistence**: Maintain execution state between steps
- **Context management**: Task and thread context tracking

## ⚙️ Configuration Options

### ReplEnv Options
```typescript
const env = new ReplEnv(
  api,           // Database API instance
  type,          // Task type: 'worker' | 'router' | 'replier'
  cron,          // Optional cron schedule
  getContext     // Function to get sandbox context
);

// Configure temperature (default: varies by task type)
env.temperature = 0.7;
```

### Sandbox Options
```typescript
const sandbox = await initSandbox({
  timeoutMs: 10000,  // Execution timeout
  memoryLimit: 100,  // Memory limit in MB
  cpuQuota: 1.0     // CPU quota (0.0-1.0)
});
```

### TaskWorker Options
```typescript
const worker = new TaskWorker({
  api: dbApi,
  stepLimit: 50     // Maximum steps per task run
});
```

## 🧪 Development

Build the package:
```bash
npm run build
```

Development mode with watch:
```bash
npm run dev
```

Type checking:
```bash
npm run type-check
```

## 📝 API Reference

### Core Classes

#### `ReplAgent`
Main agent class for conversational AI flows.

```typescript
constructor(model: LanguageModel, env: ReplEnv, sandbox: Sandbox, task: AgentTask)
async loop(reason?: StepReason, options?: LoopOptions): Promise<StepOutput>
```

#### `TaskWorker`
Background task processor and scheduler.

```typescript
constructor(config: TaskWorkerConfig)
start(): void
async checkWork(): Promise<void>
async close(): Promise<void>
```

#### `ReplEnv`
Environment configuration for agent execution.

```typescript
constructor(api: KeepDbApi, type: TaskType, cron?: string, getContext: () => SandboxContext)
async buildSystem(): Promise<string>
async buildUser(taskId: string, input: StepInput, state?: TaskState): Promise<string>
```

### Types

```typescript
interface AgentTask {
  id: string;
  type: TaskType;
  state?: TaskState;
}

interface StepInput {
  step: number;
  reason: StepReason;
  now: string;
  inbox: string[];
  result?: EvalResult;
}

interface StepOutput {
  kind: 'code' | 'wait' | 'done';
  steps: number;
  code?: string;
  reply?: string;
  reasoning?: string;
  resumeAt?: string;
  patch?: Partial<TaskState>;
}
```

## 🔗 Dependencies

- **[@app/db](../db/)** - Database layer and API
- **[@app/proto](../proto/)** - Shared protocol definitions
- **[ai](https://www.npmjs.com/package/ai)** - AI SDK for language model integration
- **[quickjs-emscripten](https://www.npmjs.com/package/quickjs-emscripten)** - JavaScript sandbox
- **[exa-js](https://www.npmjs.com/package/exa-js)** - Web search functionality
- **[croner](https://www.npmjs.com/package/croner)** - Cron job scheduling

## 🤝 Contributing

When adding new tools:

1. Create tool file in [`src/tools/`](src/tools/)
2. Export tool maker function
3. Add to [`src/tools/index.ts`](src/tools/index.ts)
4. Update documentation

When modifying agent behavior:

1. Update appropriate class in [`src/`](src/)
2. Add unit tests
3. Update type definitions
4. Document API changes

## 📄 License

Part of the Keep.AI project - see root LICENSE file for details.