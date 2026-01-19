# @app/db

> Database abstraction layer with CRSqlite integration for conflict-free data synchronization

The `@app/db` package provides a comprehensive database layer built on CRSqlite (conflict-free replicated SQLite), enabling offline-first functionality with automatic conflict resolution across distributed devices.

## 🚀 Features

- **Conflict-Free Replication**: Built on CRSqlite for automatic merge resolution
- **Offline-First**: Local SQLite database with sync capabilities  
- **Type-Safe APIs**: Fully typed TypeScript interfaces
- **Transaction Support**: ACID transactions with rollback capabilities
- **Multiple Data Stores**: Specialized stores for different data types
- **Encryption Support**: Built-in data encryption and security
- **Schema Migrations**: Automatic database schema management

## 📦 Installation

```bash
npm install @app/db
```

## 🛠️ Usage

### Basic Setup

```typescript
import { KeepDb, KeepDbApi } from '@app/db';

// Initialize database
const db = new KeepDb();
await db.start();

// Create API instance
const api = new KeepDbApi(db);

// Use the API
await api.addMessage({
  threadId: 'main',
  message: {
    id: 'msg-123',
    role: 'user',
    parts: [{ type: 'text', text: 'Hello!' }],
    metadata: { createdAt: new Date().toISOString() }
  }
});

// Close when done
await db.close();
```

### Working with Transactions

```typescript
import { KeepDb } from '@app/db';

const result = await db.db.tx(async (tx) => {
  // All operations within this block are transactional
  await api.noteStore.createNote({
    title: 'Meeting Notes',
    content: 'Important discussion points...',
    tags: ['work', 'meeting']
  }, tx);
  
  await api.taskStore.addTask(
    'task-123',
    Math.floor(Date.now() / 1000),
    'Schedule follow-up meeting',
    'worker',
    'thread-456',
    'Follow-up Meeting',
    '', // no cron
    tx
  );
  
  return 'success';
});
```

## 🗂️ Data Stores

### Notes Store
Manage notes and documents with full-text search.

```typescript
// Create a note
const note = await api.noteStore.createNote({
  title: 'Project Ideas',
  content: 'Brainstorming session results...',
  tags: ['project', 'ideas'],
  parent_id: '', // optional parent note
  position: 0
});

// Search notes
const results = await api.noteStore.searchNotes({
  query: 'project',
  tags: ['ideas'],
  limit: 10
});

// Update note
await api.noteStore.updateNote(note.id, {
  content: 'Updated content...',
  tags: ['project', 'ideas', 'priority']
});
```

### Task Store
Handle task management with scheduling and state tracking.

```typescript
// Add a task
const taskId = await api.taskStore.addTask(
  'task-456',
  Math.floor(Date.now() / 1000), // timestamp
  'Complete project proposal',    // task description
  'worker',                      // type
  'thread-789',                  // thread ID
  'Project Proposal',            // title
  '0 9 * * 1'                   // cron schedule (optional)
);

// Get todo tasks (ready to execute)
const todoTasks = await api.taskStore.getTodoTasks();

// Update task state
await api.taskStore.saveState({
  id: taskId,
  goal: 'Complete the proposal by deadline',
  plan: 'Research, draft, review, submit',
  notes: 'Include budget section',
  asks: 'Need approval from manager'
});
```

### Chat Store
Manage conversational threads and messages.

```typescript
// Create a new chat
const chatId = await api.chatStore.createChat({
  id: 'chat-123',
  title: 'AI Assistant Chat',
  description: 'General conversation'
});

// Save chat messages
await api.chatStore.saveChatMessages(chatId, [
  {
    id: 'msg-1',
    role: 'user',
    parts: [{ type: 'text', text: 'Hello!' }],
    metadata: { createdAt: new Date().toISOString() }
  },
  {
    id: 'msg-2', 
    role: 'assistant',
    parts: [{ type: 'text', text: 'Hi there! How can I help?' }],
    metadata: { createdAt: new Date().toISOString() }
  }
]);

// Get chat messages
const messages = await api.chatStore.getChatMessages({
  chatId,
  limit: 50
});
```

### Inbox Store
Handle message queuing and routing between components.

```typescript
// Send item to inbox
await api.inboxStore.saveInbox({
  id: 'inbox-item-123',
  source: 'user',
  source_id: 'msg-456',
  target: 'router',
  target_id: '',
  content: JSON.stringify({ type: 'chat_message', data: 'Hello' }),
  timestamp: new Date().toISOString(),
  handler_timestamp: '',
  handler_thread_id: ''
});

// Process inbox items
const items = await api.inboxStore.listInboxItems({
  target: 'router',
  handled: false,
  limit: 10
});

// Mark as handled
for (const item of items) {
  await api.inboxStore.handleInboxItem(
    item.id,
    new Date().toISOString(),
    'handler-thread-123'
  );
}
```

### Memory Store
Store conversation threads and resources.

