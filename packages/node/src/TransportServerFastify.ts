import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import {
  Cursor,
  serializeCursor,
  deserializeCursor,
  PeerMessage,
  Transport,
  TransportCallbacks,
  TransportMessage,
} from "@app/sync";
import debug from "debug";
import { randomBytes } from "@noble/ciphers/crypto";
import { bytesToHex } from "@noble/ciphers/utils";

const debugTransport = debug("node:TransportServerFastify");

interface SSEClient {
  reply: FastifyReply;
  peerId: string;
  pingTimer?: NodeJS.Timeout;
}

export class TransportServerFastify implements Transport {
  private sseClients: Map<string, SSEClient> = new Map();
  private callbacks?: TransportCallbacks;
  private localPeerId?: string;

  constructor() {}

  async start(
    config: { localPeerId: string } & TransportCallbacks
  ): Promise<void> {
    this.localPeerId = config.localPeerId;
    this.callbacks = {
      onConnect: config.onConnect,
      onSync: config.onSync,
      onReceive: config.onReceive,
      onDisconnect: config.onDisconnect,
    };
    debugTransport(`Started transport with local peer ID: ${this.localPeerId}`);
  }

  async registerRoutes(fastify: FastifyInstance): Promise<void> {
    // Register CORS plugin
    await fastify.register(import("@fastify/cors"), {
      origin: true,
      methods: ["GET", "POST", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Cache-Control"],
    });

    // SSE endpoint for streaming - now GET with peerId query parameter
    fastify.get(
      "/stream",
      {
        schema: {
          querystring: {
            type: "object",
            properties: {
              peerId: { type: "string" },
            },
            required: ["peerId"],
          },
        },
      },
      async (
        request: FastifyRequest<{ Querystring: { peerId: string } }>,
        reply: FastifyReply
      ) => {
        const { peerId } = request.query;

        if (!peerId) {
          reply.status(400).send({
            type: "error",
            error: "Missing peerId query parameter",
          });
          return;
        }

        // make sure fastify doesn't auto-close it
        reply.hijack();

        reply.raw.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Headers": "Cache-Control",
        });

        // Handle client disconnect
        request.raw.on("close", () => {
          this.handleClientDisconnect(request);
        });

        request.raw.on("error", () => {
          this.handleClientDisconnect(request);
        });

        if (!this.callbacks || !this.localPeerId) {
          throw new Error("Transport not started");
        }

        debugTransport(`Client ${peerId} connected to SSE /stream endpoint`);

        // Only allow one connection per peerId
        if (this.sseClients.get(peerId)) {
          const message: TransportMessage = {
            type: "error",
            peerId: this.localPeerId!,
            error: "ALREADY_CONNECTED",
          };
          this.sendSSEMessage(reply, message);
          debugTransport(`Peer ${peerId} already connected`);
          reply.raw.end();
          return;
        }

        // Reply with out own connect ASAP
        const message: TransportMessage = {
          type: "connect",
          peerId: this.localPeerId!,
        };
        this.sendSSEMessage(reply, message);
        debugTransport(`Sent connect to ${peerId}`);

        // Store the SSE client for this peer
        const client: SSEClient = {
          reply,
          peerId,
        };
        this.sseClients.set(peerId, client);

        debugTransport(`Client ${peerId} connected`);

        try {
          // Call onConnect callback
          await this.callbacks.onConnect(this, peerId);

          // Start ping timer for this client
          this.startPingTimer(peerId);
        } catch (error) {
          debugTransport(`Error handling connect for ${peerId}:`, error);
          reply.raw.end();
        }
      }
    );

    // POST endpoint for sync messages
    fastify.post(
      "/sync",
      async (request: FastifyRequest, reply: FastifyReply) => {
        try {
          const msg = request.body as TransportMessage;

          if (msg.type !== "sync") {
            reply.status(400).send({
              type: "error",
              error: "Expected sync message",
            });
            return;
          }

          if (!msg.peerId || !msg.cursor) {
            reply.status(400).send({
              type: "error",
              error: "Missing peerId or cursor in sync message",
            });
            return;
          }

          if (!this.callbacks) {
            reply.status(500).send({
              type: "error",
              error: "Transport not started",
            });
            return;
          }

          if (!this.sseClients.get(msg.peerId)) {
            reply.status(400).send({
              type: "error",
              error: "Connect to /stream first",
            });
            return;
          }

          const cursor = deserializeCursor(msg.cursor);
          await this.callbacks.onSync(this, msg.peerId, cursor);
          reply.send({ success: true });
        } catch (error) {
          reply.status(500).send({
            type: "error",
            error: error instanceof Error ? error.message : "Unknown error",
          });
        }
      }
    );

