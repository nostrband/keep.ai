# @app/proto

> Shared protocol definitions, constants, schemas, and message contracts

The `@app/proto` package provides shared TypeScript types, Zod schemas, constants, and message contracts used throughout the Keep.AI application. It ensures consistency and type safety across all packages and applications.

## 🚀 Features

- **Type Safety**: Shared TypeScript types and interfaces
- **Schema Validation**: Zod schemas for runtime type checking
- **Message Contracts**: Standardized message types for inter-service communication
- **Transport Types**: Abstractions for different communication channels
- **Constants**: Centralized configuration constants
- **AI SDK Integration**: Extended types for AI conversation handling

## 📦 Installation

```bash
npm install @app/proto
```

## 🛠️ Usage

### Message Metadata and Types

```typescript
import { AssistantUIMessage, MessageMetadata } from '@app/proto';

// Type-safe message with metadata
const message: AssistantUIMessage = {
  id: 'msg-123',
  role: 'user',
  parts: [{ type: 'text', text: 'Hello!' }],
  metadata: {
    createdAt: new Date().toISOString(),
    threadId: 'thread-456'
  }
};

// Metadata validation
const metadata: MessageMetadata = {
  createdAt: '2023-12-03T12:00:00.000Z',
  threadId: 'thread-123' // optional
};
```

### Message Type Constants

```typescript
import { MESSAGE_TYPES, MessageType } from '@app/proto';

// Use predefined message types
const requestType: MessageType = MESSAGE_TYPES.WORKER_REQUEST;
const responseType: MessageType = MESSAGE_TYPES.WORKER_RESPONSE;

// Switch on message types
function handleMessage(type: MessageType, payload: any) {
  switch (type) {
    case MESSAGE_TYPES.AI_REQUEST:
      return handleAIRequest(payload);
    case MESSAGE_TYPES.AI_RESPONSE:
      return handleAIResponse(payload);
    case MESSAGE_TYPES.DB_QUERY:
      return handleDBQuery(payload);
    case MESSAGE_TYPES.DB_RESULT:
      return handleDBResult(payload);
    case MESSAGE_TYPES.SYNC_EVENT:
      return handleSyncEvent(payload);
    default:
      console.warn('Unknown message type:', type);
  }
}
```

### Transport Types

```typescript
import { TRANSPORT_TYPES, TransportType } from '@app/proto';

// Configure communication channels
const transport: TransportType = TRANSPORT_TYPES.HTTP;

// Transport selection logic
function createTransport(type: TransportType) {
  switch (type) {
    case TRANSPORT_TYPES.POST_MESSAGE:
      return new PostMessageTransport();
    case TRANSPORT_TYPES.HTTP:
      return new HttpTransport();
    case TRANSPORT_TYPES.IPC:
      return new IpcTransport();
    case TRANSPORT_TYPES.NOSTR:
      return new NostrTransport();
    default:
      throw new Error(`Unsupported transport type: ${type}`);
  }
}
```

### Application Constants

```typescript
import { USER_ID, DB_FILE, TASK_TYPE_PLANNER, ROUTINE_TASKS } from '@app/proto';

// Use shared constants
console.log('Default user:', USER_ID);
console.log('Database file:', DB_FILE);

// Task scheduling
const plannerCron = ROUTINE_TASKS.planner; // "1 0 * * *" (daily at 00:01)

// Task type checking
function isPlanner(taskType: string): boolean {
  return taskType === TASK_TYPE_PLANNER;
}
```

## 📋 Available Types and Constants

### Message Types

| Constant | Value | Description |
|----------|-------|-------------|
| `WORKER_REQUEST` | `'worker:request'` | Request sent to worker |
| `WORKER_RESPONSE` | `'worker:response'` | Response from worker |
| `SYNC_EVENT` | `'sync:event'` | Synchronization event |
| `AI_REQUEST` | `'ai:request'` | Request to AI service |
| `AI_RESPONSE` | `'ai:response'` | Response from AI service |
| `DB_QUERY` | `'db:query'` | Database query |
| `DB_RESULT` | `'db:result'` | Database query result |

### Transport Types

| Constant | Value | Description |
|----------|-------|-------------|
| `POST_MESSAGE` | `'postMessage'` | Browser postMessage API |
| `HTTP` | `'http'` | HTTP/HTTPS transport |
| `IPC` | `'ipc'` | Inter-process communication |
| `NOSTR` | `'nostr'` | Nostr protocol transport |

### Application Constants

| Constant | Value | Description |
|----------|-------|-------------|
| `USER_ID` | `'random-user-id'` | Default user identifier |
| `DB_FILE` | `'memory.db'` | Default database filename |
| `TASK_TYPE_PLANNER` | `'planner'` | Planner task type identifier |

### Routine Tasks

| Task Type | Cron Schedule | Description |
|-----------|---------------|-------------|
| `planner` | `'1 0 * * *'` | Daily planning task at 00:01 |

## 🏗️ Schema Definitions

### MessageMetadata

```typescript
// Zod schema for message metadata
const metadataSchema = z.object({
  createdAt: z.string().datetime(),
  threadId: z.string().optional(),
});

export type MessageMetadata = z.infer<typeof metadataSchema>;
```

