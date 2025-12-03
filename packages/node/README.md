# @app/node

> Node.js-specific database and server utilities for Keep.AI

The `@app/node` package provides Node.js-specific implementations for database creation, user environment management, and server-side peer-to-peer synchronization transport. It bridges the gap between the cross-platform database layer and Node.js system capabilities.

## 🚀 Features

- **SQLite3 + CRSqlite**: Native Node.js database implementation with conflict-free replication
- **User Environment Management**: Automatic setup of user directories and Nostr key generation
- **Database Path Utilities**: Multi-user support with isolated data storage
- **Fastify Transport Server**: Server-side SSE transport for peer synchronization
- **Transaction Support**: Full ACID transaction support with rollback capabilities
- **Performance Optimization**: WAL mode, connection pooling, and optimal SQLite settings

## 📦 Installation

```bash
npm install @app/node
```

## 🛠️ Usage

### Database Creation

```typescript
import { createDBNode } from '@app/node';

// Create a Node.js database instance
const db = await createDBNode('/path/to/database.db');

// Use with Keep.AI database layer
import { KeepDb } from '@app/db';

class NodeKeepDb extends KeepDb {
  async start(): Promise<void> {
    this.db = await createDBNode(this.dbPath);
    await this.initialize();
  }
}
```

### User Environment Setup

```typescript
import { 
  ensureEnv, 
  getCurrentUser, 
  getCurrentUserDBPath,
  getDBPath,
  getUserPath,
  getKeepaiDir 
} from '@app/node';

// Ensure Keep.AI environment is set up
await ensureEnv();

// Get current user's public key
const pubkey = await getCurrentUser();
console.log('Current user:', pubkey);

// Get database path for current user
const dbPath = await getCurrentUserDBPath();
console.log('Database path:', dbPath);

// Get database path for specific user
const userDbPath = getDBPath('npub1234...user_pubkey');

// Get user directory
const userDir = getUserPath('npub1234...user_pubkey');
console.log('User directory:', userDir);
```

### Server Transport (Fastify Integration)

```typescript
import fastify from 'fastify';
import { TransportServerFastify } from '@app/node';
import { Peer } from '@app/sync';

const app = fastify();
const transport = new TransportServerFastify();

// Initialize peer and transport
const peer = new Peer();
await peer.start({
  transport,
  localPeerId: 'user_public_key',
  onConnect: async (transport, peerId) => {
    console.log('Peer connected:', peerId);
  },
  onSync: async (transport, peerId, cursor) => {
    console.log('Sync requested by:', peerId);
    // Handle sync logic
  },
  onReceive: async (transport, peerId, data) => {
    console.log('Data received from:', peerId);
    // Handle incoming data
  },
  onDisconnect: async (transport, peerId) => {
    console.log('Peer disconnected:', peerId);
  }
});

// Register transport routes
await transport.registerRoutes(app);

// Start server
await app.listen({ port: 3000 });
console.log('Keep.AI sync server running on port 3000');
```

## 🏗️ Environment Structure

The package automatically creates and manages this directory structure:

```
~/.keep.ai/
├── current_user.txt          # Current active user's public key
├── users.json                # All users' key pairs
├── .env                      # Environment variables (API keys, etc.)
└── [user_pubkey]/           # Per-user directories
    ├── data.db              # User's SQLite database
    └── ... (other user files)
```

### User Management

```typescript
import { ensureEnv, getCurrentUser } from '@app/node';

// First run - creates new user
await ensureEnv();
/*
Creates:
- ~/.keep.ai/ directory
- New Nostr key pair
- current_user.txt with public key
- users.json with key pair
- User directory with pubkey name
*/

// Get current user
const pubkey = await getCurrentUser();
// Returns: "npub1..." format public key
```

### Multi-User Support

```typescript
import { getDBPath, getUserPath } from '@app/node';

// Get paths for different users
const alice = 'npub1alice...';
const bob = 'npub1bob...';

const aliceDbPath = getDBPath(alice);
const bobDbPath = getDBPath(bob);

console.log(aliceDbPath); // ~/.keep.ai/npub1alice.../data.db
console.log(bobDbPath);   // ~/.keep.ai/npub1bob.../data.db

// Each user gets isolated storage
const aliceDir = getUserPath(alice);
const bobDir = getUserPath(bob);
```

## 🗄️ Database Implementation

### SQLite3 Wrapper

The `Sqlite3DBWrapper` class adapts Node.js sqlite3 to the `DBInterface`:

```typescript
// Automatic transaction handling
await db.tx(async (tx) => {
  await tx.exec('INSERT INTO notes (title) VALUES (?)', ['My Note']);
  await tx.exec('INSERT INTO tasks (title) VALUES (?)', ['My Task']);
  // Automatically commits on success, rolls back on error
});

// Batch operations
await db.execManyArgs(
  'INSERT INTO tags (name) VALUES (?)',
  [['tag1'], ['tag2'], ['tag3']]
);

// Query with results
const results = await db.execO<{id: string, title: string}>(
  'SELECT id, title FROM notes WHERE id = ?',
  ['note-123']
);
```

### Performance Optimizations

The database is automatically configured with:

```sql
PRAGMA journal_mode = WAL;      -- Write-Ahead Logging for better concurrency
PRAGMA synchronous = NORMAL;    -- Balanced performance and safety
PRAGMA busy_timeout = 10000;    -- 10-second timeout for busy database
```

### CRSqlite Integration

```typescript
// CRSqlite extension is automatically loaded
// Provides conflict-free replication capabilities:
// - Automatic change tracking
// - Version vectors for causality
// - Mergeable data structures
// - Site-based conflict resolution
```

