import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Fastify, { FastifyInstance } from "fastify";
import {
  TransportClientHttp,
  Transport,
  TransportCallbacks,
  Cursor,
  PeerMessage,
  TransportMessage,
  serializeCursor,
  deserializeCursor,
} from "@app/sync";

// Helper to wait for async operations
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Mock server state
interface MockServerState {
  connectedPeers: Map<string, any>;
  receivedMessages: TransportMessage[];
  onClientConnect?: (peerId: string, reply: any) => void;
  onSync?: (peerId: string, cursor: Cursor) => void;
  onData?: (peerId: string, data: PeerMessage) => void;
}

// Create a mock SSE server
async function createMockServer(
  state: MockServerState
): Promise<{ server: FastifyInstance; url: string }> {
  const server = Fastify();

  // SSE endpoint
  server.get<{ Querystring: { peerId: string } }>(
    "/stream",
    async (request, reply) => {
      const { peerId } = request.query;

      if (!peerId) {
        reply.status(400).send({ error: "Missing peerId" });
        return;
      }

      // Hijack the response for SSE
      reply.hijack();

      reply.raw.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });

      // Store the client
      state.connectedPeers.set(peerId, {
        reply,
        send: (msg: TransportMessage) => {
          reply.raw.write(`data: ${JSON.stringify(msg)}\n\n`);
        },
      });

      // Send connect message
      const connectMsg: TransportMessage = {
        type: "connect",
        peerId: "server-peer-id",
      };
      reply.raw.write(`data: ${JSON.stringify(connectMsg)}\n\n`);

      // Notify callback
      if (state.onClientConnect) {
        state.onClientConnect(peerId, reply);
      }

      // Handle disconnect
      request.raw.on("close", () => {
        state.connectedPeers.delete(peerId);
      });
    }
  );

  // Sync endpoint
  server.post("/sync", async (request, reply) => {
    const msg = request.body as TransportMessage;
    state.receivedMessages.push(msg);

    if (msg.type !== "sync" || !msg.cursor) {
      reply.status(400).send({ error: "Invalid sync message" });
      return;
    }

    if (state.onSync) {
      state.onSync(msg.peerId, deserializeCursor(msg.cursor));
    }

    reply.send({ success: true });
  });

  // Data endpoint
  server.post("/data", async (request, reply) => {
    const msg = request.body as TransportMessage;
    state.receivedMessages.push(msg);

    if (msg.type !== "data" || !msg.data) {
      reply.status(400).send({ error: "Invalid data message" });
      return;
    }

    if (state.onData) {
      state.onData(msg.peerId, msg.data);
    }

    reply.send({ success: true });
  });

  // Start server on random port
  const address = await server.listen({ port: 0, host: "127.0.0.1" });

  return { server, url: address };
}

