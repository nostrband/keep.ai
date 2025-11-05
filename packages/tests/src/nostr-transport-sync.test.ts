import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DBInterface, NostrPeerStore, KeepDb } from "@app/db";
import { createDBNode } from "@app/node";
import { NostrTransport, NostrSigner, NostrConnector, Peer } from "@app/sync";
import {
  generateSecretKey,
  getPublicKey,
  finalizeEvent,
  nip44,
  UnsignedEvent,
  Event,
} from "nostr-tools";
import debug from "debug";
debug.enable("*");

// Mock NostrSigner implementation for testing
class TestNostrSigner implements NostrSigner {
  constructor(private privateKey: Uint8Array) {
  }

  getPublicKey() {
    return getPublicKey(this.privateKey);
  }

  async signEvent(event: UnsignedEvent): Promise<Event> {
    return finalizeEvent(event, this.privateKey);
  }

  async encrypt(req: {
    plaintext: string;
    receiverPubkey: string;
    senderPubkey: string;
  }): Promise<string> {
    if (getPublicKey(this.privateKey) !== req.senderPubkey)
      throw new Error("Failed to encrypt, wrong sender pubkey");
    const conversationKey = nip44.getConversationKey(
      this.privateKey,
      req.receiverPubkey
    );
    return nip44.encrypt(req.plaintext, conversationKey);
  }

  async decrypt(req: {
    ciphertext: string;
    receiverPubkey: string;
    senderPubkey: string;
  }): Promise<string> {
    if (getPublicKey(this.privateKey) !== req.receiverPubkey)
      throw new Error("Failed to decrypt, wrong receiver pubkey");
    const conversationKey = nip44.getConversationKey(
      this.privateKey,
      req.senderPubkey
    );
    return nip44.decrypt(req.ciphertext, conversationKey);
  }
}

