import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DBInterface } from "@app/db";
import { createDBNode } from "@app/node";
import {
  CRSqliteWorkerBase,
  WorkerResponsePort,
  CRSqliteWorkerClientBase,
  WorkerMessage,
  WorkerResponse,
  BroadcastMessage,
  Change,
} from "@app/worker";

// Extended worker class for testing
class TestWorker extends CRSqliteWorkerBase {
  public messages: BroadcastMessage[] = [];
  private clientPeer: CRSqliteWorkerClientBase | null = null;

  constructor(db: DBInterface) {
    super(db as any, async (msg) => this.broadcastChanges(msg));
  }

  setClient(client: CRSqliteWorkerClientBase) {
    this.clientPeer = client;
  }

  // Override to capture and forward broadcast messages
  private async broadcastChanges(message: BroadcastMessage): Promise<void> {
    this.messages.push(message);
    // Forward to client peer
    if (this.clientPeer) {
      await this.clientPeer.processChanges(message);
    }
  }
}

// Extended client class for testing
class TestClient extends CRSqliteWorkerClientBase {
  public sentMessages: WorkerMessage[] = [];
  public broadcastMessages: BroadcastMessage[] = [];
  public receivedResponses: WorkerResponse[] = [];
  private workerPeer: CRSqliteWorkerBase | null = null;
  private workerPort: WorkerResponsePort | null = null;

  constructor(db: DBInterface) {
    super(db as any, async (msg) => this.broadcastMessage(msg));
  }

  setWorker(worker: CRSqliteWorkerBase, port: WorkerResponsePort) {
    this.workerPeer = worker;
    this.workerPort = port;
  }

  // Override to capture and forward messages to worker
  protected postMessage(message: WorkerMessage) {
    this.sentMessages.push(message);
    // Forward to worker peer
    if (this.workerPeer && this.workerPort) {
      this.workerPeer.processClientMessage(message, this.workerPort);
    }
  }

  // Override to capture and forward broadcast messages
  private async broadcastMessage(message: BroadcastMessage): Promise<void> {
    this.broadcastMessages.push(message);
    // Forward to worker peer
    if (this.workerPeer) {
      await this.workerPeer.processChanges(message);
    }
  }

  // Override to capture received responses
  public async processWorkerMessage(response: WorkerResponse) {
    this.receivedResponses.push(response);
    return super.processWorkerMessage(response);
  }
}

// Mock WorkerResponsePort that forwards responses back to client
class MockWorkerResponsePort implements WorkerResponsePort {
  public responses: WorkerResponse[] = [];
  private client: CRSqliteWorkerClientBase | null = null;

  constructor(client?: CRSqliteWorkerClientBase) {
    this.client = client || null;
  }

  setClient(client: CRSqliteWorkerClientBase) {
    this.client = client;
  }

  postMessage(response: WorkerResponse): void {
    this.responses.push(response);
    // Forward response back to client
    if (this.client) {
      this.client.processWorkerMessage(response);
    }
  }
}

// Define interfaces for type safety
interface NoteRow {
  id: string;
  title: string;
  content: string;
  created_at: number;
  updated_at: number;
}

interface TaskRow {
  id: string;
  title: string;
  completed: number; // SQLite stores boolean as integer
  priority: number;
  created_at: number;
}

