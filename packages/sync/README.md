# @app/sync

> Peer-to-peer synchronization using CRSqlite and pluggable transport layers

The `@app/sync` package provides conflict-free peer-to-peer data synchronization built on CRSqlite (Conflict-free Replicated SQLite). It enables seamless data sharing across devices with automatic conflict resolution and supports multiple transport mechanisms.

## 🚀 Features

- **Conflict-Free Synchronization**: Built on CRSqlite for automatic merge resolution
- **Transport Abstraction**: Pluggable transport layer (HTTP, WebSocket, Nostr, etc.)
- **Cursor-Based Sync**: Efficient incremental synchronization using version vectors
- **Event-Driven Architecture**: Real-time change notifications and broadcasting
- **Performance Optimized**: Change batching, caching, and optimized queries
- **Schema Versioning**: Handles schema upgrades across peers
- **Automatic Reconnection**: Robust connection management with exponential backoff

## 📦 Installation

```bash
npm install @app/sync
```

## 🛠️ Usage

### Basic Peer Setup

```typescript
import { Peer, TransportClientHttp } from '@app/sync';
import { createDBNode } from '@app/node';

// Create database connection
const db = await createDBNode('/path/to/database.db');

// Create HTTP transport
const transport = new TransportClientHttp('https://sync-server.example.com');

// Create peer with transport
const peer = new Peer(db, [transport]);

// Start synchronization
await peer.start();
console.log('Peer started with ID:', peer.id);
```

### Event Handling

```typescript
// Listen for peer connection events
peer.on('connect', (peerId, transport) => {
  console.log(`Peer ${peerId} connected`);
});

// Listen for sync completion
peer.on('eose', (peerId, transport) => {
  console.log(`Sync completed with peer ${peerId}`);
});

// Listen for data changes
peer.on('change', (tables) => {
  console.log(`Changes detected in tables:`, tables);
  // Update UI, refresh queries, etc.
});

// Listen for schema version mismatches
peer.on('outdated', (requiredVersion, peerId, transport) => {
  console.log(`Schema update required: ${requiredVersion}`);
  // Handle app update
});
```

### Server-Side Synchronization

```typescript
import fastify from 'fastify';
import { TransportServerFastify } from '@app/node';
import { Peer } from '@app/sync';

const app = fastify();
const transport = new TransportServerFastify();

// Create server-side peer
const serverPeer = new Peer(db, [transport]);
await serverPeer.start();

// Register transport routes
await transport.registerRoutes(app);

// Start server
await app.listen({ port: 3000 });
console.log('Sync server running on port 3000');
```

### Manual Change Broadcasting

```typescript
// Check for local changes and broadcast to peers
await peer.checkLocalChanges();

// This will:
// 1. Query for new local changes since last sync
// 2. Update local cursor
// 3. Broadcast changes to all connected peers
// 4. Emit 'change' events for affected tables
```

### Multiple Transport Support

```typescript
import { TransportClientHttp, TransportNostr } from '@app/sync';

// Create multiple transports
const httpTransport = new TransportClientHttp('https://api.example.com');
const nostrTransport = new TransportNostr(['wss://relay1.com', 'wss://relay2.com']);

// Peer can use multiple transports simultaneously
const peer = new Peer(db, [httpTransport, nostrTransport]);
await peer.start();

// Peer will broadcast changes through all transports
// and receive changes from any connected peer
```

## 🏗️ Architecture

### Peer Class
The main orchestrator for synchronization:

```typescript
class Peer extends EventEmitter {
  constructor(db: DBInterface, transports: Transport[])
  
  async start(): Promise<void>
  async stop(): Promise<void>
  async checkLocalChanges(): Promise<void>
  
  // Event emitters
  on('connect', (peerId: string, transport: Transport) => void)
  on('sync', (peerId: string, transport: Transport) => void)
  on('eose', (peerId: string, transport: Transport) => void)
  on('change', (tables: string[]) => void)
  on('outdated', (version: number, peerId: string, transport: Transport) => void)
}
```

### Transport Interface
Abstraction for different communication protocols:

```typescript
interface Transport {
  start(config: TransportConfig): Promise<void>
  sync(peerId: string, cursor: Cursor): Promise<void>
  send(peerId: string, message: PeerMessage): Promise<void>
  stop?(): void
}

interface TransportCallbacks {
  onConnect: (transport: Transport, peerId: string) => Promise<void>
  onSync: (transport: Transport, peerId: string, cursor: Cursor) => Promise<void>
  onReceive: (transport: Transport, peerId: string, msg: PeerMessage) => Promise<void>
  onDisconnect: (transport: Transport, peerId: string) => Promise<void>
}
```

## 🔄 Synchronization Flow

### Initial Connection
1. **Transport Connect**: Transport establishes connection with remote peer
2. **Peer Handshake**: Peers exchange IDs and initiate sync requests
3. **Cursor Exchange**: Peers send their current knowledge state (cursor)
4. **Change Transfer**: Missing changes are transferred based on cursors
5. **EOSE Signal**: End-of-stored-events indicates sync completion

### Ongoing Synchronization
1. **Local Changes**: Database modifications trigger change detection
2. **Cursor Update**: Local cursor updated with new change vectors
3. **Broadcasting**: Changes broadcast to all connected peers
4. **Conflict Resolution**: CRSqlite automatically resolves conflicts
5. **Event Emission**: Applications notified of data changes

### Example Flow
```typescript
// Peer A connects to Peer B
// 1. Transport connects
await transportA.start(peerA.getConfig());

// 2. Sync initiated
await transportA.sync('peer-b', peerA.cursor);

// 3. Peer B receives sync request
// onSync(transport, 'peer-a', cursor)

// 4. Peer B sends changes since cursor
await transportB.send('peer-a', {
  type: 'changes',
  data: changesToSend,
  schemaVersion: 5
});

// 5. Peer A receives and applies changes
// onReceive(transport, 'peer-b', message)

// 6. Sync completion signaled
await transportB.send('peer-a', {
  type: 'eose',
  data: []
});
```

## 🚌 Transport Implementations

### HTTP Transport (Client)
Server-Sent Events (SSE) based transport for web clients:

```typescript
const transport = new TransportClientHttp('https://sync-server.com');

// Features:
// - SSE for real-time updates
// - HTTP POST for sending data
// - Automatic reconnection with exponential backoff
// - Cross-origin support (CORS)
```

### HTTP Transport (Server)
Fastify-based server transport (see `@app/node` package):

```typescript
const transport = new TransportServerFastify();
await transport.registerRoutes(fastifyApp);

// Features:
// - Multiple client connection management
// - Per-peer SSE streams
// - Connection cleanup and ping/keep-alive
// - CORS and security headers
```

### Custom Transports
Implement the `Transport` interface for custom protocols:

```typescript
class CustomTransport implements Transport {
  async start(config: TransportConfig): Promise<void> {
    // Initialize connection
  }
  
  async sync(peerId: string, cursor: Cursor): Promise<void> {
    // Request sync from peer
  }
  
  async send(peerId: string, message: PeerMessage): Promise<void> {
    // Send message to peer
  }
}
```

## 📊 Performance Features

### Optimized Change Tracking
```typescript
// Uses crsql_change_history table for fast queries
// instead of querying the virtual crsql_changes table
const changes = await db.execO(`
  SELECT * FROM crsql_change_history 
  WHERE site_id = ? AND db_version > ?
`, [siteId, lastVersion]);
```

### Change Batching
```typescript
// Processes changes in batches for better performance
const BATCH_SIZE = 2000;
const batches = chunk(changes, BATCH_SIZE);

for (const batch of batches) {
  await db.tx(async (tx) => {
    await tx.execManyArgs(sql, batch);
  });
}
```

### Cursor Optimization
```typescript
// Maintains all_peers table for fast cursor reads
// instead of scanning crsql_changes for each peer
await db.exec(`
  INSERT INTO all_peers (site_id, db_version) 
  VALUES (?, ?)
`, [siteId, dbVersion]);
```

## 🔧 Configuration

### Peer Configuration
```typescript
const peer = new Peer(db, transports);

// Event handlers are automatically queued to prevent race conditions
// Schema version is read from database PRAGMA user_version
// Site ID is automatically generated from CRSqlite
```

### Transport Configuration
```typescript
// HTTP Transport
const transport = new TransportClientHttp('https://server.com', fetchFn);

// Custom fetch function (for Node.js compatibility)
const customFetch = (input, init) => {
  return nodeFetch(input, init);
};
```

