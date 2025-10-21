import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { CRSqliteWorkerAPI } from "@app/worker";
import { BroadcastMessage, WorkerMessage } from "@app/worker";
import { DBInterface } from "@app/db";
import debug from "debug";

const debugCRSqliteWorkerFastify = debug("node:CRSqliteWorkerFastify");

interface SSEClient {
  reply: FastifyReply;
  id: string;
}

export class CRSqliteWorkerFastify {
  private api: CRSqliteWorkerAPI;
  private sseClients: Set<SSEClient> = new Set();
  private clientIdCounter = 0;

  constructor(db: DBInterface | (() => DBInterface)) {
    this.api = new CRSqliteWorkerAPI(db, async (msg) =>
      this.broadcastToClients(msg)
    );
  }

  async registerRoutes(fastify: FastifyInstance): Promise<void> {
    // POST /sync endpoint
    fastify.post(
      "/sync",
      async (request: FastifyRequest, reply: FastifyReply) => {
        try {
          const msg = request.body as WorkerMessage;
          const response = await this.api.sync(msg);
          reply.send(response);
        } catch (error) {
          reply.status(400).send({
            type: "error",
            error: error instanceof Error ? error.message : "Unknown error",
          });
        }
      }
    );

    // POST /exec endpoint
    fastify.post(
      "/exec",
      async (request: FastifyRequest, reply: FastifyReply) => {
        try {
          const msg = request.body as WorkerMessage;
          const response = await this.api.exec(msg);
          reply.send(response);
        } catch (error) {
          reply.status(400).send({
            type: "error",
            error: error instanceof Error ? error.message : "Unknown error",
          });
        }
      }
    );

    // POST /changes endpoint
    fastify.post(
      "/changes",
      async (request: FastifyRequest, reply: FastifyReply) => {
        try {
          const msg = request.body as BroadcastMessage;
          await this.api.changes(msg);
          reply.send({ success: true });
        } catch (error) {
          reply.status(400).send({
            type: "error",
            error: error instanceof Error ? error.message : "Unknown error",
          });
        }
      }
    );

    // GET /broadcast endpoint (SSE)
    fastify.get(
      "/broadcast",
      async (request: FastifyRequest, reply: FastifyReply) => {
        const clientId = `client-${++this.clientIdCounter}`;

        reply.raw.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Headers": "Cache-Control",
        });

        const client: SSEClient = {
          reply,
          id: clientId,
        };

        this.sseClients.add(client);

        // Send initial connection event
        this.sendSSEMessage(reply, {
          type: "connected",
          data: { clientId },
        });

        // Handle client disconnect
        request.raw.on("close", () => {
          this.sseClients.delete(client);
          debugCRSqliteWorkerFastify(`Client ${clientId} disconnected`);
        });

        request.raw.on("error", () => {
          this.sseClients.delete(client);
          debugCRSqliteWorkerFastify(`Client ${clientId} error`);
        });

        debugCRSqliteWorkerFastify(`Client ${clientId} connected to SSE`);
      }
    );
  }

  private broadcastToClients(message: BroadcastMessage): void {
    debugCRSqliteWorkerFastify(`Broadcasting to ${this.sseClients.size} clients:`, message);

    const clientsToRemove: SSEClient[] = [];

    for (const client of this.sseClients) {
      try {
        this.sendSSEMessage(client.reply, message);
      } catch (error) {
        debugCRSqliteWorkerFastify(`Error sending to client ${client.id}:`, error);
        clientsToRemove.push(client);
      }
    }

    // Remove failed clients
    for (const client of clientsToRemove) {
      this.sseClients.delete(client);
    }
  }

  private sendSSEMessage(reply: FastifyReply, data: any): void {
    const message = `data: ${JSON.stringify(data)}\n\n`;
    reply.raw.write(message);
  }

  async start(): Promise<void> {
    await this.api.start();
  }

  stop(): void {
    // Close all SSE connections
    for (const client of this.sseClients) {
      try {
        client.reply.raw.end();
      } catch (error) {
        debugCRSqliteWorkerFastify(`Error closing client ${client.id}:`, error);
      }
    }
    this.sseClients.clear();

    this.api.stop();
  }

  getConnectedClientsCount(): number {
    return this.sseClients.size;
  }
}