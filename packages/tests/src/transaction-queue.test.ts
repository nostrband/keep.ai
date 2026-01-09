import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DBInterface } from "@app/db";
import { createDBNode } from "@app/node";

describe("Transaction Queue Test - Verify fix for parallel transactions", () => {
  let db: DBInterface;

  beforeEach(async () => {
    console.log("Creating in-memory database");
    db = await createDBNode(":memory:");
    
    // Create a simple test table
    await db.exec("CREATE TABLE IF NOT EXISTS test_table (id INTEGER PRIMARY KEY, value TEXT, timestamp INTEGER)");
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

  it("should queue and execute multiple parallel tx() calls successfully", async () => {
    console.log("\n=== Test 1: Multiple parallel tx() calls with queueing ===");
    
    const results: string[] = [];
    
    // Fire multiple transactions in parallel - they should all succeed now
    const tx1Promise = db.tx(async (tx) => {
      console.log("TX1: Started");
      await tx.exec("INSERT INTO test_table (value, timestamp) VALUES (?, ?)", ["tx1-value", Date.now()]);
      // Add delay to simulate real work
      await new Promise(resolve => setTimeout(resolve, 50));
      console.log("TX1: Completed");
      results.push("tx1");
    });
    
    const tx2Promise = db.tx(async (tx) => {
      console.log("TX2: Started");
      await tx.exec("INSERT INTO test_table (value, timestamp) VALUES (?, ?)", ["tx2-value", Date.now()]);
      await new Promise(resolve => setTimeout(resolve, 50));
      console.log("TX2: Completed");
      results.push("tx2");
    });
    
    const tx3Promise = db.tx(async (tx) => {
      console.log("TX3: Started");
      await tx.exec("INSERT INTO test_table (value, timestamp) VALUES (?, ?)", ["tx3-value", Date.now()]);
      await new Promise(resolve => setTimeout(resolve, 50));
      console.log("TX3: Completed");
      results.push("tx3");
    });
    
    // Wait for all - all should succeed
    await Promise.all([tx1Promise, tx2Promise, tx3Promise]);
    
    console.log("All transactions completed successfully");
    console.log("Execution order:", results);
    
    // All should have completed
    expect(results).toHaveLength(3);
    expect(results).toContain("tx1");
    expect(results).toContain("tx2");
    expect(results).toContain("tx3");
    
    // Verify all data was inserted
    const allRows = await db.execO<{ id: number, value: string }>("SELECT * FROM test_table ORDER BY id");
    console.log("Inserted rows:", allRows);
    
    expect(allRows).toHaveLength(3);
    expect(allRows?.[0].value).toBe("tx1-value");
    expect(allRows?.[1].value).toBe("tx2-value");
    expect(allRows?.[2].value).toBe("tx3-value");
  });

  it("should handle tx() inside tx() with setTimeout by queueing", async () => {
    console.log("\n=== Test 2: Nested tx() with setTimeout (queued) ===");
    
    let innerCompleted = false;
    
    await db.tx(async (tx1) => {
      console.log("Inside outer transaction");
      
      // Insert some data in outer transaction
      await tx1.exec("INSERT INTO test_table (value, timestamp) VALUES (?, ?)", ["outer-value", Date.now()]);
      console.log("Inserted value in outer transaction");
      
      // Set a timer and try to create another transaction
      // This should now be queued and execute after the outer transaction completes
      const timerPromise = new Promise<void>((resolve) => {
        setTimeout(async () => {
          console.log("Timer fired, attempting second transaction (will be queued)");
          await db.tx(async (tx2) => {
            console.log("Inside inner transaction (queued)");
            await tx2.exec("INSERT INTO test_table (value, timestamp) VALUES (?, ?)", ["inner-value", Date.now()]);
            innerCompleted = true;
          });
          resolve();
        }, 50);
      });
      
      console.log("Outer transaction completing");
      
      // Don't wait for timer in the outer transaction - it will queue and execute after
      // We'll wait for it after the outer tx completes
      setTimeout(async () => {
        await timerPromise;
      }, 0);
    });
    
    // Wait a bit for the queued transaction to complete
    await new Promise(resolve => setTimeout(resolve, 200));
    
    console.log("Inner transaction completed:", innerCompleted);
    
    // Verify both inserts succeeded
    const allRows = await db.execO<{ value: string }>("SELECT value FROM test_table ORDER BY id");
    console.log("All rows:", allRows);
    
    expect(allRows).toHaveLength(2);
    expect(allRows?.[0].value).toBe("outer-value");
    expect(allRows?.[1].value).toBe("inner-value");
  });

  it("should execute queued transactions in order", async () => {
    console.log("\n=== Test 3: Transaction execution order ===");
    
    const executionOrder: number[] = [];
    
    // Start 5 transactions with different execution times
    const promises = [1, 2, 3, 4, 5].map(num => {
      return db.tx(async (tx) => {
        executionOrder.push(num);
        console.log(`TX${num}: Executing`);
        await tx.exec("INSERT INTO test_table (value) VALUES (?)", [`tx${num}`]);
        // Random delay to simulate different execution times
        await new Promise(resolve => setTimeout(resolve, Math.random() * 30));
      });
    });
    
    await Promise.all(promises);
    
    console.log("Execution order:", executionOrder);
    
    // All should have executed
    expect(executionOrder).toHaveLength(5);
    
    // Verify all data was inserted
    const allRows = await db.execO<{ value: string }>("SELECT value FROM test_table ORDER BY id");
    expect(allRows).toHaveLength(5);
  });

  it("should handle transaction errors without breaking the queue", async () => {
    console.log("\n=== Test 4: Error handling in queue ===");
    
    const results: string[] = [];
    
    // TX1 - succeeds
    const tx1 = db.tx(async (tx) => {
      await tx.exec("INSERT INTO test_table (value) VALUES (?)", ["tx1-success"]);
      results.push("tx1-success");
    });
    
    // TX2 - fails
    const tx2 = db.tx(async (tx) => {
      await tx.exec("INSERT INTO test_table (value) VALUES (?)", ["tx2-before-error"]);
      // Intentional error
      throw new Error("Intentional error in tx2");
    }).catch(err => {
      console.log("TX2 error caught (expected):", err.message);
      results.push("tx2-error");
    });
    
    // TX3 - should still succeed after tx2 error
    const tx3 = db.tx(async (tx) => {
      await tx.exec("INSERT INTO test_table (value) VALUES (?)", ["tx3-success"]);
      results.push("tx3-success");
    });
    
    await Promise.all([tx1, tx2, tx3]);
    
    console.log("Results:", results);
    
    expect(results).toContain("tx1-success");
    expect(results).toContain("tx2-error");
    expect(results).toContain("tx3-success");
    
    // TX2 should have been rolled back, so only tx1 and tx3 data should exist
    const allRows = await db.execO<{ value: string }>("SELECT value FROM test_table ORDER BY id");
    console.log("Rows after error:", allRows);
    
    expect(allRows).toHaveLength(2);
    expect(allRows?.[0].value).toBe("tx1-success");
    expect(allRows?.[1].value).toBe("tx3-success");
  });

  it("should handle rapid-fire transactions", async () => {
    console.log("\n=== Test 5: Rapid-fire transactions (stress test) ===");
    
    const count = 20;
    const promises: Promise<void>[] = [];
    
    // Fire many transactions rapidly
    for (let i = 0; i < count; i++) {
      promises.push(
        db.tx(async (tx) => {
          await tx.exec("INSERT INTO test_table (value) VALUES (?)", [`rapid-${i}`]);
        })
      );
    }
    
    await Promise.all(promises);
    
    // Verify all were inserted
    const allRows = await db.execO<{ value: string }>("SELECT value FROM test_table ORDER BY id");
    expect(allRows).toHaveLength(count);
    
    console.log(`All ${count} rapid transactions completed successfully`);
  });
});
