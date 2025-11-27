import fastify from "fastify";
import {
  TransportServerFastify,
  createDBNode,
  ensureEnv,
  getCurrentUser,
  getDBPath,
  getUserPath,
} from "@app/node";
import { DBInterface, KeepDb, KeepDbApi, NostrPeerStore } from "@app/db";
import { setEnv, getEnv, TaskWorker } from "@app/agent";
import debug from "debug";
import path from "path";
import os from "os";
import fs from "fs";
import dotenv from "dotenv";
import {
  NostrSigner,
  NostrTransport,
  Peer,
  NostrConnector,
  nip44_v3,
} from "@app/sync";
import { UnsignedEvent, Event, getPublicKey, finalizeEvent } from "nostr-tools";
import { bytesToHex, hexToBytes } from "nostr-tools/utils";

const debugServer = debug("server:server");

// Setup configuration directory and environment
const configDir = path.join(os.homedir(), ".keep.ai");
const envPath = path.join(configDir, ".env");

// Ensure config directory exists
if (!fs.existsSync(configDir)) {
  fs.mkdirSync(configDir, { recursive: true });
}

// Load environment variables from ~/.keep.ai/.env
if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath });
}

// Parse NOSTR_RELAYS environment variable
const getNostrRelays = (): string[] => {
  const relaysEnv = process.env.NOSTR_RELAYS;
  if (!relaysEnv) {
    // Default relays if not configured
    return ["wss://relay1.getkeep.ai", "wss://relay2.getkeep.ai"];
  }
  return relaysEnv
    .split(",")
    .map((relay) => relay.trim())
    .filter((relay) => relay.length > 0);
};

// Set environment in agent package
setEnv({
  OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
  OPENROUTER_BASE_URL: process.env.OPENROUTER_BASE_URL,
  AGENT_MODEL: process.env.AGENT_MODEL,
  EXA_API_KEY: process.env.EXA_API_KEY,
});

// For CommonJS compatibility
const __dirname = process.cwd();

async function createReplWorker(keepDB: KeepDb) {
  const worker = new TaskWorker({
    api: new KeepDbApi(keepDB),
    stepLimit: 20,
  });

  return worker;
}

class KeyStore implements NostrSigner {
  private readonly dbPath: string;
  private db?: DBInterface;
  private keys = new Map<string, Uint8Array>();

  constructor(dbPath: string) {
    this.dbPath = dbPath;
  }

  async start() {
    this.db = await createDBNode(this.dbPath);

    // Create keys table if it doesn't exist
    await this.db.exec(`
      CREATE TABLE IF NOT EXISTS keys (
        pubkey TEXT NOT NULL PRIMARY KEY,
        key TEXT NOT NULL,
        timestamp TEXT NOT NULL
      )
    `);

    // Read existing keys from database
    const results = await this.db.execO<{
      pubkey: string;
      key: string;
      timestamp: string;
    }>("SELECT pubkey, key, timestamp FROM keys");

    if (results) {
      for (const row of results) {
        const keyBytes = hexToBytes(row.key);
        this.keys.set(row.pubkey, keyBytes);
      }
    }
  }

  async stop() {
    return this.db?.close();
  }

  async addKey(key: Uint8Array) {
    const pubkey = getPublicKey(key);
    this.keys.set(pubkey, key);

    // Write to database
    const keyHex = bytesToHex(key);
    const timestamp = new Date().toISOString();

    await this.db!.exec(
      "INSERT OR REPLACE INTO keys (pubkey, key, timestamp) VALUES (?, ?, ?)",
      [pubkey, keyHex, timestamp]
    );
  }

  key(pubkey: string): Uint8Array {
    const key = this.keys.get(pubkey);
    if (!key) throw new Error("No key for pubkey " + pubkey);
    return key;
  }

  async signEvent(event: UnsignedEvent): Promise<Event> {
    return finalizeEvent(event, this.key(event.pubkey));
  }