// Helper function to wait for async operations
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("NostrTransport Synchronization", () => {
  let db1: DBInterface;
  let db2: DBInterface;
  let keepDb1: KeepDb;
  let keepDb2: KeepDb;
  let nostrPeerStore1: NostrPeerStore;
  let nostrPeerStore2: NostrPeerStore;
  let transport1: NostrTransport;
  let transport2: NostrTransport;
  let peer1: Peer;
  let peer2: Peer;
  let connector1: NostrConnector;
  let connector2: NostrConnector;
  let signer1: TestNostrSigner;
  let signer2: TestNostrSigner;
  let privateKey1: Uint8Array;
  let privateKey2: Uint8Array;
  let pubkey1: string;
  let pubkey2: string;

  beforeEach(async () => {
    // Create two in-memory databases
    db1 = await createDBNode(":memory:");
    db2 = await createDBNode(":memory:");

    // Create KeepDb wrappers
    keepDb1 = new KeepDb(db1);
    keepDb2 = new KeepDb(db2);

    // Initialize database migrations (this creates all the tables we need)
    await keepDb1.start();
    await keepDb2.start();

    // Create NostrPeerStore instances
    nostrPeerStore1 = new NostrPeerStore(keepDb1);
    nostrPeerStore2 = new NostrPeerStore(keepDb2);

    // Generate keys for both peers
    privateKey1 = generateSecretKey();
    privateKey2 = generateSecretKey();
    pubkey1 = getPublicKey(privateKey1);
    pubkey2 = getPublicKey(privateKey2);

    // Create NostrConnector instances
    connector1 = new NostrConnector();
    connector2 = new NostrConnector();

    // Create signers
    signer1 = new TestNostrSigner(privateKey1);
    signer2 = new TestNostrSigner(privateKey2);

    // Create NostrTransport instances
    transport1 = new NostrTransport({ store: nostrPeerStore1, signer: signer1 });
    transport2 = new NostrTransport({ store: nostrPeerStore2, signer: signer2 });

    // Create Peer instances
    peer1 = new Peer(db1, [transport1]);
    peer2 = new Peer(db2, [transport2]);

    // Start peers
    await peer1.start();
    await peer2.start();

    // Establish peer connection using NostrConnector
    await establishPeerConnection(peer1.id, peer2.id, privateKey1, privateKey2);

    // const peers1 = await nostrPeerStore1.listPeers();
    // const peers2 = await nostrPeerStore2.listPeers();
    // console.log("peers1", peers1);
    // console.log("peers2", peers2);

    // Start transports
    await transport1.start(peer1.getConfig());
    await transport2.start(peer2.getConfig());

    // Wait for initial connection and sync
    await wait(200);
  });

  afterEach(async () => {
    await wait(1000);

    // Stop peers and transports
    if (peer1) await peer1.stop();
    if (peer2) await peer2.stop();
    // if (transport1) await transport1.stop();
    // if (transport2) await transport2.stop();
    if (connector1) connector1.close();
    if (connector2) connector2.close();

    // Close databases
    if (db1) await db1.close();
    if (db2) await db2.close();
  });

  async function establishPeerConnection(
    peerId1: string,
    peerId2: string,
    pk1: Uint8Array,
    pk2: Uint8Array
  ) {
    const relays = ["wss://relay1.getkeep.ai"];
    const deviceInfo1 = "Test Device 1";
    const deviceInfo2 = "Test Device 2";

    // Generate connection string
    const connInfo = await connector1.generateConnectionString(relays, pk1);

    // Start listening and connecting
    const listenerPromise = connector1.listen(connInfo, peerId1, deviceInfo1);

    // Give a small delay to ensure listener is ready
    await wait(100);

    const connectorPromise = connector2.connect(
      connInfo.str,
      peerId2,
      deviceInfo2,
      pk2
    );

    // Wait for both operations to complete
    const [listenerResult, connectorResult] = await Promise.all([
      listenerPromise,
      connectorPromise,
    ]);

    // Add peers to stores
    await nostrPeerStore1.addPeer({
      peer_pubkey: listenerResult.peer_pubkey,
      peer_id: listenerResult.peer_id,
      local_pubkey: getPublicKey(listenerResult.key),
      local_id: peerId1,
      device_info: listenerResult.peer_device_info,
      relays: relays.join(","),
      timestamp: "",
    });
    await nostrPeerStore2.addPeer({
      peer_pubkey: connectorResult.peer_pubkey,
      peer_id: connectorResult.peer_id,
      local_pubkey: getPublicKey(connectorResult.key),
      local_id: peerId2,
      device_info: connectorResult.peer_device_info,
      relays: relays.join(","),
      timestamp: "",
    });
  }

  async function getTableData(db: DBInterface, table: string): Promise<any[]> {
    const result = await db.execO(`SELECT * FROM ${table} ORDER BY id`);
    return result || [];
  }

  it('should synchronize data between two peers using NostrTransport', async () => {
    // Insert data on peer1 using the actual KeepDB schema
    await db1.exec(
      "INSERT INTO notes (id, title, content, tags, priority) VALUES (?, ?, ?, ?, ?)",
      ["note1", "Peer1 Note", "Content from peer1", "", "normal"]
    );

    await db1.exec(
      "INSERT INTO tasks (id, timestamp, task, title) VALUES (?, ?, ?, ?)",
      ["task1", Date.now(), "Peer1 Task", "Peer1 Task"]
    );

    // Trigger sync from peer1
    await peer1.checkLocalChanges();
    await wait(3000); // Wait for nostr relay propagation

    // Insert data on peer2 using the actual KeepDB schema
    await db2.exec(
      "INSERT INTO notes (id, title, content, tags, priority) VALUES (?, ?, ?, ?, ?)",
      ["note2", "Peer2 Note", "Content from peer2", "", "high"]
    );

    await db2.exec(
      "INSERT INTO tasks (id, timestamp, task, title) VALUES (?, ?, ?, ?)",
      ["task2", Date.now(), "Peer2 Task", "Peer2 Task"]
    );

    // Trigger sync from peer2
    await peer2.checkLocalChanges();
    await wait(2000); // Wait for nostr relay propagation

    // Verify both databases have all data
    const db1Notes = await getTableData(db1, "notes");
    const db2Notes = await getTableData(db2, "notes");
    const db1Tasks = await getTableData(db1, "tasks");
    const db2Tasks = await getTableData(db2, "tasks");

    // Both databases should have 1 notes and 1 tasks
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
  }, 30000); // 30 second timeout for network operations

  it('should synchronize updates between peers', async () => {
    // Insert initial data on peer1
    await db1.exec(
      "INSERT INTO notes (id, title, content, tags, priority) VALUES (?, ?, ?, ?, ?)",
      ["note1", "Original Title", "Original content", "", "normal"]
    );

    await peer1.checkLocalChanges();
    await wait(2000);

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
    await wait(2000);

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
  }, 30000);

  it("should handle termination and restart with continued sync", async () => {
    // Phase 1: Initial sync
    await db1.exec(
      "INSERT INTO notes (id, title, content, tags, priority) VALUES (?, ?, ?, ?, ?)",
      ["note1", "Initial Note", "Initial content", "", "normal"]
    );

    await db1.exec(
      "INSERT INTO tasks (id, timestamp, task, title) VALUES (?, ?, ?, ?)",
      ["task1", Date.now(), "Initial Task", "Initial Task"]
    );

    await peer1.checkLocalChanges();
    await wait(2000);

    // Verify initial sync
    let db2Notes = await getTableData(db2, "notes");
    let db2Tasks = await getTableData(db2, "tasks");
    expect(db2Notes).toHaveLength(1);
    expect(db2Tasks).toHaveLength(1);

    // Phase 3: Make changes while disconnected
    await db1.exec(
      "INSERT INTO notes (id, title, content, tags, priority) VALUES (?, ?, ?, ?, ?)",
      ["note2", "Offline Note 1", "Content while offline", "", "normal"]
    );

    await db2.exec(
      "INSERT INTO tasks (id, timestamp, task, title) VALUES (?, ?, ?, ?)",
      ["task2", Date.now(), "Offline Task 2", "Offline Task 2"]
    );

    // Phase 2: Stop transports (simulate termination)
    await peer1.stop();
    await peer2.stop();
    // transports stopped by peer
    // await transport1.stop();
    // await transport2.stop();

    // Phase 4: Restart transports with same database objects
    transport1 = new NostrTransport({ store: nostrPeerStore1, signer: signer1 });
    transport2 = new NostrTransport({ store: nostrPeerStore2, signer: signer2 });

    // Update peer objects with new transports
    peer1 = new Peer(db1, [transport1]);
    peer2 = new Peer(db2, [transport2]);

    await peer1.start();
    await peer2.start();

    await transport1.start(peer1.getConfig());
    await transport2.start(peer2.getConfig());

    await wait(2000);

    // Phase 5: Trigger sync after restart
    await peer1.checkLocalChanges();
    await peer2.checkLocalChanges();
    await wait(2000); // Wait longer for full sync

    const middleDb1Notes = await getTableData(db1, "notes");
    const middleDb2Notes = await getTableData(db2, "notes");
    const middleDb1Tasks = await getTableData(db1, "tasks");
    const middleDb2Tasks = await getTableData(db2, "tasks");

    // Both databases should have all 2 notes and 2 tasks
    expect(middleDb1Notes).toHaveLength(2);
    expect(middleDb2Notes).toHaveLength(2);
    expect(middleDb1Tasks).toHaveLength(2);
    expect(middleDb2Tasks).toHaveLength(2);

    // Phase 6: Add more changes after restart
    await db1.exec(
      "INSERT INTO notes (id, title, content, tags, priority) VALUES (?, ?, ?, ?, ?)",
      ["note3", "Post-restart Note", "Content after restart", "", "normal"]
    );
    await db1.exec(
      "INSERT INTO notes (id, title, content, tags, priority) VALUES (?, ?, ?, ?, ?)",
      ["note4", "Post-restart Note", "Content after restart", "", "normal"]
    );
    await peer1.checkLocalChanges();

    await db2.exec(
      "INSERT INTO tasks (id, timestamp, task, title) VALUES (?, ?, ?, ?)",
      ["task3", Date.now(), "Post-restart Task", "Post-restart Task"]
    );
    await db2.exec(
      "INSERT INTO tasks (id, timestamp, task, title) VALUES (?, ?, ?, ?)",
      ["task4", Date.now(), "Post-restart Task", "Post-restart Task"]
    );
    await peer2.checkLocalChanges();

    await db1.exec(
      "INSERT INTO notes (id, title, content, tags, priority) VALUES (?, ?, ?, ?, ?)",
      ["note5", "Post-restart Note", "Content after restart", "", "normal"]
    );
    await db2.exec(
      "INSERT INTO notes (id, title, content, tags, priority) VALUES (?, ?, ?, ?, ?)",
      ["note5", "Post-restart Note", "Content after restart", "", "normal"]
    );
    await peer1.checkLocalChanges();
    await peer2.checkLocalChanges();

    await wait(3000);

    // Phase 7: Verify all data is synchronized
    const finalDb1Notes = await getTableData(db1, "notes");
    const finalDb2Notes = await getTableData(db2, "notes");
    const finalDb1Tasks = await getTableData(db1, "tasks");
    const finalDb2Tasks = await getTableData(db2, "tasks");

    // Both databases should have all 3 notes and 3 tasks
    expect(finalDb1Notes).toHaveLength(5);
    expect(finalDb2Notes).toHaveLength(5);
    expect(finalDb1Tasks).toHaveLength(4);
    expect(finalDb2Tasks).toHaveLength(4);

    // Verify specific data exists on both sides
    const expectedNoteIds = ["note1", "note2", "note3", "note4", "note5"];
    const expectedTaskIds = ["task1", "task2", "task3", "task4"];

    for (const noteId of expectedNoteIds) {
      expect(finalDb1Notes.find(n => n.id === noteId)).toBeDefined();
      expect(finalDb2Notes.find(n => n.id === noteId)).toBeDefined();
    }

    for (const taskId of expectedTaskIds) {
      expect(finalDb1Tasks.find(t => t.id === taskId)).toBeDefined();
      expect(finalDb2Tasks.find(t => t.id === taskId)).toBeDefined();
    }
  }, 45000); // 45 second timeout for complex restart scenario

  it('should handle deletions between peers', async () => {
    // Insert data on both peers
    await db1.exec(
      "INSERT INTO notes (id, title, content, tags, priority) VALUES (?, ?, ?, ?, ?)",
      ["note1", "Note 1", "Content 1", "", "normal"]
    );

    await db2.exec(
      "INSERT INTO notes (id, title, content, tags, priority) VALUES (?, ?, ?, ?, ?)",
      ["note2", "Note 2", "Content 2", "", "normal"]
    );

    // Sync both
    await peer1.checkLocalChanges();
    await peer2.checkLocalChanges();
    await wait(500);

    // Verify both have 2 notes
    let db1Notes = await getTableData(db1, "notes");
    let db2Notes = await getTableData(db2, "notes");
    expect(db1Notes).toHaveLength(2);
    expect(db2Notes).toHaveLength(2);

    // Delete note1 on peer1
    await db1.exec("DELETE FROM notes WHERE id = ?", ["note1"]);
    await peer1.checkLocalChanges();
    await wait(500);

    // Verify both databases now have only 1 note
    db1Notes = await getTableData(db1, "notes");
    db2Notes = await getTableData(db2, "notes");
    expect(db1Notes).toHaveLength(1);
    expect(db2Notes).toHaveLength(1);
    expect(db1Notes[0].id).toBe("note2");
    expect(db2Notes[0].id).toBe("note2");
  }, 30000);

  it('should emit change events when data is synchronized', async () => {
    const peer1Changes: string[][] = [];
    const peer2Changes: string[][] = [];

    // Listen for change events
    peer1.on("change", (tables: string[]) => peer1Changes.push(tables));
    peer2.on("change", (tables: string[]) => peer2Changes.push(tables));

    // Insert data on peer1
    await db1.exec(
      "INSERT INTO notes (id, title, content, tags, priority) VALUES (?, ?, ?, ?, ?)",
      ["note1", "Test Note", "Content", "", "normal"]
    );

    await peer1.checkLocalChanges();
    await wait(500);

    // Verify change events were emitted
    expect(peer1Changes.length).toBeGreaterThan(0);
    expect(peer2Changes.length).toBeGreaterThan(0);

    // Verify the correct table was mentioned in the change event
    const allPeer1Tables = peer1Changes.flat();
    const allPeer2Tables = peer2Changes.flat();
    expect(allPeer1Tables).toContain("notes");
    expect(allPeer2Tables).toContain("notes");
  }, 30000);
});