describe("CRSqlite Worker and Client Synchronization", () => {
  let workerDb: DBInterface;
  let clientDb: DBInterface;
  let worker: TestWorker;
  let client: TestClient;
  let workerPort: MockWorkerResponsePort;

  beforeEach(async () => {
    // Create in-memory databases using Node.js implementation
    try {
      console.log("Creating Node.js databases");
      workerDb = await createDBNode(":memory:");
      clientDb = await createDBNode(":memory:");
      
      console.log("Node.js databases created");
    } catch (e) {
      console.error("database creation error", e);
      throw e;
    }

    // Create test tables on both sides
    await setupTestTables(workerDb, "worker");
    await setupTestTables(clientDb, "client");

    // Create test instances
    worker = new TestWorker(workerDb);
    client = new TestClient(clientDb);
    workerPort = new MockWorkerResponsePort();

    // Connect peers
    workerPort.setClient(client);
    worker.setClient(client);
    client.setWorker(worker, workerPort);

    // Start worker and client
    await worker.start();
    await client.start();
  });

  afterEach(async () => {
    worker.stop();
    client.stop();
    await workerDb.close();
    await clientDb.close();
  });

  async function setupTestTables(db: DBInterface, prefix: string) {
    // Create test tables with explicit NOT NULL primary keys for CRSqlite
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

    console.log(`${prefix} tables created and registered with CRSqlite`);
  }

  async function getTableData(db: DBInterface, table: string): Promise<any[]> {
    const result = await db.execO(`SELECT * FROM ${table} ORDER BY id`);
    return result || [];
  }

  async function getChanges(db: DBInterface): Promise<Change[]> {
    const result = await db.execO<Change>(
      "SELECT * FROM crsql_changes ORDER BY db_version"
    );
    return result || [];
  }

  it("should synchronize data between client and worker", async () => {
    // Initial sync - client requests sync from worker
    console.log("t1");

    // Wait for sync to complete
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Insert data on client side
    await clientDb.exec(
      "INSERT INTO notes (id, title, content) VALUES (?, ?, ?)",
      ["note1", "Client Note 1", "Content from client"]
    );

    await clientDb.exec(
      "INSERT INTO tasks (id, title, completed, priority) VALUES (?, ?, ?, ?)",
      ["task1", "Client Task 1", 0, 1]
    );

    // Trigger sync for client changes
    await client.checkChanges();
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Insert data on worker side
    await workerDb.exec(
      "INSERT INTO notes (id, title, content) VALUES (?, ?, ?)",
      ["note2", "Worker Note 2", "Content from worker"]
    );

    await workerDb.exec(
      "INSERT INTO tasks (id, title, completed, priority) VALUES (?, ?, ?, ?)",
      ["task2", "Worker Task 2", 1, 2]
    );

    // Sync worker changes to client
    await worker.checkChanges();
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Update data on both sides
    await clientDb.exec("UPDATE notes SET content = ? WHERE id = ?", [
      "Updated content from client",
      "note2",
    ]);

    await workerDb.exec("UPDATE tasks SET completed = ? WHERE id = ?", [
      1,
      "task1",
    ]);

    // Trigger syncs
    await client.checkChanges();
    await new Promise((resolve) => setTimeout(resolve, 100));

    await worker.checkChanges();
    await new Promise((resolve) => setTimeout(resolve, 100));

    console.log("t2");

    // Delete data
    await clientDb.exec("DELETE FROM notes WHERE id = ?", ["note1"]);
    await workerDb.exec("DELETE FROM tasks WHERE id = ?", ["task2"]);

    // Final sync
    await client.checkChanges();
    await new Promise((resolve) => setTimeout(resolve, 100));

    await worker.checkChanges();
    await new Promise((resolve) => setTimeout(resolve, 100));
    console.log("t3");

    // Verify final state - both databases should be identical
    const clientNotes = (await getTableData(clientDb, "notes")) as NoteRow[];
    const workerNotes = (await getTableData(workerDb, "notes")) as NoteRow[];
    const clientTasks = (await getTableData(clientDb, "tasks")) as TaskRow[];
    const workerTasks = (await getTableData(workerDb, "tasks")) as TaskRow[];
    console.log("t4");

    console.log("Client notes:", clientNotes);
    console.log("Worker notes:", workerNotes);
    console.log("Client tasks:", clientTasks);
    console.log("Worker tasks:", workerTasks);

    // Verify data consistency
    expect(clientNotes).toHaveLength(1);
    expect(workerNotes).toHaveLength(1);
    expect(clientNotes[0].id).toBe("note2");
    expect(workerNotes[0].id).toBe("note2");
    expect(clientNotes[0].content).toBe("Updated content from client");
    expect(workerNotes[0].content).toBe("Updated content from client");

    expect(clientTasks).toHaveLength(1);
    expect(workerTasks).toHaveLength(1);
    expect(clientTasks[0].id).toBe("task1");
    expect(workerTasks[0].id).toBe("task1");
    expect(clientTasks[0].completed).toBe(1); // SQLite stores boolean as integer
    expect(workerTasks[0].completed).toBe(1);

    // Verify that changes were properly exchanged
    expect(client.sentMessages.length).toBeGreaterThan(0);
    expect(client.broadcastMessages.length).toBeGreaterThan(0);
    expect(worker.messages.length).toBeGreaterThan(0);
    expect(workerPort.responses.length).toBeGreaterThan(0);
    console.log("t5");
  });

  // it("should handle concurrent modifications correctly", async () => {
  //   // Initial sync
  //   await client.requestSync();
  //   await new Promise((resolve) => setTimeout(resolve, 50));

  //   // Insert same record with different content on both sides
  //   await clientDb.exec(
  //     "INSERT INTO notes (id, title, content) VALUES (?, ?, ?)",
  //     ["conflict-note", "Conflict Note", "Client version"]
  //   );

  //   await workerDb.exec(
  //     "INSERT INTO notes (id, title, content) VALUES (?, ?, ?)",
  //     ["conflict-note", "Conflict Note", "Worker version"]
  //   );

  //   // Trigger syncs
  //   await client.checkChanges();
  //   await new Promise((resolve) => setTimeout(resolve, 50));

  //   await worker.checkChanges();
  //   await new Promise((resolve) => setTimeout(resolve, 50));

  //   // Check that both databases have the record (CRSqlite should handle conflicts)
  //   const clientNotes = (await getTableData(clientDb, "notes")) as NoteRow[];
  //   const workerNotes = (await getTableData(workerDb, "notes")) as NoteRow[];

  //   expect(clientNotes).toHaveLength(1);
  //   expect(workerNotes).toHaveLength(1);
  //   expect(clientNotes[0].id).toBe("conflict-note");
  //   expect(workerNotes[0].id).toBe("conflict-note");

  //   // The content should be the same after sync (last-write-wins or CRSqlite conflict resolution)
  //   expect(clientNotes[0].content).toBe(workerNotes[0].content);
  // });

  // it("should handle database execution through worker", async () => {
  //   // Execute SQL through worker
  //   const result = await client.dbExec(
  //     "INSERT INTO notes (id, title, content) VALUES (?, ?, ?) RETURNING *",
  //     ["remote-note", "Remote Note", "Executed through worker"]
  //   );

  //   expect(result).toBeDefined();

  //   // Verify the data was inserted in worker database
  //   const workerNotes = (await getTableData(workerDb, "notes")) as NoteRow[];
  //   expect(workerNotes).toHaveLength(1);
  //   expect(workerNotes[0].id).toBe("remote-note");
  //   expect(workerNotes[0].title).toBe("Remote Note");

  //   // Sync to client
  //   await client.requestSync();
  //   await new Promise((resolve) => setTimeout(resolve, 50));

  //   // Verify client also has the data
  //   const clientNotes = (await getTableData(clientDb, "notes")) as NoteRow[];
  //   expect(clientNotes).toHaveLength(1);
  //   expect(clientNotes[0].id).toBe("remote-note");
  // });

  // it("should verify changes are properly tracked in crsql_changes table", async () => {
  //   // Insert data on client
  //   await clientDb.exec(
  //     "INSERT INTO notes (id, title, content) VALUES (?, ?, ?)",
  //     ["test-note", "Test Note", "Test content"]
  //   );

  //   // Check that changes are recorded
  //   const clientChanges = await getChanges(clientDb);
  //   expect(clientChanges.length).toBeGreaterThan(0);

  //   // Verify change structure
  //   const noteChange = clientChanges.find((c) => c.table === "notes");
  //   expect(noteChange).toBeDefined();
  //   expect(noteChange!.table).toBe("notes");
  //   expect(noteChange!.db_version).toBeGreaterThan(0);

  //   // Trigger sync
  //   await client.checkChanges();
  //   await new Promise((resolve) => setTimeout(resolve, 100));

  //   // Check worker received the changes
  //   const workerChanges = await getChanges(workerDb);
  //   expect(workerChanges.length).toBeGreaterThan(0);

  //   // Verify data is synchronized
  //   const workerNotes = (await getTableData(workerDb, "notes")) as NoteRow[];
  //   expect(workerNotes).toHaveLength(1);
  //   expect(workerNotes[0].id).toBe("test-note");
  // });

  // it("should handle multiple rapid changes correctly", async () => {
  //   // Insert multiple records rapidly on client
  //   for (let i = 0; i < 5; i++) {
  //     await clientDb.exec(
  //       "INSERT INTO notes (id, title, content) VALUES (?, ?, ?)",
  //       [`note-${i}`, `Note ${i}`, `Content ${i}`]
  //     );
  //   }

  //   // Trigger sync
  //   await client.checkChanges();
  //   await new Promise((resolve) => setTimeout(resolve, 100));

  //   // Insert multiple records rapidly on worker
  //   for (let i = 5; i < 10; i++) {
  //     await workerDb.exec(
  //       "INSERT INTO notes (id, title, content) VALUES (?, ?, ?)",
  //       [`note-${i}`, `Note ${i}`, `Content ${i}`]
  //     );
  //   }

  //   // Trigger sync
  //   await worker.checkChanges();
  //   await new Promise((resolve) => setTimeout(resolve, 100));

  //   // Verify both databases have all records
  //   const clientNotes = (await getTableData(clientDb, "notes")) as NoteRow[];
  //   const workerNotes = (await getTableData(workerDb, "notes")) as NoteRow[];

  //   expect(clientNotes).toHaveLength(10);
  //   expect(workerNotes).toHaveLength(10);

  //   // Verify all notes are present in both databases
  //   for (let i = 0; i < 10; i++) {
  //     const clientNote = clientNotes.find((n) => n.id === `note-${i}`);
  //     const workerNote = workerNotes.find((n) => n.id === `note-${i}`);

  //     expect(clientNote).toBeDefined();
  //     expect(workerNote).toBeDefined();
  //     expect(clientNote!.title).toBe(`Note ${i}`);
  //     expect(workerNote!.title).toBe(`Note ${i}`);
  //   }
  // });
});