  async encrypt(req: {
    plaintext: string;
    receiverPubkey: string;
    senderPubkey: string;
  }): Promise<string> {
    const conversationKey = nip44_v3.getConversationKey(
      this.key(req.senderPubkey),
      req.receiverPubkey
    );
    return nip44_v3.encrypt(req.plaintext, conversationKey);
  }

  async decrypt(req: {
    ciphertext: string;
    receiverPubkey: string;
    senderPubkey: string;
  }): Promise<string> {
    const conversationKey = nip44_v3.getConversationKey(
      this.key(req.receiverPubkey),
      req.senderPubkey
    );
    return nip44_v3.decrypt(req.ciphertext, conversationKey);
  }
}

interface ServerConfig {
  serveStaticFiles?: boolean;
  staticFilesRoot?: string;
  port?: number;
  host?: string;
}

export async function createServer(config: ServerConfig = {}) {
  const app = fastify({ logger: true });

  await ensureEnv();
  
  const pubkey = await getCurrentUser();
  const userPath = getUserPath(pubkey);
  const dbPath = getDBPath(pubkey);

  debugServer("Config directory:", configDir);
  debugServer("Database path:", dbPath);
  debugServer("Environment file:", envPath);

  // Init db
  const dbInstance = await createDBNode(dbPath);
  const keepDB = new KeepDb(dbInstance);
  await keepDB.start();

  // For sync over nostr
  const peerStore = new NostrPeerStore(keepDB);
  const keyStore = new KeyStore(path.join(userPath, "keys.db"));
  await keyStore.start();

  // Talks to peers over http server
  const http = new TransportServerFastify();
  const nostr = new NostrTransport({
    store: peerStore,
    signer: keyStore,
  });

  const peer = new Peer(dbInstance, [http, nostr]);
  await peer.start();
  await http.start(peer.getConfig());
  await nostr.start(peer.getConfig());

  // Performs background operations
  const worker = await createReplWorker(keepDB);

  // Notify nostr transport if peer set changes
  peer.on("change", (tables) => {
    if (tables.includes("nostr_peers")) nostr.updatePeers();
    if (tables.includes("tasks") || tables.includes("inbox"))
      worker.checkWork();
  });

  // Start checking timestamped tasks
  worker.start();

  // Check regularly for changes
  // FIXME call it on every mutation endpoint
  const check = async () => {
    await peer.checkLocalChanges();
    setTimeout(check, 1000);
  };
  check();

  // Register worker routes under /api/worker prefix
  await app.register(
    async function (fastify) {
      // @ts-ignore
      await http.registerRoutes(fastify);
    },
    { prefix: "/api/worker" }
  );

  app.get("/api/check_config", async (request, reply) => {
    const currentEnv = getEnv();
    const ok = !!currentEnv.OPENROUTER_API_KEY?.trim();
    reply.send({ ok });
  });

  app.post("/api/set_config", async (request, reply) => {
    try {
      const body = request.body as { openrouterApiKey?: string };
      
      if (!body.openrouterApiKey?.trim()) {
        reply.status(400).send({ error: "OpenRouter API key is required" });
        return;
      }

      // Test the API key first
      try {
        const testResponse = await fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${body.openrouterApiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: 'openai/gpt-oss-120b',
            messages: [
              {
                role: 'user',
                content: 'ping',
              },
            ],
          }),
        });

        if (!testResponse.ok) {
          const errorData = await testResponse.text();
          reply.status(400).send({
            error: "Invalid OpenRouter API key",
            details: errorData
          });
          return;
        }
      } catch (testError) {
        reply.status(400).send({
          error: "Failed to validate OpenRouter API key",
          details: testError instanceof Error ? testError.message : 'Unknown error'
        });
        return;
      }

      // Update the current env object
      const newEnv = getEnv();
      newEnv.OPENROUTER_API_KEY = body.openrouterApiKey;
      setEnv(newEnv);

      // Handle .env file: find OPENROUTER_API_KEY line and replace it, or append if not found
      let envContent = '';
      let foundApiKey = false;
      
      if (fs.existsSync(envPath)) {
        envContent = fs.readFileSync(envPath, 'utf8');
        const lines = envContent.split('\n');
        
        for (let i = 0; i < lines.length; i++) {
          if (lines[i].startsWith('OPENROUTER_API_KEY=')) {
            lines[i] = `OPENROUTER_API_KEY=${body.openrouterApiKey}`;
            foundApiKey = true;
          }
        }
        
        envContent = lines.join('\n');
      }
      
      // If OPENROUTER_API_KEY wasn't found, append it
      if (!foundApiKey) {
        if (envContent && !envContent.endsWith('\n')) {
          envContent += '\n';
        }
        envContent += `OPENROUTER_API_KEY=${body.openrouterApiKey}\n`;
      }

      // Write updated .env file
      fs.writeFileSync(envPath, envContent, 'utf8');

      // Also update the global env used by this server instance
      process.env.OPENROUTER_API_KEY = body.openrouterApiKey;

      reply.send({ ok: true });
    } catch (error) {
      console.error("Error in /api/set_config:", error);
      reply.status(500).send({
        error: "Failed to save configuration",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  // Add /api/connect endpoint
  app.post("/api/connect", async (request, reply) => {
    try {
      // Get relays from environment
      const relays = getNostrRelays();

      // Create NostrConnector instance
      const connector = new NostrConnector();

      // Generate connection string
      const connectionInfo = await connector.generateConnectionString(relays);

      // Device info placeholder
      const deviceInfo = "test info";

      // Launch listen() asynchronously - don't wait for it to complete
      (async () => {
        try {
          const result = await connector.listen(
            connectionInfo,
            peer.id,
            deviceInfo
          );
          console.log("NostrConnector listen completed:", {
            peer_pubkey: result.peer_pubkey,
            peer_id: result.peer_id,
            peer_device_info: result.peer_device_info,
            relays: result.relays,
          });

          // Write to key store
          await keyStore.addKey(result.key);

          // Write the peer info
          await peerStore.addPeer({
            peer_pubkey: result.peer_pubkey,
            peer_id: result.peer_id,
            device_info: result.peer_device_info,
            local_pubkey: getPublicKey(result.key),
            relays: relays.join(","),
            local_id: peer.id,
            timestamp: "",
          });
        } catch (error) {
          console.error("NostrConnector listen failed:", error);
        }
      })();

      // Return connection string to client
      reply.send({ str: connectionInfo.str });
    } catch (error) {
      console.error("Error in /api/connect:", error);
      reply.status(500).send({
        error: "Failed to create connection string",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  // Conditionally serve static files and SPA fallback
  if (config.serveStaticFiles) {
    const staticRoot = config.staticFilesRoot || path.join(__dirname, "public");
    
    // Serve static files from public directory
    await app.register(require("@fastify/static"), {
      root: staticRoot,
      prefix: "/",
    });

    // SPA fallback - serve index.html for all non-API routes
    app.setNotFoundHandler((request, reply) => {
      // Don't serve index.html for API routes
      if (request.url.startsWith("/api/")) {
        reply.status(404).send({ error: "API endpoint not found" });
        return;
      }

      // Serve index.html for SPA routes
      // @ts-ignore
      reply.sendFile("index.html");
    });
  }

  return {
    app,
    async listen(options: { port?: number; host?: string } = {}) {
      const port = options.port || config.port || Number(process.env.PORT || 3000);
      const host = options.host || config.host || "0.0.0.0";
      
      await app.listen({ port, host });
      console.log("listening");
      debugServer("Server listening on port", port);
      debugServer("API available at /api/worker/*");
      if (config.serveStaticFiles) {
        debugServer("SPA served from /");
      }
      return { port, host };
    },
    async close() {
      await app.close();
      await keyStore.stop();
    }
  };
}