## 🛡️ Error Handling

### Connection Resilience
```typescript
// Automatic reconnection with exponential backoff
private scheduleReconnect() {
  const delay = Math.min(
    this.baseReconnectDelay * Math.pow(2, this.reconnectAttempts),
    30000 // Max 30 seconds
  );
  
  setTimeout(() => this.connectSSE(), delay);
}
```

### Schema Version Conflicts
```typescript
peer.on('outdated', (requiredVersion, peerId, transport) => {
  // Handle schema version mismatch
  if (requiredVersion > currentVersion) {
    showUpdateDialog('App update required');
  }
});
```

### Validation and Safety
```typescript
// All changes are validated before applying
private validateChange(change: PeerChange) {
  if (!change.table || typeof change.table !== 'string') {
    throw new Error('Invalid table name');
  }
  
  if (!/^[0-9a-fA-F]*$/.test(change.site_id)) {
    throw new Error('Invalid site_id hex string');
  }
  
  // ... additional validation
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

## 📝 API Reference

### Core Classes

#### `Peer`
Main synchronization orchestrator.

```typescript
class Peer extends EventEmitter {
  constructor(db: DBInterface | (() => DBInterface), transports: Transport[])
  
  readonly id: string
  readonly schemaVersion: number
  
  async start(): Promise<void>
  async stop(): Promise<void>
  async checkLocalChanges(): Promise<void>
  
  getConfig(): TransportConfig
}
```

#### `TransportClientHttp`
HTTP-based client transport using SSE.

```typescript
class TransportClientHttp implements Transport {
  constructor(endpoint: string, fetchFn?: FetchFunction)
  
  async start(config: TransportConfig): Promise<void>
  async sync(peerId: string, cursor: Cursor): Promise<void>
  async send(peerId: string, message: PeerMessage): Promise<void>
  stop(): void
  
  // Utility methods
  isSSEConnected(): boolean
  getEndpoint(): string
  getReconnectAttempts(): number
  getRemotePeerId(): string | undefined
}
```

### Data Types

```typescript
interface PeerMessage {
  type: 'changes' | 'eose';
  data: PeerChange[];
  schemaVersion?: number;
}

interface PeerChange {
  table: string;
  pk: string;        // hex string
  cid: string;
  val: any;
  col_version: number;
  db_version: number;
  site_id: string;   // hex string
  cl: number;
  seq: number;
}

interface Cursor {
  peers: Map<string, number>; // site_id -> db_version
}

interface TransportMessage {
  type: 'connect' | 'sync' | 'data' | 'ping' | 'error';
  peerId: string;
  cursor?: SerializedCursor;
  data?: PeerMessage;
  error?: string;
}
```

### Utility Functions

```typescript
// Cursor manipulation
function updateCursor(cursor: Cursor, changes: PeerChange[]): void
function filterChanges(changes: PeerChange[], cursor: Cursor): PeerChange[]
function isCursorOlder(a: Cursor, b: Cursor): boolean

// Serialization
function serializeCursor(cursor: Cursor): SerializedCursor
function deserializeCursor(data: SerializedCursor): Cursor
function serializeChanges(changes: Change[]): PeerChange[]
function deserializeChanges(changes: PeerChange[]): Change[]
```

## 🔗 Dependencies

- **[@app/db](../db/)** - Database interface and CRSqlite integration
- **[@app/agent](../agent/)** - Agent system (indirect dependency via events)
- **[@app/proto](../proto/)** - Shared protocol definitions
- **[tseep](https://www.npmjs.com/package/tseep)** - Type-safe EventEmitter implementation
- **[nostr-tools](https://www.npmjs.com/package/nostr-tools)** - Utilities for hex/byte conversion
- **[debug](https://www.npmjs.com/package/debug)** - Debug logging utilities

## 🤝 Contributing

When adding new transport implementations:

1. Implement the [`Transport`](src/Transport.ts) interface
2. Handle all callback methods properly
3. Add error handling and reconnection logic
4. Test with multiple peers
5. Update documentation

When modifying the Peer class:

1. Ensure all changes are properly queued
2. Maintain cursor consistency
3. Test conflict resolution scenarios
4. Update performance optimizations
5. Document breaking changes

## 📄 License

Part of the Keep.AI project - see root LICENSE file for details.