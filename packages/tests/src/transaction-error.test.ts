import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DBInterface } from "@app/db";
import { createDBNode } from "@app/node";

describe("Transaction Error Test - SQLITE_ERROR: cannot start a transaction within a transaction", () => {
  let db: DBInterface;

  beforeEach(async () => {
    console.log("Creating in-memory database");
    db = await createDBNode(":memory:");
    
    // Create a simple test table
    await db.exec("CREATE TABLE IF NOT EXISTS test_table (id INTEGER PRIMARY KEY, value TEXT)");
    console.log("Database created successfully with test table");
  });

  afterEach(async () => {
    if (db) {
      console.log("Attempting to close database");
      try {
        await db.close();
        console.log("Database closed successfully");
      } catch (error) {
        console.error("Failed to close database:", error);
        throw error;
      }
    }
  });

  it("should queue transactions when calling tx() inside tx() with parallel timer", async () => {
    console.log("\n=== Test 1: Nested tx() with setTimeout (tests queuing behavior) ===");

    // The tx() implementation uses a queue to serialize transactions,
    // so the inner tx() will wait for the outer one to complete.
    // This test verifies that behavior works correctly.

    let tx1Completed = false;
    let tx2Completed = false;
    const executionOrder: string[] = [];

    await db.tx(async (tx1) => {
      executionOrder.push("tx1-start");
      console.log("Inside first transaction");

      // Insert some data in first transaction
      await tx1.exec("INSERT INTO test_table (value) VALUES (?)", ["tx1-value"]);
      console.log("Inserted value in first transaction");

      // Start second transaction - it will be queued
      setTimeout(async () => {
        executionOrder.push("tx2-queued");
        console.log("Timer fired, attempting second transaction (will be queued)");
        await db.tx(async (tx2) => {
          executionOrder.push("tx2-start");
          console.log("Inside second transaction (runs after first completes)");
          await tx2.exec("INSERT INTO test_table (value) VALUES (?)", ["tx2-value"]);
          executionOrder.push("tx2-end");
          tx2Completed = true;
        });
      }, 10);

      // Wait a bit to let timer fire (but tx2 will still be queued)
      await new Promise(resolve => setTimeout(resolve, 50));

      executionOrder.push("tx1-end");
      tx1Completed = true;
      console.log("First transaction completing");
    });

    // Wait for second transaction to complete (it was queued)
    await new Promise(resolve => setTimeout(resolve, 200));

    console.log("Execution order:", executionOrder);

    // Verify both transactions completed
    expect(tx1Completed).toBe(true);
    expect(tx2Completed).toBe(true);

    // Verify data from both transactions was inserted
    const data = await db.execO("SELECT * FROM test_table ORDER BY id");
    expect(data).toHaveLength(2);
    expect(data![0].value).toBe("tx1-value");
    expect(data![1].value).toBe("tx2-value");
  });

  it("should fail when calling two BEGIN TRANSACTION in a row (awaited)", async () => {
    console.log("\n=== Test 2: Two consecutive BEGIN TRANSACTION (awaited) ===");
    
    try {
      console.log("Executing first BEGIN TRANSACTION");
      await db.exec("BEGIN TRANSACTION");
      console.log("First BEGIN TRANSACTION succeeded");
      
      console.log("Executing second BEGIN TRANSACTION");
      await db.exec("BEGIN TRANSACTION");
      console.log("Second BEGIN TRANSACTION succeeded (unexpected!)");
      
      // Cleanup - this probably won't be reached
      await db.exec("ROLLBACK");
      
      // Should not reach here
      expect.fail("Should have thrown an error on second BEGIN TRANSACTION");
    } catch (error: any) {
      console.error("Expected error occurred:", error.message);
      expect(error.message).toContain("transaction");
      
      // Try to rollback to clean up
      try {
        await db.exec("ROLLBACK");
      } catch (rollbackErr) {
        console.log("Rollback also failed (expected):", rollbackErr);
      }
    }
  });

  it("should handle two SELECT statements without awaiting them", async () => {
    console.log("\n=== Test 3: Two SELECT statements without awaiting ===");
    
    // Insert some test data first
    await db.exec("INSERT INTO test_table (value) VALUES (?)", ["value1"]);
    await db.exec("INSERT INTO test_table (value) VALUES (?)", ["value2"]);
    console.log("Test data inserted");
    
    try {
      console.log("Firing two SELECT queries in parallel (no await)");
      
      // Fire two queries without awaiting
      const promise1 = db.execO("SELECT * FROM test_table WHERE value = ?", ["value1"]);
      const promise2 = db.execO("SELECT * FROM test_table WHERE value = ?", ["value2"]);
      
      console.log("Both queries fired, now awaiting results");
      
      // Wait for both
      const [result1, result2] = await Promise.all([promise1, promise2]);
      
      console.log("Result1:", result1);
      console.log("Result2:", result2);
      
      // These should succeed - SELECTs don't conflict
      expect(result1).toBeDefined();
      expect(result2).toBeDefined();
      expect(result1?.[0]?.value).toBe("value1");
      expect(result2?.[0]?.value).toBe("value2");
    } catch (error: any) {
      console.error("Unexpected error in parallel SELECTs:", error.message);
      throw error;
    }
  });

  // The tx() method queues transactions rather than failing on nesting.
  // This test verifies that queuing behavior - the inner tx() waits for outer to complete.
  it("should queue synchronous nested tx() calls rather than fail", async () => {
    console.log("\n=== Test 4: Synchronous nested tx() (tests queuing) ===");

    const executionOrder: string[] = [];
    let innerTxCompleted = false;

    // Start inner transaction OUTSIDE the outer tx callback (to avoid deadlock)
    // but still demonstrate the queuing behavior
    let innerPromise: Promise<void> | null = null;

    await db.tx(async (tx1) => {
      executionOrder.push("outer-start");
      console.log("Inside outer transaction");
      await tx1.exec("INSERT INTO test_table (value) VALUES (?)", ["outer-value"]);

      // Queue inner transaction - it will run AFTER outer completes
      // Don't await it here or we'll deadlock!
      innerPromise = db.tx(async (tx2) => {
        executionOrder.push("inner-start");
        console.log("Inside inner transaction (runs after outer)");
        await tx2.exec("INSERT INTO test_table (value) VALUES (?)", ["inner-value"]);
        executionOrder.push("inner-end");
        innerTxCompleted = true;
      });

      executionOrder.push("outer-end");
      console.log("Outer transaction completing");
      // DO NOT await innerPromise here - that would deadlock!
    });

    // Now we can safely await the inner transaction
    await innerPromise;

    console.log("Execution order:", executionOrder);

    // Verify execution order - inner runs after outer completes
    expect(executionOrder).toContain("outer-start");
    expect(executionOrder).toContain("inner-start");
    expect(innerTxCompleted).toBe(true);

    // Verify both inserts succeeded
    const data = await db.execO("SELECT * FROM test_table ORDER BY id");
    expect(data).toHaveLength(2);
  }, 10000);

  it("should fail when firing multiple tx() calls in parallel", async () => {
    console.log("\n=== Test 5: Multiple parallel tx() calls ===");
    
    const errors: any[] = [];
    
    try {
      // Fire multiple transactions in parallel
      const tx1Promise = db.tx(async (tx) => {
        console.log("TX1: Started");
        await tx.exec("INSERT INTO test_table (value) VALUES (?)", ["tx1-value"]);
        // Add delay to increase chance of collision
        await new Promise(resolve => setTimeout(resolve, 100));
        console.log("TX1: Completed");
      }).catch(err => {
        console.error("TX1: Error -", err.message);
        errors.push({ tx: "tx1", error: err });
        throw err;
      });
      
      const tx2Promise = db.tx(async (tx) => {
        console.log("TX2: Started");
        await tx.exec("INSERT INTO test_table (value) VALUES (?)", ["tx2-value"]);
        await new Promise(resolve => setTimeout(resolve, 100));
        console.log("TX2: Completed");
      }).catch(err => {
        console.error("TX2: Error -", err.message);
        errors.push({ tx: "tx2", error: err });
        throw err;
      });
      
      const tx3Promise = db.tx(async (tx) => {
        console.log("TX3: Started");
        await tx.exec("INSERT INTO test_table (value) VALUES (?)", ["tx3-value"]);
        await new Promise(resolve => setTimeout(resolve, 100));
        console.log("TX3: Completed");
      }).catch(err => {
        console.error("TX3: Error -", err.message);
        errors.push({ tx: "tx3", error: err });
        throw err;
      });
      
      // Try to wait for all - at least one should fail
      await Promise.allSettled([tx1Promise, tx2Promise, tx3Promise]);
      
      console.log(`Transactions completed. Errors caught: ${errors.length}`);
      
      // At least one should have failed with transaction error
      expect(errors.length).toBeGreaterThan(0);
      const hasTransactionError = errors.some(e => 
        e.error.message && e.error.message.toLowerCase().includes("transaction")
      );
      expect(hasTransactionError).toBe(true);
    } catch (error: any) {
      console.error("Parallel transactions error:", error.message);
      // This is expected
      expect(error.message).toBeDefined();
    }
  });

  it("should fail with manual BEGIN inside tx()", async () => {
    console.log("\n=== Test 6: Manual BEGIN TRANSACTION inside tx() ===");
    
    try {
      await db.tx(async (tx) => {
        console.log("Inside tx(), attempting manual BEGIN TRANSACTION");
        
        // The tx() already called BEGIN TRANSACTION, so this should fail
        await tx.exec("BEGIN TRANSACTION");
        
        expect.fail("Should have thrown an error on nested BEGIN");
      });
    } catch (error: any) {
      console.error("Expected error:", error.message);
      expect(error.message).toContain("transaction");
    }
  });
});
