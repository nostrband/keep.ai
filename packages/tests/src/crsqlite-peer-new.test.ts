import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DBInterface } from "@app/db";
import { createDBNode } from "@app/node";
import {
  Transport,
  TransportCallbacks,
  Cursor,
  PeerMessage,
  Peer,
} from "@app/worker";

// Custom transport that connects two peers directly
class DirectTransport implements Transport {
  private localPeerId: string = "";
  private callbacks: TransportCallbacks | null = null;
  private otherTransport: DirectTransport | null = null;
  private isConnected = false;

  constructor(private transportId: string) {}

  // Connect this transport to another transport
  connectTo(other: DirectTransport) {
    this.otherTransport = other;
    other.otherTransport = this;
  }

  async start(config: { localPeerId: string } & TransportCallbacks): Promise<void> {
    this.localPeerId = config.localPeerId;
    this.callbacks = config;
    
    // Simulate connection after a short delay
    setTimeout(async () => {
      if (this.otherTransport && this.otherTransport.callbacks && !this.isConnected) {
        this.isConnected = true;
        this.otherTransport.isConnected = true;
        
        // Notify both sides of connection
        await this.callbacks!.onConnect(this, this.otherTransport.localPeerId);
        await this.otherTransport.callbacks!.onConnect(this.otherTransport, this.localPeerId);
      }
    }, 10);
  }

  async sync(peerId: string, localCursor: Cursor): Promise<void> {
    if (!this.otherTransport || !this.otherTransport.callbacks) {
      console.warn(`Cannot sync with ${peerId} - not connected`);
      return;
    }

    if (peerId !== this.otherTransport.localPeerId) {
      console.warn(`Cannot sync with ${peerId} - unknown peer`);
      return;
    }

    // Forward sync request to the other peer
    setTimeout(async () => {
      await this.otherTransport!.callbacks!.onSync(this.otherTransport!, this.localPeerId, localCursor);
    }, 5);
  }

  async send(peerId: string, message: PeerMessage): Promise<void> {
    if (!this.otherTransport || !this.otherTransport.callbacks) {
      console.warn(`Cannot send to ${peerId} - not connected`);
      return;
    }

    if (peerId !== this.otherTransport.localPeerId) {
      console.warn(`Cannot send to ${peerId} - unknown peer`);
      return;
    }

    // Forward message to the other peer
    setTimeout(async () => {
      await this.otherTransport!.callbacks!.onReceive(this.otherTransport!, this.localPeerId, message);
    }, 5);
  }

  async disconnect(peerId: string): Promise<void> {
    if (!this.otherTransport || !this.otherTransport.callbacks) {
      return;
    }

    if (peerId !== this.otherTransport.localPeerId) {
      return;
    }

    // Notify disconnect
    setTimeout(async () => {
      await this.otherTransport!.callbacks!.onDisconnect(this.otherTransport!, this.localPeerId);
    }, 5);
  }
}

// Helper function to wait for async operations
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

