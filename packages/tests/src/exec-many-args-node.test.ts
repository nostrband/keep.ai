import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DBInterface } from "@app/db";
import { createDBNode } from "@app/node";

describe("execManyArgs Node.js Tests", () => {
  let db: DBInterface;

  beforeEach(async () => {
    // Create in-memory database using Node.js implementation
    db = await createDBNode(":memory:");
  });

  afterEach(async () => {
    if (db) {
      await db.close();
    }
  });

  describe("Bulk Insert Operations", () => {
    it("should perform bulk inserts with execManyArgs", async () => {
      // Create test table
      await db.exec(`
        CREATE TABLE users (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          email TEXT NOT NULL,
          age INTEGER
        )
      `);

      // Prepare bulk insert data
      const insertArgs = [
        ["Alice", "alice@example.com", 25],
        ["Bob", "bob@example.com", 30],
        ["Charlie", "charlie@example.com", 35],
        ["David", "david@example.com", 28],
        ["Eve", "eve@example.com", 22]
      ];

      // Execute bulk insert
      const results = await db.execManyArgs(
        "INSERT INTO users (name, email, age) VALUES (?, ?, ?)",
        insertArgs
      );

      // Verify results structure
      expect(results).toBeDefined();
      expect(results).toHaveLength(5);
      
      // Each result should have lastID and changes
      results.forEach((result, index) => {
        expect(result).toHaveProperty("lastID");
        expect(result).toHaveProperty("changes");
        expect(result.changes).toBe(1); // Each insert should affect 1 row
        expect(result.lastID).toBe(index + 1); // Auto-incrementing IDs
      });

      // Verify data was inserted correctly
      const allUsers = await db.execO("SELECT * FROM users ORDER BY id");
      expect(allUsers).toHaveLength(5);
      expect(allUsers![0]).toMatchObject({
        id: 1,
        name: "Alice",
        email: "alice@example.com",
        age: 25
      });
    });

    it("should handle empty args array", async () => {
      await db.exec(`
        CREATE TABLE test_table (
          id INTEGER PRIMARY KEY,
          value TEXT
        )
      `);

      const results = await db.execManyArgs(
        "INSERT INTO test_table (value) VALUES (?)",
        []
      );

      expect(results).toBeDefined();
      expect(results).toHaveLength(0);
    });

    it("should handle null/undefined args", async () => {
      await db.exec(`
        CREATE TABLE test_table (
          id INTEGER PRIMARY KEY,
          value TEXT
        )
      `);

      const results1 = await db.execManyArgs(
        "INSERT INTO test_table (value) VALUES (?)",
        undefined
      );
      expect(results1).toHaveLength(0);

      const results2 = await db.execManyArgs(
        "INSERT INTO test_table (value) VALUES (?)",
        null as any
      );
      expect(results2).toHaveLength(0);
    });
  });

  describe("Bulk Update Operations", () => {
    beforeEach(async () => {
      // Setup test data for updates
      await db.exec(`
        CREATE TABLE products (
          id INTEGER PRIMARY KEY,
          name TEXT NOT NULL,
          price DECIMAL(10,2),
          category TEXT
        )
      `);

      // Insert test data
      await db.execManyArgs(
        "INSERT INTO products (id, name, price, category) VALUES (?, ?, ?, ?)",
        [
          [1, "Laptop", 999.99, "Electronics"],
          [2, "Mouse", 29.99, "Electronics"], 
          [3, "Chair", 199.99, "Furniture"],
          [4, "Desk", 399.99, "Furniture"],
          [5, "Keyboard", 79.99, "Electronics"]
        ]
      );
    });

    it("should perform bulk updates with execManyArgs", async () => {
      // Bulk price updates
      const updateArgs = [
        [1099.99, 1], // Update laptop price
        [24.99, 2],   // Update mouse price  
        [189.99, 3],  // Update chair price
        [449.99, 4]   // Update desk price
      ];

      const results = await db.execManyArgs(
        "UPDATE products SET price = ? WHERE id = ?",
        updateArgs
      );

      // Verify results
      expect(results).toHaveLength(4);
      results.forEach(result => {
        expect(result.changes).toBe(1); // Each update should affect 1 row
      });

      // Verify updates applied correctly
      const laptop = await db.execO("SELECT price FROM products WHERE id = 1");
      expect(laptop![0].price).toBe(1099.99);

      const mouse = await db.execO("SELECT price FROM products WHERE id = 2");  
      expect(mouse![0].price).toBe(24.99);
    });

    it("should handle updates that affect zero rows", async () => {
      const updateArgs = [
        [999.99, 999], // Non-existent product ID
        [888.88, 998]  // Another non-existent ID
      ];

      const results = await db.execManyArgs(
        "UPDATE products SET price = ? WHERE id = ?",
        updateArgs
      );

      expect(results).toHaveLength(2);
      results.forEach(result => {
        expect(result.changes).toBe(0); // No rows should be affected
      });
    });
  });

  describe("Bulk Delete Operations", () => {
    beforeEach(async () => {
      // Setup test data for deletions
      await db.exec(`
        CREATE TABLE orders (
          id INTEGER PRIMARY KEY,
          customer_id INTEGER,
          status TEXT,
          created_date TEXT
        )
      `);

      // Insert test orders
      await db.execManyArgs(
        "INSERT INTO orders (id, customer_id, status, created_date) VALUES (?, ?, ?, ?)",
        [
          [1, 101, "pending", "2024-01-01"],
          [2, 102, "completed", "2024-01-02"],
          [3, 103, "cancelled", "2024-01-03"],
          [4, 101, "pending", "2024-01-04"],
          [5, 104, "completed", "2024-01-05"],
          [6, 102, "cancelled", "2024-01-06"]
        ]
      );
    });

    it("should perform bulk deletes with execManyArgs", async () => {
      // Delete specific orders by ID
      const deleteArgs = [
        [1], // Delete order 1
        [3], // Delete order 3  
        [5]  // Delete order 5
      ];

      const results = await db.execManyArgs(
        "DELETE FROM orders WHERE id = ?",
        deleteArgs
      );

      // Verify results
      expect(results).toHaveLength(3);
      results.forEach(result => {
        expect(result.changes).toBe(1); // Each delete should affect 1 row
      });

      // Verify deletions
      const remainingOrders = await db.execO("SELECT id FROM orders ORDER BY id");
      expect(remainingOrders).toHaveLength(3);
      expect(remainingOrders!.map(o => o.id)).toEqual([2, 4, 6]);
    });

    it("should handle conditional bulk deletes", async () => {
      // Delete cancelled orders one by one using WHERE with specific IDs
      const cancelledOrderIds = await db.execO("SELECT id FROM orders WHERE status = 'cancelled'");
      const deleteArgs = cancelledOrderIds!.map(order => [order.id]);

      const results = await db.execManyArgs(
        "DELETE FROM orders WHERE id = ?",
        deleteArgs
      );

      // All deletes should succeed
      expect(results).toHaveLength(cancelledOrderIds!.length);
      results.forEach(result => {
        expect(result.changes).toBe(1); // Each delete should affect 1 row
      });
      
      // Verify cancelled orders are gone
      const remainingCancelledOrders = await db.execO("SELECT * FROM orders WHERE status = 'cancelled'");
      expect(remainingCancelledOrders).toBeNull();
    });
  });

  describe("Mixed Operations and Transactions", () => {
    it("should work within transactions", async () => {
      await db.exec(`
        CREATE TABLE account_transactions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          account_id INTEGER,
          amount DECIMAL(10,2),
          type TEXT
        )
      `);

      await db.tx(async (tx) => {
        // Bulk insert transaction records
        const transactionArgs = [
          [1, 100.00, "credit"],
          [1, -25.00, "debit"],
          [2, 200.00, "credit"],
          [2, -50.00, "debit"]
        ];

        const results = await tx.execManyArgs(
          "INSERT INTO account_transactions (account_id, amount, type) VALUES (?, ?, ?)",
          transactionArgs
        );

        expect(results).toHaveLength(4);
        results.forEach(result => {
          expect(result.changes).toBe(1);
          expect(result.lastID).toBeGreaterThan(0);
        });
      });

      // Verify transaction was committed
      const allTransactions = await db.execO("SELECT * FROM account_transactions");
      expect(allTransactions).toHaveLength(4);
    });

    it("should rollback on transaction failure", async () => {
      await db.exec(`
        CREATE TABLE test_rollback (
          id INTEGER PRIMARY KEY,
          value TEXT NOT NULL
        )
      `);

      try {
        await db.tx(async (tx) => {
          // First batch should succeed
          await tx.execManyArgs(
            "INSERT INTO test_rollback (id, value) VALUES (?, ?)",
            [[1, "valid"], [2, "valid"]]
          );

          // This should cause a constraint violation (duplicate primary key)
          await tx.execManyArgs(
            "INSERT INTO test_rollback (id, value) VALUES (?, ?)",
            [[1, "duplicate"], [3, "valid"]]
          );
        });
      } catch (error) {
        // Expected to fail
        expect(error).toBeDefined();
      }

      // Verify rollback - no data should be present
      const data = await db.execO("SELECT * FROM test_rollback");
      expect(data).toBeNull();
    });
  });
  describe("Transaction Tests - Comprehensive execManyArgs", () => {
    beforeEach(async () => {
      // Create test tables for transaction scenarios
      await db.exec(`
        CREATE TABLE transaction_test (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          batch_id INTEGER,
          value TEXT,
          amount DECIMAL(10,2)
        )
      `);
      
      await db.exec(`
        CREATE TABLE audit_log (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          operation TEXT,
          table_name TEXT,
          record_count INTEGER,
          timestamp TEXT
        )
      `);
    });

    it("should handle single execManyArgs call in transaction with commit", async () => {
      const testData = [
        [1, "test1", 100.50],
        [1, "test2", 200.75],
        [1, "test3", 300.25]
      ];

      let txResults;
      await db.tx(async (tx) => {
        txResults = await tx.execManyArgs(
          "INSERT INTO transaction_test (batch_id, value, amount) VALUES (?, ?, ?)",
          testData
        );

        // Verify results within transaction
        expect(txResults).toHaveLength(3);
        txResults.forEach(result => {
          expect(result.changes).toBe(1);
          expect(result.lastID).toBeGreaterThan(0);
        });

        // Verify data is visible within transaction
        const countInTx = await tx.execO("SELECT COUNT(*) as count FROM transaction_test");
        expect(countInTx![0].count).toBe(3);
      });

      // Verify data persisted after commit
      const allData = await db.execO("SELECT * FROM transaction_test ORDER BY id");
      expect(allData).toHaveLength(3);
      expect(allData![0].value).toBe("test1");
      expect(allData![1].value).toBe("test2");
      expect(allData![2].value).toBe("test3");
    });

    it("should handle multiple execManyArgs calls in same transaction", async () => {
      await db.tx(async (tx) => {
        // First batch of inserts
        const batch1Results = await tx.execManyArgs(
          "INSERT INTO transaction_test (batch_id, value, amount) VALUES (?, ?, ?)",
          [
            [1, "batch1_item1", 10.00],
            [1, "batch1_item2", 20.00]
          ]
        );

        // Second batch of inserts
        const batch2Results = await tx.execManyArgs(
          "INSERT INTO transaction_test (batch_id, value, amount) VALUES (?, ?, ?)",
          [
            [2, "batch2_item1", 30.00],
            [2, "batch2_item2", 40.00],
            [2, "batch2_item3", 50.00]
          ]
        );

        // Log operations
        const auditResults = await tx.execManyArgs(
          "INSERT INTO audit_log (operation, table_name, record_count, timestamp) VALUES (?, ?, ?, ?)",
          [
            ["INSERT", "transaction_test", 2, new Date().toISOString()],
            ["INSERT", "transaction_test", 3, new Date().toISOString()]
          ]
        );

        // Verify all operations succeeded
        expect(batch1Results).toHaveLength(2);
        expect(batch2Results).toHaveLength(3);
        expect(auditResults).toHaveLength(2);

        // Verify data is consistent within transaction
        const totalCount = await tx.execO("SELECT COUNT(*) as count FROM transaction_test");
        expect(totalCount![0].count).toBe(5);

        const batch1Count = await tx.execO("SELECT COUNT(*) as count FROM transaction_test WHERE batch_id = 1");
        expect(batch1Count![0].count).toBe(2);

        const batch2Count = await tx.execO("SELECT COUNT(*) as count FROM transaction_test WHERE batch_id = 2");
        expect(batch2Count![0].count).toBe(3);
      });

      // Verify all data committed
      const finalData = await db.execO("SELECT * FROM transaction_test ORDER BY batch_id, id");
      expect(finalData).toHaveLength(5);
      
      const auditData = await db.execO("SELECT * FROM audit_log");
      expect(auditData).toHaveLength(2);
    });

    it("should rollback all execManyArgs calls on transaction failure", async () => {
      try {
        await db.tx(async (tx) => {
          // First successful batch
          await tx.execManyArgs(
            "INSERT INTO transaction_test (batch_id, value, amount) VALUES (?, ?, ?)",
            [
              [1, "should_rollback1", 100.00],
              [1, "should_rollback2", 200.00]
            ]
          );

          // Second successful batch  
          await tx.execManyArgs(
            "INSERT INTO transaction_test (batch_id, value, amount) VALUES (?, ?, ?)",
            [
              [2, "should_rollback3", 300.00],
              [2, "should_rollback4", 400.00]
            ]
          );

          // This should fail - duplicate primary key
          await tx.execManyArgs(
            "INSERT INTO transaction_test (id, batch_id, value, amount) VALUES (?, ?, ?, ?)",
            [
              [1, 3, "duplicate1", 500.00], // Will conflict with auto-increment
              [2, 3, "duplicate2", 600.00]  // Will conflict with auto-increment
            ]
          );
        });
      } catch (error) {
        // Expected to fail due to primary key constraint
        expect(error).toBeDefined();
      }

      // Verify complete rollback - no data should persist
      const remainingData = await db.execO("SELECT * FROM transaction_test");
      expect(remainingData).toBeNull();
    });

    it("should handle mixed operations in transaction with rollback", async () => {
      // Insert some initial data
      await db.execManyArgs(
        "INSERT INTO transaction_test (batch_id, value, amount) VALUES (?, ?, ?)",
        [
          [0, "initial1", 10.00],
          [0, "initial2", 20.00]
        ]
      );

      // Verify initial data exists
      const initialCount = await db.execO("SELECT COUNT(*) as count FROM transaction_test");
      expect(initialCount![0].count).toBe(2);

      try {
        await db.tx(async (tx) => {
          // Insert new data
          await tx.execManyArgs(
            "INSERT INTO transaction_test (batch_id, value, amount) VALUES (?, ?, ?)",
            [
              [1, "new1", 100.00],
              [1, "new2", 200.00]
            ]
          );

          // Update existing data
          await tx.execManyArgs(
            "UPDATE transaction_test SET amount = ? WHERE batch_id = ? AND value = ?",
            [
              [15.00, 0, "initial1"],
              [25.00, 0, "initial2"]
            ]
          );

          // Delete some data
          await tx.execManyArgs(
            "DELETE FROM transaction_test WHERE batch_id = ? AND value = ?", 
            [[1, "new1"]]
          );

          // This should cause the transaction to fail
          throw new Error("Simulated transaction failure");
        });
      } catch (error) {
        expect((error as Error).message).toBe("Simulated transaction failure");
      }

      // Verify rollback - original data should be unchanged
      const finalData = await db.execO("SELECT * FROM transaction_test ORDER BY id");
      expect(finalData).toHaveLength(2);
      expect(finalData![0].amount).toBe(10.00); // Should not be 15.00
      expect(finalData![1].amount).toBe(20.00); // Should not be 25.00
    });

    it("should properly isolate nested transaction calls", async () => {
      await db.tx(async (tx) => {
        // First level operations
        await tx.execManyArgs(
          "INSERT INTO transaction_test (batch_id, value, amount) VALUES (?, ?, ?)",
          [
            [1, "level1_item1", 100.00],
            [1, "level1_item2", 200.00]
          ]
        );

        // Verify intermediate state
        const midCount = await tx.execO("SELECT COUNT(*) as count FROM transaction_test");
        expect(midCount![0].count).toBe(2);
        
        // Additional operations in same transaction
        await tx.execManyArgs(
          "INSERT INTO audit_log (operation, table_name, record_count, timestamp) VALUES (?, ?, ?, ?)",
          [
            ["INSERT", "transaction_test", 2, new Date().toISOString()]
          ]
        );

        // Update operations
        await tx.execManyArgs(
          "UPDATE transaction_test SET amount = amount * ? WHERE batch_id = ?",
          [
            [1.1, 1] // 10% increase
          ]
        );
      });

      // Verify final committed state
      const finalData = await db.execO("SELECT * FROM transaction_test ORDER BY id");
      expect(finalData).toHaveLength(2);
      expect(Math.abs(finalData![0].amount - 110.00)).toBeLessThan(0.01); // 100 * 1.1
      expect(Math.abs(finalData![1].amount - 220.00)).toBeLessThan(0.01); // 200 * 1.1

      const auditData = await db.execO("SELECT * FROM audit_log");
      expect(auditData).toHaveLength(1);
    });

    it("should handle complex multi-table operations in transaction", async () => {
      await db.exec(`
        CREATE TABLE orders_tx (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          customer_id INTEGER,
          total_amount DECIMAL(10,2)
        )
      `);
      
      await db.exec(`
        CREATE TABLE order_items_tx (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          order_id INTEGER,
          product_name TEXT,
          quantity INTEGER,
          price DECIMAL(10,2)
        )
      `);

      let orderIds;
      await db.tx(async (tx) => {
        // Insert multiple orders
        const orderResults = await tx.execManyArgs(
          "INSERT INTO orders_tx (customer_id, total_amount) VALUES (?, ?)",
          [
            [101, 0.00], // Total will be calculated later
            [102, 0.00]
          ]
        );
        
        orderIds = orderResults.map(r => r.lastID);
        expect(orderIds).toHaveLength(2);

        // Insert order items for first order
        await tx.execManyArgs(
          "INSERT INTO order_items_tx (order_id, product_name, quantity, price) VALUES (?, ?, ?, ?)",
          [
            [orderIds[0], "Laptop", 1, 999.99],
            [orderIds[0], "Mouse", 2, 29.99]
          ]
        );

        // Insert order items for second order
        await tx.execManyArgs(
          "INSERT INTO order_items_tx (order_id, product_name, quantity, price) VALUES (?, ?, ?, ?)",
          [
            [orderIds[1], "Chair", 1, 199.99],
            [orderIds[1], "Desk", 1, 399.99]
          ]
        );

        // Update order totals
        await tx.execManyArgs(
          "UPDATE orders_tx SET total_amount = (SELECT SUM(quantity * price) FROM order_items_tx WHERE order_id = ?) WHERE id = ?",
          [
            [orderIds[0], orderIds[0]],
            [orderIds[1], orderIds[1]]
          ]
        );
      });

      // Verify complex transaction committed properly
      const orders = await db.execO("SELECT * FROM orders_tx ORDER BY id");
      expect(orders).toHaveLength(2);
      expect(orders![0].total_amount).toBe(1059.97); // 999.99 + 2*29.99
      expect(orders![1].total_amount).toBe(599.98);  // 199.99 + 399.99

      const items = await db.execO("SELECT * FROM order_items_tx ORDER BY order_id, id");
      expect(items).toHaveLength(4);
    });
  });


  describe("Error Handling", () => {
    it("should handle SQL syntax errors", async () => {
      await db.exec(`
        CREATE TABLE error_test (
          id INTEGER PRIMARY KEY,
          name TEXT
        )
      `);

      await expect(
        db.execManyArgs("INVALID SQL SYNTAX", [["test"]])
      ).rejects.toThrow();
    });

    it("should handle constraint violations", async () => {
      await db.exec(`
        CREATE TABLE unique_test (
          id INTEGER PRIMARY KEY,
          email TEXT UNIQUE NOT NULL
        )
      `);

      // First insert should succeed
      const args1 = [["test@example.com"]];
      await db.execManyArgs("INSERT INTO unique_test (email) VALUES (?)", args1);

      // Second insert with same email should fail
      const args2 = [["test@example.com"]];
      await expect(
        db.execManyArgs("INSERT INTO unique_test (email) VALUES (?)", args2)
      ).rejects.toThrow();
    });

    it("should handle mismatched parameter counts", async () => {
      await db.exec(`
        CREATE TABLE param_test (
          id INTEGER PRIMARY KEY,
          name TEXT,
          email TEXT
        )
      `);

      // Too few parameters - SQLite treats missing params as NULL
      const results1 = await db.execManyArgs(
        "INSERT INTO param_test (name, email) VALUES (?, ?)",
        [["Alice"]] // Missing email parameter becomes NULL
      );
      expect(results1).toHaveLength(1);
      expect(results1[0].changes).toBe(1);

      // Verify NULL email was inserted
      const insertedRow = await db.execO("SELECT name, email FROM param_test WHERE name = 'Alice'");
      expect(insertedRow![0].name).toBe("Alice");
      expect(insertedRow![0].email).toBeNull();

      // Too many parameters should cause an error
      await expect(
        db.execManyArgs(
          "INSERT INTO param_test (name) VALUES (?)",
          [["Bob", "extra", "params"]]
        )
      ).rejects.toThrow();
    });
  });
});