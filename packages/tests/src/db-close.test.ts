import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DBInterface } from "@app/db";
import { createDBNode } from "@app/node";

describe("Database Close Test - Isolate SQLITE_BUSY Issue", () => {
  let db: DBInterface;

  beforeEach(async () => {
    // Create in-memory database using Node.js implementation
    console.log("Creating in-memory database");
    db = await createDBNode(":memory:");
    console.log("Database created successfully");
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

  it("should open and close database without any SQL operations", async () => {
    // Do absolutely nothing - just open and close
    console.log("Database opened, no operations performed");
    expect(db).toBeDefined();
  });
});