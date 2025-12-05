import fastify from "fastify";
import {
  TransportServerFastify,
  createDBNode,
  ensureEnv,
  getCurrentUser,
  getDBPath,
  getUserPath,
} from "@app/node";
import {
  DBInterface,
  KeepDb,
  KeepDbApi,
  NostrPeerStore,
  ChatStore,
} from "@app/db";
import {
  setEnv,
  getEnv,
  TaskWorker,
  Env,
  DEFAULT_AGENT_MODEL,
} from "@app/agent";
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
  publish,
} from "@app/sync";
import {
  UnsignedEvent,
  Event,
  getPublicKey,
  finalizeEvent,
  SimplePool,
} from "nostr-tools";
import { bytesToHex, hexToBytes } from "nostr-tools/utils";
import { randomBytes } from "crypto";

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

// Our hosted push server
const DEFAULT_PUSH_SERVER_PUBKEY =
  "e46b5c98fe12661a765ded00ca05866ea0b58bd175454aed703fba2589f6c666";

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
  EXTRA_SYSTEM_PROMPT: process.env.EXTRA_SYSTEM_PROMPT,
  DESKTOP_NOTIFICATIONS: process.env.DESKTOP_NOTIFICATIONS,
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

// Push notification handler
async function handlePushNotifications(
  pool: SimplePool,
  chatStore: ChatStore,
  peerStore: NostrPeerStore,
  keyStore: KeyStore,
  peer: Peer,
  lastMessageTime: number
): Promise<number> {
  try {
    // Get NOSTR_RELAYS and PUSH_SERVER_PUBKEY from environment
    const relays = getNostrRelays();
    const pushServerPubkey =
      process.env.PUSH_SERVER_PUBKEY || DEFAULT_PUSH_SERVER_PUBKEY;

    if (!pushServerPubkey) {
      debugServer(
        "PUSH_SERVER_PUBKEY not configured, skipping push notifications"
      );
      return lastMessageTime;
    }

    // Get messages from threadId='main' with createdAt > lastMessageTime
    const newMessages = await chatStore.getChatMessages({
      chatId: "main",
      since: new Date(lastMessageTime).toISOString(),
    });

    // Only notify about assistant messages
    const messages = newMessages.filter((m) => m.role === "assistant");

    if (messages.length === 0) {
      return lastMessageTime;
    }

    debugServer(`Found ${messages.length} new messages to push`);

    // Get all peers where local_id === peer.id
    const allPeers = await peerStore.listPeers();
    const relevantPeers = allPeers.filter((p) => p.local_id === peer.id);

    if (relevantPeers.length === 0) {
      debugServer("No relevant peers found for push notifications");
      return Date.now();
    }

    // For each message and each peer, send push notification
    for (const message of messages) {
      for (const peerRecord of relevantPeers) {
        try {
          const senderPubkey = peerRecord.local_pubkey; // sender_pubkey
          const receiverPubkey = peerRecord.peer_pubkey; // receiver_pubkey

          // Create 24683 event (the actual message payload)
          const messagePayload: UnsignedEvent = {
            kind: 24683,
            created_at: Math.floor(Date.now() / 1000),
            tags: [],
            content: await keyStore.encrypt({
              plaintext: JSON.stringify(message),
              senderPubkey: senderPubkey,
              receiverPubkey: receiverPubkey,
            }),
            pubkey: senderPubkey,
          };

          // Sign the 24683 event
          const signedMessagePayload = await keyStore.signEvent(messagePayload);

          // Create 24682 event (the push notification trigger)
          const pushEvent: UnsignedEvent = {
            kind: 24682,
            created_at: Math.floor(Date.now() / 1000),
            tags: [["p", pushServerPubkey]],
            content: await keyStore.encrypt({
              plaintext: JSON.stringify({
                receiver_pubkey: receiverPubkey,
                payload: JSON.stringify(signedMessagePayload),
              }),
              senderPubkey: senderPubkey,
              receiverPubkey: pushServerPubkey,
            }),
            pubkey: senderPubkey,
          };

          // Sign the 24682 event
          const signedPushEvent = await keyStore.signEvent(pushEvent);

          // Publish to relays
          await publish(signedPushEvent, pool, relays);

          debugServer(
            `Push notification sent for message ${message.id} to peer ${receiverPubkey}`
          );
        } catch (error) {
          debugServer(
            `Failed to send push notification for peer ${peerRecord.peer_pubkey}:`,
            error
          );
        }
      }
    }

    return Date.now();
  } catch (error) {
    debugServer("Error handling push notifications:", error);
    return lastMessageTime;
  }
}