## 🔄 Transport Server (SSE-based)

### Endpoint Overview

The Fastify transport server provides these endpoints:

#### `GET /stream?peerId=<peer_id>`
- Server-Sent Events (SSE) connection
- Real-time bi-directional communication
- Automatic ping/keep-alive every 30 seconds
- Per-peer connection management

#### `POST /sync`
- Initiate data synchronization
- Send cursor information for incremental sync
- Request changes since last known state

#### `POST /data` 
- Send actual change data
- Bulk transfer of database changes
- End-of-stream signaling

### Client-Server Flow

```typescript
// Server side (using transport)
const transport = new TransportServerFastify();
await transport.start({
  localPeerId: 'server_pubkey',
  onConnect: async (transport, peerId) => {
    // Peer connected via SSE
  },
  onSync: async (transport, peerId, cursor) => {
    // Send changes since cursor
    await transport.send(peerId, {
      type: 'changes',
      data: changesSinceCursor
    });
  },
  onReceive: async (transport, peerId, data) => {
    // Apply received changes
  }
});

// Client connects to:
// GET  /stream?peerId=client_pubkey  (SSE connection)
// POST /sync                         (request sync)
// POST /data                         (send changes)
```

## ⚙️ Configuration

### Custom Database Path

```typescript
import { createDBNode } from '@app/node';

const customDb = await createDBNode('/custom/path/database.db');
```

### Custom Home Directory

```typescript
import { ensureEnv, getCurrentUserDBPath } from '@app/node';

// Use custom directory instead of ~/.keep.ai
await ensureEnv('/custom/home/path');
const dbPath = await getCurrentUserDBPath('/custom/home/path');
```

### Fastify Server Options

```typescript
import fastify from 'fastify';

const server = fastify({
  logger: true,
  trustProxy: true
});

const transport = new TransportServerFastify();
await transport.registerRoutes(server);

await server.listen({ 
  port: 3000, 
  host: '0.0.0.0' 
});
```

## 🛡️ Security Features

- **Key Generation**: Uses `nostr-tools` for cryptographically secure key generation
- **Isolated Storage**: Each user gets separate database and directory
- **CORS Protection**: Configurable CORS policies for web access
- **Connection Limits**: One SSE connection per peer ID
- **Parameterized Queries**: SQL injection protection throughout

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

### Database Functions

#### `createDBNode(file: string): Promise<DBInterface>`
Creates a SQLite3 database instance with CRSqlite extension.

**Parameters:**
- `file` - Path to SQLite database file

**Returns:**
- Promise resolving to `DBInterface` implementation

### Environment Functions

#### `ensureEnv(homePath?: string): Promise<void>`
Ensures Keep.AI environment is properly initialized.

**Parameters:**
- `homePath` - Optional custom home directory (default: `os.homedir()`)

#### `getCurrentUser(homePath?: string): Promise<string>`
Gets the current user's public key.

**Returns:**
- Promise resolving to user's public key

#### `getCurrentUserDBPath(homePath?: string): Promise<string>`
Gets the database path for the current user.

**Returns:**
- Promise resolving to database file path

#### `getDBPath(pubkey: string, homePath?: string): string`
Gets the database path for a specific user.

**Parameters:**
- `pubkey` - User's public key
- `homePath` - Optional custom home directory

#### `getUserPath(pubkey: string, homePath?: string): string`
Gets the user directory for a specific user.

**Parameters:**
- `pubkey` - User's public key
- `homePath` - Optional custom home directory

#### `getKeepaiDir(homePath?: string): string`
Gets the Keep.AI directory path.

**Parameters:**
- `homePath` - Optional custom home directory (default: `os.homedir()`)

### Transport Class

#### `TransportServerFastify`
Server-side SSE transport for peer synchronization.

```typescript
class TransportServerFastify implements Transport {
  async start(config: TransportCallbacks & { localPeerId: string }): Promise<void>
  async registerRoutes(fastify: FastifyInstance): Promise<void>
  async sync(peerId: string, localCursor: Cursor): Promise<void>
  async send(peerId: string, message: PeerMessage): Promise<void>
  stop(): void
  getConnectedClientsCount(): number
  getConnectedPeerIds(): string[]
}
```

## 🔗 Dependencies

- **[@app/db](../db/)** - Database interfaces and base functionality
- **[@app/sync](../sync/)** - Synchronization protocol and transport interface
- **[sqlite3](https://www.npmjs.com/package/sqlite3)** - Native SQLite3 bindings for Node.js
- **[@nostrband/crsqlite](https://www.npmjs.com/package/@nostrband/crsqlite)** - CRSqlite extension for conflict-free replication
- **[fastify](https://www.npmjs.com/package/fastify)** - Fast and low overhead web framework
- **[nostr-tools](https://www.npmjs.com/package/nostr-tools)** - Nostr protocol utilities and key generation

## 🤝 Contributing

When adding new Node.js utilities:

1. Create utility functions in [`src/`](src/)
2. Export from [`index.ts`](src/index.ts)
3. Add TypeScript interfaces
4. Update documentation
5. Add error handling

When modifying database implementation:

1. Update [`Sqlite3DBWrapper`](src/createDB.ts)
2. Ensure compatibility with `DBInterface`
3. Test transaction behavior
4. Document breaking changes

When updating transport server:

1. Modify [`TransportServerFastify`](src/TransportServerFastify.ts)
2. Update endpoint schemas
3. Test SSE connection handling
4. Update client integration docs

## 📄 License

Part of the Keep.AI project - see root LICENSE file for details.