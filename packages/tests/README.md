# @app/tests

> Comprehensive test suite for Keep.AI packages and functionality

The `@app/tests` package provides a comprehensive test suite covering all major functionality of Keep.AI, including database operations, peer synchronization, encryption, transport layers, and sandbox environments.

## 🚀 Features

- **Cross-Platform Testing**: Tests for both Node.js and browser environments
- **Database Testing**: Comprehensive SQLite and CRSqlite functionality tests
- **Synchronization Testing**: Peer-to-peer sync and conflict resolution tests
- **Transport Testing**: Multiple transport layer implementations
- **Security Testing**: Encryption and cryptographic functionality
- **Sandbox Testing**: Safe code execution environment tests
- **Performance Testing**: Bulk operations and optimization validation

## 📦 Setup

Install dependencies:
```bash
npm install
```

## 🧪 Running Tests

### All Tests
```bash
npm test
```

### Run Tests Once (CI Mode)
```bash
npm run test:run
```

### Type Checking
```bash
npm run type-check
```

### Watch Mode (Development)
```bash
npm test
# Tests will re-run when files change
```

## 📋 Test Suites

### Database Tests

#### `db-close.test.ts`
Tests database connection lifecycle and SQLITE_BUSY issue isolation.

```bash
# Tests database open/close operations
# Validates clean resource cleanup
# Isolates connection issues
```

#### `exec-many-args-node.test.ts`
Comprehensive Node.js database bulk operation tests.

```bash
# Bulk insert operations
# Bulk update operations  
# Bulk delete operations
# Transaction handling
# Error handling scenarios
# Performance validation
```

#### `exec-many-args-browser.test.ts`
Browser-specific database operation tests.

```bash
# WASM execution contexts
# Browser SQLite functionality
# Large batch operations
# Memory management tests
```

### Synchronization Tests

#### `crsqlite-peer-new.test.ts`
Complete peer-to-peer synchronization test suite.

```bash
# Data synchronization between peers
# Update propagation
# Deletion handling
# Multi-table operations
# Change event emission
```

**Example Test Structure:**
```typescript
describe("CRSqlitePeerNew Synchronization", () => {
  it("should synchronize data between two peers", async () => {
    // Setup two peers with direct transport
    const [peer1, peer2] = await setupPeers();
    
    // Insert data on peer1
    await peer1.db.exec("INSERT INTO users (name) VALUES (?)", ["Alice"]);
    
    // Trigger sync
    await peer1.checkLocalChanges();
    
    // Verify data appears on peer2
    const data = await peer2.db.execO("SELECT * FROM users");
    expect(data?.[0]?.name).toBe("Alice");
  });
});
```

### Transport Tests

#### `nostr-transport.test.ts`
Basic Nostr transport functionality tests.

```bash
# Connection string generation
# Peer connection establishment  
# Authentication validation
# Multi-relay support
# Error handling
```

#### `nostr-transport-sync.test.ts`
Advanced Nostr transport synchronization tests.

```bash
# Full sync workflow via Nostr
# Multi-peer synchronization hub
# Connection termination and recovery
# Real-world sync scenarios
```

### Security Tests

#### `nip44-v3.test.ts`
Encryption and cryptographic functionality tests.

```bash
# Symmetric encryption/decryption
# Message authentication codes (MAC)
# Tamper detection
# Key derivation 
# Edge case handling
```

**Example Encryption Test:**
```typescript
it('produces identical conversation keys and decrypts messages symmetrically', () => {
  const keyPairA = createKeyPair();
  const keyPairB = createKeyPair();
  
  // Derive shared keys
  const { conversationKey: ckA } = deriveSharedKeys(keyPairA, keyPairB.pubkey);
  const { conversationKey: ckB } = deriveSharedKeys(keyPairB, keyPairA.pubkey);
  
  expect(ckA).toEqual(ckB);
  
  // Test encryption/decryption
  const plaintext = "Hello, world!";
  const encrypted = encrypt(ckA, plaintext);
  const decrypted = decrypt(ckB, encrypted);
  
  expect(decrypted).toBe(plaintext);
});
```

### Sandbox Tests

#### `sandbox.test.ts`
Safe code execution environment tests.

```bash
# Synchronous and asynchronous code evaluation
# Host-guest communication
# Error propagation
# Timeout handling  
# Abort signal support
# Security isolation
```

## 🔧 Test Configuration

### Vitest Configuration
Located in [`vitest.config.ts`](vitest.config.ts):

```typescript
export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
  },
  resolve: {
    conditions: ['node', 'import', 'default']
  },
});
```

### Key Settings:
- **Environment**: Node.js for better SQLite support
- **Globals**: `describe`, `it`, `expect` available globally
- **Module Resolution**: Node-first resolution for proper package loading

## 🏗️ Test Architecture