// Test OpenRouter API key
async function testOpenRouterKey(
  apiKey: string,
  model: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const testResponse = await fetch(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: model || DEFAULT_AGENT_MODEL,
          messages: [
            {
              role: "user",
              content: "ping",
            },
          ],
        }),
      }
    );

    if (!testResponse.ok) {
      const errorData = await testResponse.text();
      return {
        success: false,
        error: `Invalid OpenRouter API key: ${errorData}`,
      };
    }

    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: `Failed to validate OpenRouter API key: ${
        error instanceof Error ? error.message : "Unknown error"
      }`,
    };
  }
}

// Test Exa.ai API key
async function testExaKey(
  apiKey: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const testResponse = await fetch("https://api.exa.ai/contents", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
      },
      body: JSON.stringify({
        ids: ["tesla.com"],
        text: true,
      }),
    });

    if (!testResponse.ok) {
      const errorData = await testResponse.text();
      return {
        success: false,
        error: `Invalid Exa.ai API key: ${errorData}`,
      };
    }

    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: `Failed to validate Exa.ai API key: ${
        error instanceof Error ? error.message : "Unknown error"
      }`,
    };
  }
}

interface ServerConfig {
  serveStaticFiles?: boolean;
  staticFilesRoot?: string;
  port?: number;
  host?: string;
}