```typescript
// Save a thread
await api.memoryStore.saveThread({
  id: 'thread-123',
  title: 'Customer Support Chat',
  created_at: new Date(),
  updated_at: new Date()
});

// Save messages to memory
await api.memoryStore.saveMessages([
  {
    id: 'msg-123',
    role: 'user',
    parts: [{ type: 'text', text: 'I need help' }],
    metadata: {
      createdAt: new Date().toISOString(),
      threadId: 'thread-123'
    }
  }
]);

// Get conversation history
const history = await api.memoryStore.getMessages({
  threadId: 'thread-123',
  limit: 100
});
```

### Nostr Peer Store
Manage peer-to-peer connections for synchronization.

```typescript
// Add a peer
await api.nostrPeerStore.addPeer({
  pubkey: 'npub1234...',
  relays: ['wss://relay1.example.com', 'wss://relay2.example.com'],
  created_at: new Date(),
  name: 'Alice Device',
  enabled: true
});

// List all peers
const peers = await api.nostrPeerStore.listPeers();

// Set sync cursors
await api.nostrPeerStore.setNostrPeerCursorSend({
  peer_pubkey: 'npub1234...',
  last_sent_id: 'change-456',
  last_sent_at: new Date().toISOString()
});
```

## 🔧 Database Schema

The database automatically manages tables for:

- **`notes`** - Note storage with hierarchical support
- **`tasks`** - Task definitions and scheduling
- **`task_states`** - Task execution state
- **`task_runs`** - Task execution history
- **`chats`** - Chat conversation metadata
- **`chat_messages`** - Chat message storage
- **`threads`** - Conversation threads
- **`messages`** - Generic message storage
- **`inbox`** - Message queue and routing
- **`nostr_peers`** - Peer connection info
- **`nostr_peer_cursors`** - Sync position tracking

## ⚙️ Configuration

### Database with Custom Path

```typescript
import { KeepDb } from '@app/db';

const db = new KeepDb('/custom/path/to/database.db');
await db.start();
```

### Transaction Options

```typescript
// Manual transaction control
await db.db.tx(async (tx) => {
  try {
    // Your operations here
    await someOperation(tx);
    await anotherOperation(tx);
    // Transaction commits automatically on success
  } catch (error) {
    // Transaction rolls back automatically on error
    throw error;
  }
});
```

## 🔄 CRSqlite Integration

The database leverages CRSqlite for conflict-free replication:

- **Automatic Merging**: Changes from multiple devices merge automatically
- **Version Vectors**: Track causality between changes
- **Site IDs**: Unique identifiers for each device/instance
- **Change Streams**: Export and import change sets for sync

```typescript
// Example: Working with change streams (handled internally)
const changes = await db.db.changes();
// Changes can be sent to other devices for synchronization
```

## 🛡️ Security Features

- **Data Encryption**: Uses `@noble/ciphers` for encryption
- **SQL Injection Protection**: Parameterized queries throughout
- **Type Safety**: Full TypeScript coverage prevents runtime errors
- **Transaction Isolation**: ACID compliance for data integrity

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

#### `KeepDb`
Main database class wrapping CRSqlite functionality.

```typescript
class KeepDb {
  constructor(dbPath?: string)
  async start(): Promise<void>
  async close(): Promise<void>
  get db(): CRSqliteDB // Access to raw database
}
```

#### `KeepDbApi`
High-level API providing access to all data stores.

```typescript
class KeepDbApi {
  constructor(db: KeepDb)
  
  // Store instances
  noteStore: NoteStore
  taskStore: TaskStore
  chatStore: ChatStore
  memoryStore: MemoryStore
  inboxStore: InboxStore
  nostrPeerStore: NostrPeerStore
  
  // Utility methods
  async addMessage(input: AddMessageInput): Promise<AssistantUIMessage>
}
```

### Data Types

```typescript
interface Note {
  id: string;
  title: string;
  content: string;
  tags: string[];
  parent_id: string;
  position: number;
  created_at: Date;
  updated_at: Date;
}

interface Task {
  id: string;
  timestamp: number;
  task: string;
  type: string;
  thread_id: string;
  title: string;
  reply: string;
  state: string;
  error: string;
  cron: string;
}

interface InboxItem {
  id: string;
  source: 'user' | 'router' | 'worker';
  target: 'router' | 'worker' | 'replier';
  content: string;
  timestamp: string;
  // ... other fields
}
```

## 🔗 Dependencies

- **[@app/proto](../proto/)** - Shared protocol definitions and schemas
- **[@noble/ciphers](https://www.npmjs.com/package/@noble/ciphers)** - Cryptographic primitives
- **[debug](https://www.npmjs.com/package/debug)** - Debug logging utilities

## 🤝 Contributing

When adding new data stores:

1. Create store class in [`src/`](src/)
2. Add to [`KeepDbApi`](src/api.ts) class
3. Update database schema in [`initialize()`](src/database.ts)
4. Add TypeScript interfaces
5. Update documentation

When modifying schemas:

1. Add migration logic to [`database.ts`](src/database.ts)
2. Update TypeScript types
3. Test migration with sample data
4. Document breaking changes

## 📄 License

Part of the Keep.AI project - see root LICENSE file for details.