describe("TransportClientHttp", () => {
  let server: FastifyInstance;
  let serverUrl: string;
  let serverState: MockServerState;
  let transport: TransportClientHttp;

  beforeEach(async () => {
    serverState = {
      connectedPeers: new Map(),
      receivedMessages: [],
    };

    const mock = await createMockServer(serverState);
    server = mock.server;
    serverUrl = mock.url;
    transport = new TransportClientHttp(serverUrl);
  });

  afterEach(async () => {
    transport.stop();
    await server.close();
  });

  describe("Connection lifecycle", () => {
    it("should connect to SSE endpoint and receive connect message", async () => {
      const callbacks: TransportCallbacks = {
        onConnect: async (t, peerId) => {
          expect(peerId).toBe("server-peer-id");
        },
        onSync: async () => {},
        onReceive: async () => {},
        onDisconnect: async () => {},
      };

      await transport.start({ localPeerId: "client-peer-id", ...callbacks });

      // Wait for connection
      await wait(100);

      expect(transport.isSSEConnected()).toBe(true);
      expect(transport.getRemotePeerId()).toBe("server-peer-id");
      expect(serverState.connectedPeers.has("client-peer-id")).toBe(true);
    });

    it("should call onConnect callback when connected", async () => {
      let connectCalled = false;
      let receivedPeerId = "";

      const callbacks: TransportCallbacks = {
        onConnect: async (t, peerId) => {
          connectCalled = true;
          receivedPeerId = peerId;
        },
        onSync: async () => {},
        onReceive: async () => {},
        onDisconnect: async () => {},
      };

      await transport.start({ localPeerId: "client-peer-id", ...callbacks });
      await wait(100);

      expect(connectCalled).toBe(true);
      expect(receivedPeerId).toBe("server-peer-id");
    });

    it("should properly clean up on stop()", async () => {
      const callbacks: TransportCallbacks = {
        onConnect: async () => {},
        onSync: async () => {},
        onReceive: async () => {},
        onDisconnect: async () => {},
      };

      await transport.start({ localPeerId: "client-peer-id", ...callbacks });
      await wait(100);

      expect(transport.isSSEConnected()).toBe(true);

      transport.stop();

      expect(transport.isSSEConnected()).toBe(false);
      expect(transport.getRemotePeerId()).toBeUndefined();
    });

    it("should normalize endpoint URL by removing trailing slash", () => {
      const t1 = new TransportClientHttp("http://example.com/");
      const t2 = new TransportClientHttp("http://example.com");

      expect(t1.getEndpoint()).toBe("http://example.com");
      expect(t2.getEndpoint()).toBe("http://example.com");
    });
  });

  describe("Message sending", () => {
    it("should send sync message via POST /sync", async () => {
      let syncReceived = false;
      serverState.onSync = (peerId, cursor) => {
        syncReceived = true;
        expect(peerId).toBe("client-peer-id");
        expect(cursor).toBeDefined();
      };

      const callbacks: TransportCallbacks = {
        onConnect: async () => {},
        onSync: async () => {},
        onReceive: async () => {},
        onDisconnect: async () => {},
      };

      await transport.start({ localPeerId: "client-peer-id", ...callbacks });
      await wait(100);

      const cursor = new Cursor();
      cursor.peers.set("010203", 100);
      await transport.sync("server-peer-id", cursor);
      await wait(50);

      expect(syncReceived).toBe(true);
    });

    it("should send data message via POST /data", async () => {
      let dataReceived = false;
      serverState.onData = (peerId, data) => {
        dataReceived = true;
        expect(peerId).toBe("client-peer-id");
        expect(data.type).toBe("changes");
      };

      const callbacks: TransportCallbacks = {
        onConnect: async () => {},
        onSync: async () => {},
        onReceive: async () => {},
        onDisconnect: async () => {},
      };

      await transport.start({ localPeerId: "client-peer-id", ...callbacks });
      await wait(100);

      const message: PeerMessage = {
        type: "changes",
        data: [],
      };
      await transport.send("server-peer-id", "", message);
      await wait(50);

      expect(dataReceived).toBe(true);
    });

    it("should not send to unknown peer", async () => {
      const callbacks: TransportCallbacks = {
        onConnect: async () => {},
        onSync: async () => {},
        onReceive: async () => {},
        onDisconnect: async () => {},
      };

      await transport.start({ localPeerId: "client-peer-id", ...callbacks });
      await wait(100);

      // Try to sync with unknown peer
      await transport.sync("unknown-peer", new Cursor());
      await wait(50);

      // Should not have sent any messages
      expect(
        serverState.receivedMessages.filter((m) => m.type === "sync").length
      ).toBe(0);
    });

    it("should not send before start() is called", async () => {
      // Transport not started
      await transport.sync("any-peer", new Cursor());
      await wait(50);

      expect(serverState.receivedMessages.length).toBe(0);
    });
  });

  describe("Message receiving", () => {
    it("should receive and process sync message from server", async () => {
      let syncReceived = false;

      const callbacks: TransportCallbacks = {
        onConnect: async () => {},
        onSync: async (t, peerId, streamId, cursor) => {
          syncReceived = true;
          expect(peerId).toBe("server-peer-id");
        },
        onReceive: async () => {},
        onDisconnect: async () => {},
      };

      await transport.start({ localPeerId: "client-peer-id", ...callbacks });
      await wait(100);

      // Server sends sync message
      const client = serverState.connectedPeers.get("client-peer-id");
      expect(client).toBeDefined();

      const syncMsg: TransportMessage = {
        type: "sync",
        peerId: "server-peer-id",
        cursor: serializeCursor(new Cursor()),
      };
      client.send(syncMsg);
      await wait(50);

      expect(syncReceived).toBe(true);
    });

    it("should receive and process data message from server", async () => {
      let dataReceived = false;
      let receivedData: PeerMessage | null = null;

      const callbacks: TransportCallbacks = {
        onConnect: async () => {},
        onSync: async () => {},
        onReceive: async (t, peerId, streamId, data) => {
          dataReceived = true;
          receivedData = data;
          expect(peerId).toBe("server-peer-id");
        },
        onDisconnect: async () => {},
      };

      await transport.start({ localPeerId: "client-peer-id", ...callbacks });
      await wait(100);

      // Server sends data message
      const client = serverState.connectedPeers.get("client-peer-id");
      // Note: PeerChange uses number for db_version and hex strings for pk/site_id
      const testData: PeerMessage = {
        type: "changes",
        data: [
          {
            table: "test",
            pk: "706b31", // hex for "pk1"
            cid: "col1",
            val: "value1",
            col_version: 1,
            db_version: 1,
            site_id: "010203", // hex
            cl: 1,
            seq: 1,
          },
        ],
      };
      const dataMsg: TransportMessage = {
        type: "data",
        peerId: "server-peer-id",
        data: testData,
      };
      client.send(dataMsg);
      await wait(50);

      expect(dataReceived).toBe(true);
      expect(receivedData).toBeDefined();
      expect(receivedData!.type).toBe("changes");
      expect(receivedData!.data.length).toBe(1);
    });

    it("should handle ping message without error", async () => {
      const callbacks: TransportCallbacks = {
        onConnect: async () => {},
        onSync: async () => {},
        onReceive: async () => {},
        onDisconnect: async () => {},
      };

      await transport.start({ localPeerId: "client-peer-id", ...callbacks });
      await wait(100);

      // Server sends ping message
      const client = serverState.connectedPeers.get("client-peer-id");
      const pingMsg: TransportMessage = {
        type: "ping",
        peerId: "server-peer-id",
      };
      client.send(pingMsg);
      await wait(50);

      // Should still be connected
      expect(transport.isSSEConnected()).toBe(true);
    });
  });

  describe("Error handling and reconnection", () => {
    it("should reset reconnect attempts on successful connection", async () => {
      const callbacks: TransportCallbacks = {
        onConnect: async () => {},
        onSync: async () => {},
        onReceive: async () => {},
        onDisconnect: async () => {},
      };

      await transport.start({ localPeerId: "client-peer-id", ...callbacks });
      await wait(100);

      expect(transport.getReconnectAttempts()).toBe(0);
    });

    it("should call onDisconnect when server closes connection", async () => {
      let disconnectCalled = false;

      const callbacks: TransportCallbacks = {
        onConnect: async () => {},
        onSync: async () => {},
        onReceive: async () => {},
        onDisconnect: async () => {
          disconnectCalled = true;
        },
      };

      await transport.start({ localPeerId: "client-peer-id", ...callbacks });
      await wait(100);

      // Verify connected
      expect(transport.isSSEConnected()).toBe(true);

      // Close server connection to this client
      const client = serverState.connectedPeers.get("client-peer-id");
      if (client) {
        client.reply.raw.end();
      }
      await wait(100);

      expect(disconnectCalled).toBe(true);
    });
  });

  describe("Utility methods", () => {
    it("should return correct endpoint", () => {
      expect(transport.getEndpoint()).toBe(serverUrl);
    });

    it("should track reconnect attempts", async () => {
      const callbacks: TransportCallbacks = {
        onConnect: async () => {},
        onSync: async () => {},
        onReceive: async () => {},
        onDisconnect: async () => {},
      };

      // Initially 0
      expect(transport.getReconnectAttempts()).toBe(0);

      await transport.start({ localPeerId: "client-peer-id", ...callbacks });
      await wait(100);

      // Still 0 after successful connection
      expect(transport.getReconnectAttempts()).toBe(0);
    });
  });
});

describe("TransportClientHttp without server", () => {
  it("should handle connection failure gracefully", async () => {
    // Connect to non-existent server
    const transport = new TransportClientHttp("http://127.0.0.1:59999");

    let disconnectCalled = false;
    const callbacks: TransportCallbacks = {
      onConnect: async () => {},
      onSync: async () => {},
      onReceive: async () => {},
      onDisconnect: async () => {
        disconnectCalled = true;
      },
    };

    await transport.start({ localPeerId: "client-peer-id", ...callbacks });

    // Wait for connection attempt and failure
    await wait(500);

    expect(transport.isSSEConnected()).toBe(false);

    transport.stop();
  });
});