export async function createServer(config: ServerConfig = {}) {
  // Track last message time for push notifications
  let lastMessageTime = Date.now();
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

  // For sync over nostr & web push
  const pool = new SimplePool({
    enablePing: true,
    enableReconnect: true,
  });
  const api = new KeepDbApi(keepDB);
  const peerStore = api.nostrPeerStore;
  const chatStore = api.chatStore;
  const keyStore = new KeyStore(path.join(userPath, "keys.db"));
  await keyStore.start();

  // Talks to peers over http server
  const http = new TransportServerFastify();
  const nostr = new NostrTransport({
    store: peerStore,
    signer: keyStore,
    pool,
  });

  const peer = new Peer(dbInstance, [http, nostr]);
  await peer.start();
  await http.start(peer.getConfig());
  await nostr.start(peer.getConfig());

  // Performs background operations
  const worker = await createReplWorker(keepDB);

  // Notify nostr transport if peer set changes
  peer.on("change", async (tables) => {
    if (tables.includes("nostr_peers")) nostr.updatePeers();
    if (tables.includes("tasks") || tables.includes("inbox"))
      worker.checkWork();

    // Handle push notifications when messages table changes
    if (tables.includes("messages")) {
      try {
        lastMessageTime = await handlePushNotifications(
          pool,
          chatStore,
          peerStore,
          keyStore,
          peer,
          lastMessageTime
        );
      } catch (error) {
        debugServer("Error in push notification handler:", error);
      }
    }
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

  app.get("/api/get_config", async (request, reply) => {
    const currentEnv = getEnv();
    reply.send({ env: currentEnv });
  });

  app.post("/api/set_config", async (request, reply) => {
    try {
      const body = request.body as Env;

      const wasOk = !!getEnv().OPENROUTER_API_KEY?.trim();

      if (!body.OPENROUTER_API_KEY?.trim()) {
        reply.status(400).send({ error: "OpenRouter API key is required" });
        return;
      }

      // Test the OpenRouter API key first
      const openRouterTest = await testOpenRouterKey(
        body.OPENROUTER_API_KEY,
        body.AGENT_MODEL || DEFAULT_AGENT_MODEL
      );

      if (!openRouterTest.success) {
        reply.status(400).send({
          error:
            openRouterTest.error || "Failed to validate OpenRouter API key",
        });
        return;
      }

      // Test Exa.ai API key if provided
      if (body.EXA_API_KEY && body.EXA_API_KEY.trim()) {
        const exaTest = await testExaKey(body.EXA_API_KEY);
        if (!exaTest.success) {
          reply.status(400).send({
            error: exaTest.error || "Failed to validate Exa.ai API key",
          });
          return;
        }
      }

      // Copy the current env
      const newEnv = getEnv();

      // Get current .env file
      let envContent = "";
      if (fs.existsSync(envPath)) {
        envContent = fs.readFileSync(envPath, "utf8");
      }

      // Helper
      const updateVar = (
        name:
          | "OPENROUTER_API_KEY"
          | "AGENT_MODEL"
          | "LANG"
          | "EXA_API_KEY"
          | "EXTRA_SYSTEM_PROMPT"
      ) => {
        if (body[name] === undefined) return;

        // Set in ram
        newEnv[name] = body[name];

        // Find & replace/append the .env row
        // For EXTRA_SYSTEM_PROMPT, escape newlines and double quotes for .env storage
        let envValue = newEnv[name];
        if (name === "EXTRA_SYSTEM_PROMPT" && envValue) {
          envValue = `"${
            envValue
              .replace(/\\/g, "\\\\") // Escape backslashes first
              .replace(/"/g, '\\"') // Escape double quotes
              .replace(/\n/g, "\\n") // Escape newlines
          }"`;
        }
        const row = `${name}=${envValue}`;
        let found = false;
        const lines = envContent.split("\n");
        for (let i = 0; i < lines.length; i++) {
          if (lines[i].startsWith(name + "=")) {
            lines[i] = row;
            found = true;
          }
        }

        // Append?
        if (!found) lines.push(row);

        // Format the content
        envContent = lines.join("\n");

        // Also update the global env used by this server instance
        process.env[name] = newEnv[name];
      };

      // Update each var
      updateVar("OPENROUTER_API_KEY");
      updateVar("AGENT_MODEL");
      updateVar("LANG");
      updateVar("EXA_API_KEY");
      updateVar("EXTRA_SYSTEM_PROMPT");
      updateVar("DESKTOP_NOTIFICATIONS");

      // Set globally
      setEnv(newEnv);
      console.log("newEnv", newEnv);

      // Write updated .env file
      fs.writeFileSync(envPath, envContent, "utf8");

      // First good config?
      if (!wasOk) {
        const messages = await api.chatStore.getChatMessages({
          chatId: "main",
        });
        // First launch?
        if (!messages.length) {
          const id = bytesToHex(randomBytes(16));
          await api.inboxStore.saveInbox({
            id,
            source: "worker",
            source_id: "",
            target: "replier",
            target_id: "",
            timestamp: "",
            handler_thread_id: "",
            handler_timestamp: "",
            content: JSON.stringify({
              id,
              role: "system",
              content: `This is user onboarding synthetic instruction-draft for replier: please greet the user, tell them 'who you are' in their preferred language and ask how you could be helpful. We rely on your, Replier's, common sense to prepare the first ever message that user will see from us.`,
            }),
          });
        }
      }

      reply.send({ ok: true });
    } catch (error) {
      debugServer("Error in /api/set_config:", error);
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

      // Get OS information using Node.js
      const getOSInfo = (): string => {
        const platform = os.platform();
        const release = os.release();
        const arch = os.arch();

        let osName: string;
        switch (platform) {
          case "win32":
            osName = "Windows";
            break;
          case "darwin":
            osName = "macOS";
            break;
          case "linux":
            osName = "Linux";
            break;
          case "freebsd":
            osName = "FreeBSD";
            break;
          case "openbsd":
            osName = "OpenBSD";
            break;
          default:
            osName = platform;
        }

        return `${osName} ${release} (${arch})`;
      };

      const deviceInfo = getOSInfo();

      // Launch listen() asynchronously - don't wait for it to complete
      (async () => {
        try {
          const result = await connector.listen(
            connectionInfo,
            peer.id,
            deviceInfo
          );
          debugServer("NostrConnector listen completed:", {
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

          // Make sure peer is noticed
          await peer.checkLocalChanges();
        } catch (error) {
          debugServer("NostrConnector listen failed:", error);
        }
      })();

      // Return connection string to client
      reply.send({ str: connectionInfo.str });
    } catch (error) {
      debugServer("Error in /api/connect:", error);
      reply.status(500).send({
        error: "Failed to create connection string",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  // Add /api/id endpoint to return site_id as hex
  app.get("/api/id", async (request, reply) => {
    try {
      const result = await dbInstance.execO<{ site_id: Buffer }>(
        "SELECT crsql_site_id() as site_id"
      );

      if (!result || result.length === 0) {
        reply.status(500).send({ error: "Failed to get site_id" });
        return;
      }

      // Convert binary site_id to hex
      const siteIdBuffer = result[0].site_id;
      const siteIdHex = bytesToHex(new Uint8Array(siteIdBuffer));

      reply.send({ site_id: siteIdHex });
    } catch (error) {
      debugServer("Error in /api/id:", error);
      reply.status(500).send({
        error: "Failed to get site_id",
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
      const port =
        options.port || config.port || Number(process.env.PORT || 3000);
      const host = options.host || config.host || "0.0.0.0";

      await app.listen({ port, host });
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
    },
  };
}
