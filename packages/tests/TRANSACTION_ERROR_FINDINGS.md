# SQLITE Transaction Error Investigation

## Error Message
```
SQLITE_ERROR: cannot start a transaction within a transaction
errno: 1, code: 'SQLITE_ERROR'
```

## Test Results Summary

All 6 tests passed (meaning they successfully reproduced the expected errors). Here are the scenarios that trigger the error:

### ✅ Test 1: Nested tx() with setTimeout (REPRODUCED)
**Scenario:** Start a transaction, then inside it use `setTimeout` to attempt starting another transaction in parallel.

**Result:** Second transaction fails with the error.

**Code Pattern:**
```typescript
await db.tx(async (tx1) => {
  setTimeout(async () => {
    await db.tx(async (tx2) => { // FAILS HERE
      // ...
    });
  }, 100);
});
```

**Finding:** The error occurs when an async callback (like setTimeout) tries to start a new transaction while the outer transaction is still active.

---

### ✅ Test 2: Two consecutive BEGIN TRANSACTION (REPRODUCED)
**Scenario:** Execute `BEGIN TRANSACTION` SQL twice in a row, awaiting each.

**Result:** Second BEGIN fails with the error.

**Code Pattern:**
```typescript
await db.exec("BEGIN TRANSACTION");  // OK
await db.exec("BEGIN TRANSACTION");  // FAILS HERE
```

**Finding:** SQLite does not support nested transactions using BEGIN TRANSACTION.

---

### ✅ Test 3: Parallel SELECT statements (NO ERROR - WORKS FINE)
**Scenario:** Fire two SELECT queries in parallel without awaiting them first.

**Result:** Both succeed without errors.

**Code Pattern:**
```typescript
const promise1 = db.execO("SELECT ...");
const promise2 = db.execO("SELECT ...");
const [result1, result2] = await Promise.all([promise1, promise2]);
```

**Finding:** Parallel reads are safe and don't cause transaction conflicts.

---

### ✅ Test 4: Synchronous nested tx() (REPRODUCED)
**Scenario:** Call `db.tx()` inside another `db.tx()` callback synchronously.

**Result:** Inner transaction fails with the error.

**Code Pattern:**
```typescript
await db.tx(async (tx1) => {
  await db.tx(async (tx2) => {  // FAILS HERE
    // ...
  });
});
```

**Finding:** Cannot nest transactions synchronously.

---

### ✅ Test 5: Multiple parallel tx() calls (REPRODUCED)
**Scenario:** Start 3 transactions in parallel using Promise.allSettled.

**Result:** 
- TX1: Succeeded
- TX2: Failed with transaction error
- TX3: Failed with transaction error

**Code Pattern:**
```typescript
const tx1Promise = db.tx(async (tx) => { /* ... */ });
const tx2Promise = db.tx(async (tx) => { /* ... */ });
const tx3Promise = db.tx(async (tx) => { /* ... */ });
await Promise.allSettled([tx1Promise, tx2Promise, tx3Promise]);
```

**Finding:** Only one transaction can be active at a time. Parallel transactions fail.

---

### ✅ Test 6: Manual BEGIN inside tx() (REPRODUCED)
**Scenario:** Call `BEGIN TRANSACTION` manually inside a `tx()` callback.

**Result:** Manual BEGIN fails because tx() already started a transaction.

**Code Pattern:**
```typescript
await db.tx(async (tx) => {
  await tx.exec("BEGIN TRANSACTION");  // FAILS HERE (tx already began)
});
```

**Finding:** The `tx()` method already executes BEGIN TRANSACTION, so manual BEGIN fails.

---

## Root Cause Analysis

The [`tx()`](../node/src/createDB.ts:88) function in `createDB.ts` does:
1. Executes `BEGIN TRANSACTION`
2. Runs the user callback
3. Executes `COMMIT` or `ROLLBACK`

**The problem:** SQLite only supports one active transaction per database connection. The current implementation:
- Uses a single shared `sqlite3.Database` instance
- Does not track transaction state
- Does not prevent concurrent transaction attempts
- Does not queue transactions

## Scenarios Where This Error Occurs in Real Applications

1. **Async callbacks within transactions:**
   - setTimeout/setInterval inside a transaction
   - Event handlers triggered during a transaction
   - Promise callbacks that start new transactions

2. **Parallel operations:**
   - Multiple API endpoints trying to start transactions simultaneously
   - Race conditions in concurrent code paths

3. **Nested business logic:**
   - Function A starts transaction and calls Function B
   - Function B also tries to start a transaction

## Recommended Fixes

### Option 1: Transaction Queue (Recommended)
Implement a queue system to serialize all transactions:
```typescript
private txQueue: Promise<any> = Promise.resolve();

async tx<T>(fn: (tx: DBInterface) => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    this.txQueue = this.txQueue.then(async () => {
      try {
        const result = await this.executeTransaction(fn);
        resolve(result);
      } catch (error) {
        reject(error);
      }
    });
  });
}
```

### Option 2: Transaction State Tracking
Track if a transaction is active and throw a clear error:
```typescript
private inTransaction = false;

async tx<T>(fn: (tx: DBInterface) => Promise<T>): Promise<T> {
  if (this.inTransaction) {
    throw new Error("Cannot start nested transaction. Wait for current transaction to complete.");
  }
  this.inTransaction = true;
  try {
    // ... existing logic
  } finally {
    this.inTransaction = false;
  }
}
```

### Option 3: Use SAVEPOINT for Nested Transactions
SQLite supports savepoints which act like nested transactions:
```typescript
async tx<T>(fn: (tx: DBInterface) => Promise<T>): Promise<T> {
  if (this.inTransaction) {
    // Use savepoint for nested transaction
    return this.savepoint(fn);
  } else {
    // Use regular transaction
    // ... existing logic
  }
}
```

## Conclusion

The error occurs when:
1. A transaction is already active on the database connection
2. Code tries to start another transaction (via `tx()` or manual BEGIN)

**Most common real-world cause:** Async callbacks (setTimeout, promises) that call `tx()` while an outer transaction is still running.

**Best fix:** Implement a transaction queue (Option 1) to serialize all transactions automatically.