### Direct Transport for Testing
Custom transport implementation for isolated peer testing:

```typescript
class DirectTransport implements Transport {
  connectTo(other: DirectTransport) {
    // Direct connection without network overhead
  }
  
  async sync(peerId: string, cursor: Cursor) {
    // Immediate sync for deterministic testing
  }
}
```

### Test Database Setup
Temporary in-memory databases for each test:

```typescript
beforeEach(async () => {
  db = await createDBNode(':memory:');
  await setupTestTables(db);
});

afterEach(async () => {
  await db.close();
});
```

### Test Isolation
Each test runs with:
- Fresh database instances
- Isolated peer connections
- Clean transport states
- Independent crypto keys

## 📊 Test Coverage Areas

### Core Functionality
- ✅ Database operations (CRUD, transactions, bulk ops)
- ✅ Peer synchronization (CRSqlite, cursors, conflicts)
- ✅ Transport layers (HTTP, Nostr, direct)
- ✅ Encryption/decryption (NIP-44)
- ✅ Sandbox execution (QuickJS)

### Edge Cases
- ✅ Connection failures and recovery
- ✅ Data corruption and validation
- ✅ Concurrent access patterns
- ✅ Memory pressure scenarios
- ✅ Network partition simulation

### Performance
- ✅ Bulk operation benchmarks
- ✅ Sync performance with large datasets
- ✅ Memory usage validation
- ✅ Timeout handling

## 🐛 Debugging Tests

### Enable Debug Logging
```bash
DEBUG=* npm test
# Or specific components:
DEBUG=sync:* npm test
DEBUG=node:* npm test
```

### Vitest UI (Optional)
```bash
npx vitest --ui
# Opens browser-based test runner
```

### Test-Specific Debugging
Add debugging to specific tests:

```typescript
import debug from 'debug';
const debugTest = debug('test:sync');

it('should sync data', async () => {
  debugTest('Setting up peers...');
  // Test implementation
  debugTest('Sync completed');
});
```

## 🔍 Test Development Guidelines

### Adding New Tests

1. **Create test file** in [`src/`](src/) with `.test.ts` suffix
2. **Follow naming convention**: `feature-name.test.ts`
3. **Use descriptive test names**: `should [expected behavior] when [condition]`
4. **Setup and teardown**: Always clean up resources

### Test Structure Template
```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

describe('Feature Name', () => {
  beforeEach(async () => {
    // Setup test environment
  });

  afterEach(async () => {
    // Cleanup resources
  });

  describe('Specific Functionality', () => {
    it('should behave correctly when condition is met', async () => {
      // Arrange
      const testData = setupTestData();
      
      // Act
      const result = await performAction(testData);
      
      // Assert
      expect(result).toBe(expectedValue);
    });
  });
});
```

### Best Practices

1. **Isolation**: Each test should be independent
2. **Deterministic**: Tests should produce consistent results
3. **Fast**: Avoid unnecessary delays or timeouts
4. **Clear**: Use descriptive names and comments
5. **Comprehensive**: Cover happy path, edge cases, and errors

### Testing Async Operations
```typescript
// Good: Proper async/await
it('should handle async operations', async () => {
  const result = await asyncFunction();
  expect(result).toBeDefined();
});

// Good: Test timing-sensitive operations
it('should timeout appropriately', async () => {
  const start = Date.now();
  await expect(slowOperation({ timeout: 100 }))
    .rejects.toThrow('timeout');
  const elapsed = Date.now() - start;
  expect(elapsed).toBeLessThan(200); // Some buffer
});
```

## 🔗 Dependencies

The test suite depends on all main packages:

- **[@app/node](../node/)** - Node.js database and transport implementations
- **[@app/db](../db/)** - Database interfaces and CRSqlite integration  
- **[@app/sync](../sync/)** - Peer synchronization functionality
- **[@app/browser](../browser/)** - Browser-specific implementations
- **[vitest](https://www.npmjs.com/package/vitest)** - Fast and modern test runner

## 🤝 Contributing

### Running Specific Tests
```bash
# Run specific test file
npx vitest src/sandbox.test.ts

# Run tests matching pattern
npx vitest --grep "synchronization"

# Run tests in specific directory
npx vitest src/
```

### Adding Platform-Specific Tests
- **Node.js only**: Use `exec-many-args-node.test.ts` as template
- **Browser only**: Use `exec-many-args-browser.test.ts` as template
- **Cross-platform**: Use standard test structure

### Performance Testing
```typescript
it('should complete bulk operations within time limit', async () => {
  const start = Date.now();
  const largeDataset = generateTestData(10000);
  
  await bulkInsert(largeDataset);
  
  const duration = Date.now() - start;
  expect(duration).toBeLessThan(5000); // 5 second limit
});
```

## 📄 License

Part of the Keep.AI project - see root LICENSE file for details.