### AssistantUIMessage

```typescript
// Extended UI message with typed metadata
export type AssistantUIMessage = UIMessage<MessageMetadata>;

// Usage in components
function MessageComponent({ message }: { message: AssistantUIMessage }) {
  const createdAt = new Date(message.metadata!.createdAt);
  const threadId = message.metadata?.threadId;
  
  return (
    <div>
      <p>{message.parts[0].text}</p>
      <small>Created: {createdAt.toLocaleString()}</small>
      {threadId && <small>Thread: {threadId}</small>}
    </div>
  );
}
```

## 🔄 Integration Examples

### Cross-Package Communication

```typescript
// In agent package
import { MESSAGE_TYPES, AssistantUIMessage } from '@app/proto';

export function createWorkerRequest(message: AssistantUIMessage) {
  return {
    type: MESSAGE_TYPES.WORKER_REQUEST,
    payload: message,
    timestamp: new Date().toISOString()
  };
}

// In sync package  
import { TRANSPORT_TYPES, MESSAGE_TYPES } from '@app/proto';

export class SyncManager {
  constructor(private transportType: TransportType) {}
  
  async sendSyncEvent(data: any) {
    const message = {
      type: MESSAGE_TYPES.SYNC_EVENT,
      transport: this.transportType,
      data
    };
    
    await this.transport.send(message);
  }
}
```

### Database Integration

```typescript
// In database package
import { DB_FILE, USER_ID } from '@app/proto';

export class DatabaseManager {
  private dbPath: string;
  
  constructor(customPath?: string) {
    this.dbPath = customPath || DB_FILE;
  }
  
  async getUserData() {
    return this.query('SELECT * FROM users WHERE id = ?', [USER_ID]);
  }
}
```

### Task Management

```typescript
// In task system
import { TASK_TYPE_PLANNER, ROUTINE_TASKS } from '@app/proto';

export class TaskScheduler {
  scheduleRoutineTasks() {
    // Schedule planner task
    this.schedule(TASK_TYPE_PLANNER, ROUTINE_TASKS.planner);
  }
  
  isPlannersTask(task: Task): boolean {
    return task.type === TASK_TYPE_PLANNER;
  }
}
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

## 📝 Adding New Definitions

### Adding Message Types

1. Add to [`src/messages.ts`](src/messages.ts):
```typescript
export const MESSAGE_TYPES = {
  // ... existing types
  NEW_MESSAGE_TYPE: 'new:message',
} as const;
```

2. Export the updated type:
```typescript
export type MessageType = typeof MESSAGE_TYPES[keyof typeof MESSAGE_TYPES];
```

### Adding Constants

1. Add to [`src/const.ts`](src/const.ts):
```typescript
export const NEW_CONSTANT = 'value';
export const NEW_CONFIG = {
  setting1: 'value1',
  setting2: 'value2'
};
```

### Adding Schemas

1. Add to [`src/schemas.ts`](src/schemas.ts):
```typescript
import { z } from 'zod';

const newSchema = z.object({
  field1: z.string(),
  field2: z.number().optional()
});

export type NewType = z.infer<typeof newSchema>;
```

## 📄 API Reference

### Exports

```typescript
// Constants
export const USER_ID: string;
export const DB_FILE: string;
export const TASK_TYPE_PLANNER: string;
export const ROUTINE_TASKS: { planner: string };

// Message types
export const MESSAGE_TYPES: {
  WORKER_REQUEST: 'worker:request';
  WORKER_RESPONSE: 'worker:response';
  SYNC_EVENT: 'sync:event';
  AI_REQUEST: 'ai:request';
  AI_RESPONSE: 'ai:response';
  DB_QUERY: 'db:query';
  DB_RESULT: 'db:result';
};

export type MessageType = typeof MESSAGE_TYPES[keyof typeof MESSAGE_TYPES];

// Transport types
export const TRANSPORT_TYPES: {
  POST_MESSAGE: 'postMessage';
  HTTP: 'http';
  IPC: 'ipc';
  NOSTR: 'nostr';
};

export type TransportType = typeof TRANSPORT_TYPES[keyof typeof TRANSPORT_TYPES];

// Schema types
export type MessageMetadata = {
  createdAt: string;
  threadId?: string;
};

export type AssistantUIMessage = UIMessage<MessageMetadata>;
```

## 🔗 Dependencies

- **[zod](https://www.npmjs.com/package/zod)** - TypeScript-first schema validation
- **[ai](https://www.npmjs.com/package/ai)** - AI SDK for base UIMessage type

## 🤝 Contributing

When adding new shared definitions:

1. Determine the appropriate file (`const.ts`, `schemas.ts`, or `messages.ts`)
2. Add the definition with proper TypeScript types
3. Export from [`index.ts`](src/index.ts)
4. Update this documentation
5. Consider backward compatibility
6. Add usage examples

When modifying existing types:

1. Check for breaking changes
2. Update dependent packages
3. Add migration guide if needed
4. Update version appropriately

## 📄 License

Part of the Keep.AI project - see root LICENSE file for details.