    // POST endpoint for data messages (changes/eose)
    fastify.post(
      "/data",
      async (request: FastifyRequest, reply: FastifyReply) => {
        try {
          const msg = request.body as TransportMessage;

          if (msg.type !== "data") {
            reply.status(400).send({
              type: "error",
              error: "Expected data message",
            });
            return;
          }

          if (!msg.peerId || !msg.data) {
            reply.status(400).send({
              type: "error",
              error: "Missing peerId or data in data message",
            });
            return;
          }

          if (!this.callbacks) {
            reply.status(500).send({
              type: "error",
              error: "Transport not started",
            });
            return;
          }

          if (!this.sseClients.get(msg.peerId)) {
            reply.status(400).send({
              type: "error",
              error: "Connect to /stream first",
            });
            return;
          }

          await this.callbacks.onReceive(this, msg.peerId, msg.data);
          reply.send({ success: true });
        } catch (error) {
          reply.status(500).send({
            type: "error",
            error: error instanceof Error ? error.message : "Unknown error",
          });
        }
      }
    );
  }

  private handleClientDisconnect(request: FastifyRequest): void {
    // Find the client by request object
    const client = [...this.sseClients.values()].find(
      (c) => c.reply.request === request
    );

    if (client) {
      // Clear ping timer if it exists
      if (client.pingTimer) {
        clearInterval(client.pingTimer);
      }

      this.sseClients.delete(client.peerId);
      debugTransport(`Client ${client.peerId} disconnected`);

      if (this.callbacks) {
        this.callbacks.onDisconnect(this, client.peerId).catch((error) => {
          debugTransport(`Error in onDisconnect for ${client.peerId}:`, error);
        });
      }
    }
  }

  private startPingTimer(peerId: string): void {
    const client = this.sseClients.get(peerId);
    if (!client) return;

    // Clear existing timer if any
    if (client.pingTimer) {
      clearInterval(client.pingTimer);
    }

    // Start new ping timer - send ping every 30 seconds
    client.pingTimer = setInterval(() => {
      try {
        this.sendSSEMessage(client.reply, {
          type: "ping",
          peerId: this.localPeerId!,
        });
        debugTransport(`Sent ping to ${peerId}`);
      } catch (error) {
        debugTransport(`Error sending ping to ${peerId}:`, error);
        // Clear timer and remove client on error
        if (client.pingTimer) {
          clearInterval(client.pingTimer);
        }
        this.sseClients.delete(peerId);
      }
    }, 30000); // 30 seconds
  }

  private sendSSEMessage(reply: FastifyReply, data: TransportMessage): void {
    const message = `data: ${JSON.stringify(data)}\n\n`;
    reply.raw.write(message);
  }

  // Transport interface methods
  async sync(peerId: string, localCursor: Cursor): Promise<void> {
    const client = this.sseClients.get(peerId);
    if (!client) {
      debugTransport(`Cannot sync with ${peerId}: client not connected`);
      return;
    }

    try {
      const message: TransportMessage = {
        type: "sync",
        peerId: this.localPeerId!,
        cursor: serializeCursor(localCursor),
      };
      this.sendSSEMessage(client.reply, message);
      debugTransport(`Sent sync to ${peerId}`);
    } catch (error) {
      debugTransport(`Error sending sync to ${peerId}:`, error);
      this.sseClients.delete(peerId);
    }
  }

  async send(peerId: string, message: PeerMessage): Promise<void> {
    const client = this.sseClients.get(peerId);
    if (!client) {
      debugTransport(`Cannot send to ${peerId}: client not connected`);
      return;
    }

    try {
      const transportMessage: TransportMessage = {
        type: "data",
        peerId: this.localPeerId!,
        data: message,
      };
      this.sendSSEMessage(client.reply, transportMessage);
      debugTransport(
        `Sent ${message.type} to ${peerId} with ${message.data.length} changes`
      );
    } catch (error) {
      debugTransport(`Error sending to ${peerId}:`, error);
      this.sseClients.delete(peerId);
    }
  }

  stop(): void {
    // Close all SSE connections and clear ping timers
    for (const [peerId, client] of this.sseClients.entries()) {
      try {
        // Clear ping timer
        if (client.pingTimer) {
          clearInterval(client.pingTimer);
        }
        client.reply.raw.end();
      } catch (error) {
        debugTransport(`Error closing client ${peerId}:`, error);
      }
    }
    this.sseClients.clear();
    this.callbacks = undefined;
    this.localPeerId = undefined;
    debugTransport("Transport stopped");
  }

  getConnectedClientsCount(): number {
    return this.sseClients.size;
  }

  getConnectedPeerIds(): string[] {
    return Array.from(this.sseClients.keys());
  }
}