describe("CRSqlitePeerNew Synchronization", () => {
  let db1: DBInterface;
  let db2: DBInterface;
  let peer1: Peer;
  let peer2: Peer;
  let transport1: DirectTransport;
  let transport2: DirectTransport;

  beforeEach(async () => {
    // Create two in-memory databases
    db1 = await createDBNode(":memory:");
    db2 = await createDBNode(":memory:");

    // Setup test tables on both databases
    await setupTestTables(db1);
    await setupTestTables(db2);

    // Create transports and connect them
    transport1 = new DirectTransport("transport1");
    transport2 = new DirectTransport("transport2");
    transport1.connectTo(transport2);

    // Create peers
    peer1 = new Peer(db1, [transport1]);
    peer2 = new Peer(db2, [transport2]);

    // Start peers
    await peer1.start();
    await peer2.start();

    // Wait for initial connection and sync
    await wait(100);
  });

  afterEach(async () => {
    await peer1.stop();
    await peer2.stop();
    await db1.close();
    await db2.close();
  });

  async function setupTestTables(db: DBInterface) {
    // Create test tables
    await db.exec(`
      CREATE TABLE IF NOT EXISTS notes (
        id TEXT PRIMARY KEY NOT NULL,
        title TEXT NOT NULL DEFAULT '',
        content TEXT,
        created_at INTEGER DEFAULT (strftime('%s', 'now')),
        updated_at INTEGER DEFAULT (strftime('%s', 'now'))
      )
    `);

    await db.exec(`
      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY NOT NULL,
        title TEXT NOT NULL DEFAULT '',
        completed INTEGER DEFAULT 0,
        priority INTEGER DEFAULT 1,
        created_at INTEGER DEFAULT (strftime('%s', 'now'))
      )
    `);

    // Register tables with CRSqlite
    await db.exec("SELECT crsql_as_crr('notes')");
    await db.exec("SELECT crsql_as_crr('tasks')");
  }

  async function getTableData(db: DBInterface, table: string): Promise<any[]> {
    const result = await db.execO(`SELECT * FROM ${table} ORDER BY id`);
    return result || [];
  }

  it("should synchronize data between two peers", async () => {
    // Insert data on peer1
    await db1.exec(
      "INSERT INTO notes (id, title, content) VALUES (?, ?, ?)",
      ["note1", "Peer1 Note", "Content from peer1"]
    );

    await db1.exec(
      "INSERT INTO tasks (id, title, completed, priority) VALUES (?, ?, ?, ?)",
      ["task1", "Peer1 Task", 0, 1]
    );

    // Trigger sync from peer1
    await peer1.checkLocalChanges();
    await wait(100);

    // Insert data on peer2
    await db2.exec(
      "INSERT INTO notes (id, title, content) VALUES (?, ?, ?)",
      ["note2", "Peer2 Note", "Content from peer2"]
    );

    await db2.exec(
      "INSERT INTO tasks (id, title, completed, priority) VALUES (?, ?, ?, ?)",
      ["task2", "Peer2 Task", 1, 2]
    );

    // Trigger sync from peer2
    await peer2.checkLocalChanges();
    await wait(100);

    // Verify both databases have all data
    const db1Notes = await getTableData(db1, "notes");
    const db2Notes = await getTableData(db2, "notes");
    const db1Tasks = await getTableData(db1, "tasks");
    const db2Tasks = await getTableData(db2, "tasks");

    // Both databases should have 2 notes and 2 tasks
    expect(db1Notes).toHaveLength(2);
    expect(db2Notes).toHaveLength(2);
    expect(db1Tasks).toHaveLength(2);
    expect(db2Tasks).toHaveLength(2);

    // Verify specific data
    expect(db1Notes.find(n => n.id === "note1")).toBeDefined();
    expect(db1Notes.find(n => n.id === "note2")).toBeDefined();
    expect(db2Notes.find(n => n.id === "note1")).toBeDefined();
    expect(db2Notes.find(n => n.id === "note2")).toBeDefined();

    expect(db1Tasks.find(t => t.id === "task1")).toBeDefined();
    expect(db1Tasks.find(t => t.id === "task2")).toBeDefined();
    expect(db2Tasks.find(t => t.id === "task1")).toBeDefined();
    expect(db2Tasks.find(t => t.id === "task2")).toBeDefined();
  });

  it("should synchronize updates between peers", async () => {
    // Insert initial data on peer1
    await db1.exec(
      "INSERT INTO notes (id, title, content) VALUES (?, ?, ?)",
      ["note1", "Original Title", "Original content"]
    );

    await peer1.checkLocalChanges();
    await wait(100);

    // Verify peer2 has the data
    let db2Notes = await getTableData(db2, "notes");
    expect(db2Notes).toHaveLength(1);
    expect(db2Notes[0].title).toBe("Original Title");

    // Update the note on peer2
    await db2.exec(
      "UPDATE notes SET title = ?, content = ? WHERE id = ?",
      ["Updated Title", "Updated content", "note1"]
    );

    await peer2.checkLocalChanges();
    await wait(100);

    // Verify peer1 has the updated data
    const db1Notes = await getTableData(db1, "notes");
    expect(db1Notes).toHaveLength(1);
    expect(db1Notes[0].title).toBe("Updated Title");
    expect(db1Notes[0].content).toBe("Updated content");

    // Verify peer2 still has the updated data
    db2Notes = await getTableData(db2, "notes");
    expect(db2Notes).toHaveLength(1);
    expect(db2Notes[0].title).toBe("Updated Title");
    expect(db2Notes[0].content).toBe("Updated content");
  });

  it("should synchronize deletions between peers", async () => {
    // Insert data on both peers
    await db1.exec(
      "INSERT INTO notes (id, title, content) VALUES (?, ?, ?)",
      ["note1", "Note 1", "Content 1"]
    );

    await db2.exec(
      "INSERT INTO notes (id, title, content) VALUES (?, ?, ?)",
      ["note2", "Note 2", "Content 2"]
    );

    // Sync both
    await peer1.checkLocalChanges();
    await peer2.checkLocalChanges();
    await wait(100);

    // Verify both have 2 notes
    let db1Notes = await getTableData(db1, "notes");
    let db2Notes = await getTableData(db2, "notes");
    expect(db1Notes).toHaveLength(2);
    expect(db2Notes).toHaveLength(2);

    // Delete note1 on peer1
    await db1.exec("DELETE FROM notes WHERE id = ?", ["note1"]);
    await peer1.checkLocalChanges();
    await wait(100);

    // Verify both databases now have only 1 note
    db1Notes = await getTableData(db1, "notes");
    db2Notes = await getTableData(db2, "notes");
    expect(db1Notes).toHaveLength(1);
    expect(db2Notes).toHaveLength(1);
    expect(db1Notes[0].id).toBe("note2");
    expect(db2Notes[0].id).toBe("note2");
  });

  it("should handle multiple table operations", async () => {
    // Insert data in multiple tables on peer1
    await db1.exec(
      "INSERT INTO notes (id, title, content) VALUES (?, ?, ?)",
      ["note1", "Note from peer1", "Content"]
    );

    await db1.exec(
      "INSERT INTO tasks (id, title, completed, priority) VALUES (?, ?, ?, ?)",
      ["task1", "Task from peer1", 0, 1]
    );

    // Insert different data on peer2
    await db2.exec(
      "INSERT INTO notes (id, title, content) VALUES (?, ?, ?)",
      ["note2", "Note from peer2", "Content"]
    );

    await db2.exec(
      "INSERT INTO tasks (id, title, completed, priority) VALUES (?, ?, ?, ?)",
      ["task2", "Task from peer2", 1, 2]
    );

    // Sync both peers
    await peer1.checkLocalChanges();
    await peer2.checkLocalChanges();
    await wait(100);

    // Verify both databases have all data
    const db1Notes = await getTableData(db1, "notes");
    const db2Notes = await getTableData(db2, "notes");
    const db1Tasks = await getTableData(db1, "tasks");
    const db2Tasks = await getTableData(db2, "tasks");

    expect(db1Notes).toHaveLength(2);
    expect(db2Notes).toHaveLength(2);
    expect(db1Tasks).toHaveLength(2);
    expect(db2Tasks).toHaveLength(2);

    // Verify data integrity
    expect(db1Notes.map(n => n.id).sort()).toEqual(["note1", "note2"]);
    expect(db2Notes.map(n => n.id).sort()).toEqual(["note1", "note2"]);
    expect(db1Tasks.map(t => t.id).sort()).toEqual(["task1", "task2"]);
    expect(db2Tasks.map(t => t.id).sort()).toEqual(["task1", "task2"]);
  });

  it("should emit change events when data is synchronized", async () => {
    const peer1Changes: string[][] = [];
    const peer2Changes: string[][] = [];

    // Listen for change events
    peer1.on("change", (tables: string[]) => peer1Changes.push(tables));
    peer2.on("change", (tables: string[]) => peer2Changes.push(tables));

    // Insert data on peer1
    await db1.exec(
      "INSERT INTO notes (id, title, content) VALUES (?, ?, ?)",
      ["note1", "Test Note", "Content"]
    );

    await peer1.checkLocalChanges();
    await wait(100);

    // Verify change events were emitted
    expect(peer1Changes.length).toBeGreaterThan(0);
    expect(peer2Changes.length).toBeGreaterThan(0);

    // Verify the correct table was mentioned in the change event
    const allPeer1Tables = peer1Changes.flat();
    const allPeer2Tables = peer2Changes.flat();
    expect(allPeer1Tables).toContain("notes");
    expect(allPeer2Tables).toContain("notes");
  });
});
