import fastify, { FastifyRequest } from "fastify";
import {
  TransportServerFastify,
  createDBNode,
  ensureEnv,
  getCurrentUser,
  getDBPath,
  getUserPath,
  getDefaultCompression,
  storeFileData,
} from "@app/node";
import {
  DBInterface,
  KeepDb,
  KeepDbApi,
  NostrPeerStore,
  ChatStore,
  FileStore,
  type File,
} from "@app/db";

import multipart, { MultipartFile } from "@fastify/multipart";
// import { MultipartFile } from "@fastify/multipart";

import {
  setEnv,
  getEnv,
  TaskScheduler,
  WorkflowScheduler,
  Env,
  DEFAULT_AGENT_MODEL,
  setEnvFromProcess,
} from "@app/agent";
import debug from "debug";
import path from "path";
import os from "os";
import fs from "fs";
import { promises as fsPromises } from "fs";
import dotenv from "dotenv";
import {
  NostrSigner,
  NostrTransport,
  Peer,
  NostrConnector,
  nip44_v3,
  publish,
  FileSender,
  FileReceiver,
  getStreamFactory,
  DEFAULT_RELAYS,
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
import { google } from "googleapis";

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

// Gmail OAuth configuration
const GMAIL_CLIENT_ID =
  "642393276548-lfrhhkuf7nfuo6o3542tmibj8306a17m.apps.googleusercontent.com";
const GMAIL_CLIENT_SECRET =
  process.env.GMAIL_SECRET || process.env.BUILD_GMAIL_SECRET;

// Backend server configuration for user authentication and API key management
const BACKEND_SERVER_URL = "https://api.getkeep.ai";

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
setEnvFromProcess(process.env);

// For CommonJS compatibility
const __dirname = process.cwd();

async function createGmailOAuth2Client(userPath: string) {
  try {
    if (!GMAIL_CLIENT_SECRET) {
      return null;
    }

    const gmailTokenPath = path.join(userPath, "gmail.json");

    if (!fs.existsSync(gmailTokenPath)) {
      return null;
    }

    // Load stored tokens
    const tokenData = await fsPromises.readFile(gmailTokenPath, "utf8");
    const tokens = JSON.parse(tokenData);

    // Create OAuth client with stored tokens
    const oAuth2Client = new google.auth.OAuth2(
      GMAIL_CLIENT_ID,
      GMAIL_CLIENT_SECRET
    );
    oAuth2Client.setCredentials(tokens);

    // Listen for token refresh events and save new tokens
    oAuth2Client.on("tokens", async (newTokens) => {
      try {
        debugServer("Gmail OAuth2 tokens refreshed, saving to file");

        // Read current tokens from file
        let currentTokens = tokens;
        try {
          const currentTokenData = await fsPromises.readFile(
            gmailTokenPath,
            "utf8"
          );
          currentTokens = JSON.parse(currentTokenData);
        } catch (readError) {
          debugServer(
            "Could not read current tokens, using initial tokens:",
            readError
          );
        }

        // Update tokens
        if (newTokens.refresh_token) {
          debugServer("Saving new refresh token");
          currentTokens.refresh_token = newTokens.refresh_token;
        }
        if (newTokens.access_token) {
          debugServer("Saving new access token + expiry_date");
          currentTokens.access_token = newTokens.access_token;
          if (newTokens.expiry_date) {
            currentTokens.expiry_date = newTokens.expiry_date;
          }
        }

        // Save updated tokens back to file
        await fsPromises.writeFile(
          gmailTokenPath,
          JSON.stringify(currentTokens, null, 2),
          { mode: 0o600 }
        );

        debugServer("Gmail tokens successfully saved to file");
      } catch (saveError) {
        debugServer("Failed to save refreshed Gmail tokens:", saveError);
      }
    });

    return oAuth2Client;
  } catch (error) {
    debugServer("Failed to create Gmail OAuth2 client:", error);
    return null;
  }
}

async function createScheduler(keepDB: KeepDb, userPath: string) {
  const gmailOAuth2Client = await createGmailOAuth2Client(userPath);

  const taskScheduler = new TaskScheduler({
    api: new KeepDbApi(keepDB),
    stepLimit: 20,
    userPath,
    gmailOAuth2Client,
  });

  const workflowScheduler = new WorkflowScheduler({
    api: new KeepDbApi(keepDB),
    userPath,
    gmailOAuth2Client,
  });

  return { taskScheduler, workflowScheduler };
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
  model: string,
  baseUrl?: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const testResponse = await fetch(
      `${baseUrl ? baseUrl : "https://openrouter.ai"}/api/v1/chat/completions`,
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
  const fileStore = new FileStore(keepDB);
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
  const { taskScheduler, workflowScheduler } = await createScheduler(
    keepDB,
    userPath
  );

  // File transfer instances for each peer
  const fileSenders = new Map<string, FileSender>();
  const fileReceivers = new Map<string, FileReceiver>();

  // Helper function to handle file download requests
  const handleDownload = async (
    downloadId: string,
    file_path: string,
    peerPubkey: string
  ) => {
    debugServer(
      "Download requested for file:",
      file_path,
      "by peer:",
      peerPubkey
    );

    try {
      // Extract file ID from file_path (remove extension)
      const fileId = path.basename(file_path, path.extname(file_path));

      // Get file info from fileStore using the fileId
      const fileRecord = await fileStore.getFile(fileId);
      if (!fileRecord) {
        debugServer("File not found:", file_path);
        return;
      }

      // Get the full file path
      const filesDir = path.join(userPath, "files");
      const fullFilePath = path.join(filesDir, fileRecord.path);

      if (!fs.existsSync(fullFilePath)) {
        debugServer("File not found on disk:", fullFilePath);
        return;
      }

      // Create file reader stream
      const fileStream = fs.createReadStream(fullFilePath);

      // Convert to async iterable
      async function* fileIterator() {
        for await (const chunk of fileStream) {
          yield new Uint8Array(chunk);
        }
      }

      // Get the file sender for this peer
      const sender = fileSenders.get(peerPubkey);
      if (!sender) {
        debugServer("No file sender found for peer:", peerPubkey);
        return;
      }

      // Upload the file
      await sender.upload(
        { filename: fileRecord.name, mimeType: fileRecord.media_type },
        fileIterator(),
        downloadId
      );
      debugServer("File uploaded successfully:", fileRecord.name);
    } catch (error) {
      debugServer("Error handling download request:", error);
    }
  };

  // Helper function to handle file uploads from peers
  const handleUpload = async (
    filename: string,
    stream: AsyncIterable<string | Uint8Array>
  ) => {
    debugServer("Upload received:", filename);

    try {
      let totalSize = 0;
      const chunks: Buffer[] = [];

      // Read all chunks from stream
      for await (const chunk of stream) {
        const buffer =
          chunk instanceof Uint8Array
            ? Buffer.from(chunk)
            : Buffer.from(chunk, "utf-8");
        chunks.push(buffer);
        totalSize += buffer.length;

        // Same size limit as HTTP uploads
        if (totalSize > 10 * 1024 * 1024) {
          throw new Error("File size exceeds limit");
        }
      }

      const fileBuffer = Buffer.concat(chunks);

      // Use shared storage logic
      const fileRecord = await storeFileData(
        fileBuffer,
        filename,
        userPath,
        fileStore
      );
      debugServer("File uploaded via nostr:", fileRecord);

      return fileRecord;
    } catch (error) {
      debugServer("Error handling upload:", error);
      throw error;
    }
  };

  // Setup file transfer for each peer
  const setupFileTransfer = async () => {
    try {
      // Clear existing instances
      for (const sender of fileSenders.values()) {
        sender.stop();
      }
      for (const receiver of fileReceivers.values()) {
        receiver.stop();
      }
      fileSenders.clear();
      fileReceivers.clear();

      // Get all peers for this device
      const allPeers = await peerStore.listPeers();
      const devicePeers = allPeers.filter((p) => p.local_id === peer.id);

      debugServer("Setting up file transfer for", devicePeers.length, "peers");

      // Setup stream factory with compression
      const streamFactory = getStreamFactory();
      streamFactory.compression = getDefaultCompression();

      for (const peerRow of devicePeers) {
        const { peer_pubkey, local_pubkey } = peerRow;

        // Create file sender
        const sender = new FileSender({
          signer: keyStore,
          pool,
          factory: streamFactory,
          compression: "none", // Let the factory handle compression
          encryption: "nip44_v3",
          localPubkey: local_pubkey,
          peerPubkey: peer_pubkey,
          relays: DEFAULT_RELAYS,
        });

        // Create file receiver
        const receiver = new FileReceiver({
          signer: keyStore,
          pool,
          factory: streamFactory,
          localPubkey: local_pubkey,
          peerPubkey: peer_pubkey,
          onUpload: handleUpload,
          relays: DEFAULT_RELAYS,
        });

        // Start both sender and receiver
        sender.start((downloadId: string, file_path: string) =>
          handleDownload(downloadId, file_path, peer_pubkey)
        );
        receiver.start();

        // Store instances
        fileSenders.set(peer_pubkey, sender);
        fileReceivers.set(peer_pubkey, receiver);

        debugServer("File transfer setup for peer:", peer_pubkey);
      }
    } catch (error) {
      debugServer("Error setting up file transfer:", error);
    }
  };

  // Initial setup
  await setupFileTransfer();

  // Notify nostr transport if peer set changes
  peer.on("change", async (tables) => {
    if (tables.includes("nostr_peers")) {
      // Update both nostr transport and file transfer
      nostr.updatePeers();
      await setupFileTransfer();
    }
    if (tables.includes("tasks") || tables.includes("inbox"))
      taskScheduler.checkWork();

    if (tables.includes("workflows") || tables.includes("scripts"))
      workflowScheduler.checkWork();

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

  // Start checking tasks and workflows
  taskScheduler.start();
  workflowScheduler.start();

  // Helper to trigger sync after local mutations
  // This is non-blocking to avoid slowing down the request/response cycle
  const triggerLocalSync = () => {
    peer.checkLocalChanges().catch((error) => {
      debugServer("Error checking local changes:", error);
    });
  };

  // Check regularly for changes (fallback for any edge cases)
  // Now with a longer interval since mutations trigger sync immediately
  const check = async () => {
    await peer.checkLocalChanges();
    setTimeout(check, 5000);
  };
  check();

  // Register multipart plugin for file uploads
  await app.register(multipart, {
    limits: {
      fileSize: 10 * 1024 * 1024, // 10MB limit
    },
  });

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
    return reply.send({ ok });
  });

  app.get("/api/get_config", async (request, reply) => {
    const currentEnv = getEnv();
    return reply.send({ env: currentEnv });
  });

  app.post("/api/set_config", async (request, reply) => {
    try {
      const body = request.body as Env;

      const wasOk = !!getEnv().OPENROUTER_API_KEY?.trim();

      if (!body.OPENROUTER_API_KEY?.trim()) {
        return reply
          .status(400)
          .send({ error: "OpenRouter API key is required" });
      }

      // Test the OpenRouter API key first
      const openRouterTest = await testOpenRouterKey(
        body.OPENROUTER_API_KEY,
        body.AGENT_MODEL || DEFAULT_AGENT_MODEL
      );

      if (!openRouterTest.success) {
        return reply.status(400).send({
          error:
            openRouterTest.error || "Failed to validate OpenRouter API key",
        });
      }

      // Test Exa.ai API key if provided
      if (body.EXA_API_KEY && body.EXA_API_KEY.trim()) {
        const exaTest = await testExaKey(body.EXA_API_KEY);
        if (!exaTest.success) {
          return reply.status(400).send({
            error: exaTest.error || "Failed to validate Exa.ai API key",
          });
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
          | "DESKTOP_NOTIFICATIONS"
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
            source: "user",
            source_id: "",
            target: "worker",
            target_id: "",
            timestamp: "",
            handler_thread_id: "",
            handler_timestamp: "",
            content: JSON.stringify({
              id,
              role: "user",
              parts: [
                {
                  type: "text",
                  text: `User has just started using the AI assistant and need onboarding: greet the user, tell them 'who you are' in their preferred language and ask how you could be helpful. Rely on your common sense to prepare the first ever message that user will see from the AI assistant.`,
                },
              ],
              metadata: {
                createdAt: new Date().toISOString(),
              },
            }),
          });
          // Trigger sync immediately after inbox write
          triggerLocalSync();
        }
      }

      return reply.send({ ok: true });
    } catch (error) {
      debugServer("Error in /api/set_config:", error);
      return reply.status(500).send({
        error: "Failed to save configuration",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  // Endpoint to fetch API key from backend server using Clerk JWT
  app.post("/api/fetch_api_key_from_backend", async (request, reply) => {
    try {
      const body = request.body as {
        jwtToken: string;
      };

      if (!body.jwtToken) {
        return reply.status(400).send({ error: "JWT token is required" });
      }

      debugServer("Fetching API key from backend:", BACKEND_SERVER_URL);

      // Call the backend server to get the API key
      const backendResponse = await fetch(
        `${BACKEND_SERVER_URL}/api/v1/api-key`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${body.jwtToken}`,
            "Content-Type": "application/json",
          },
        }
      );

      if (!backendResponse.ok) {
        const errorText = await backendResponse.text();
        debugServer("Backend API error:", errorText);
        let errorMessage = "Failed to fetch API key from backend server";
        try {
          const errorData = JSON.parse(errorText);
          errorMessage = errorData.error || errorMessage;
        } catch {
          // Use default error message if parsing fails
        }
        return reply.status(backendResponse.status).send({
          error: errorMessage,
        });
      }

      const backendText = await backendResponse.text();
      let backendData: any;
      try {
        backendData = JSON.parse(backendText);
      } catch (e) {
        return reply
          .status(500)
          .send({ error: "Invalid response from backend server" });
      }

      // Validate the received API key
      if (!backendData.apiKey) {
        return reply
          .status(400)
          .send({ error: "No API key received from backend" });
      }

      // Test the API key before saving
      const openRouterTest = await testOpenRouterKey(
        backendData.apiKey,
        getEnv().AGENT_MODEL || DEFAULT_AGENT_MODEL,
        BACKEND_SERVER_URL
      );

      if (!openRouterTest.success) {
        return reply.status(400).send({
          error: `Invalid API key received from backend: ${openRouterTest.error}`,
        });
      }

      // Copy the current env
      const newEnv = getEnv();

      // Get current .env file
      let envContent = "";
      if (fs.existsSync(envPath)) {
        envContent = fs.readFileSync(envPath, "utf8");
      }

      // Set the API key
      newEnv.OPENROUTER_API_KEY = backendData.apiKey;
      newEnv.OPENROUTER_BASE_URL = BACKEND_SERVER_URL + "/api/v1";

      // Update the .env file
      const updateVar = (
        name: "OPENROUTER_API_KEY" | "OPENROUTER_BASE_URL"
      ) => {
        const value = newEnv[name];
        if (!value) return;

        const row = `${name}=${value}`;
        let found = false;
        const lines = envContent.split("\n");
        for (let i = 0; i < lines.length; i++) {
          if (lines[i].startsWith(name + "=")) {
            lines[i] = row;
            found = true;
          }
        }

        // Append if not found
        if (!found) lines.push(row);

        // Format the content
        envContent = lines.join("\n");

        // Also update the global env used by this server instance
        process.env[name] = value;
      };

      updateVar("OPENROUTER_API_KEY");
      updateVar("OPENROUTER_BASE_URL");

      // Set globally
      setEnv(newEnv);

      // Write updated .env file
      fs.writeFileSync(envPath, envContent, "utf8");

      return reply.send({
        success: true,
        apiKey: backendData.apiKey,
      });
    } catch (error) {
      debugServer("Error in /api/fetch_api_key_from_backend:", error);
      return reply.status(500).send({
        error: "Failed to fetch API key from backend",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  // Gmail integration endpoints
  app.get("/api/gmail/status", async (request, reply) => {
    try {
      const gmailTokenPath = path.join(userPath, "gmail.json");
      const isConnected = fs.existsSync(gmailTokenPath);
      return reply.send({ connected: isConnected });
    } catch (error) {
      debugServer("Error in /api/gmail/status:", error);
      return reply.status(500).send({
        error: "Failed to check Gmail status",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  app.post("/api/gmail/connect", async (request, reply) => {
    try {
      if (!GMAIL_CLIENT_SECRET) {
        debugServer("Gmail client secret not configured");
        return reply.status(500).send({
          error: "Gmail client secret not configured",
        });
      }

      debugServer("gmail connect request url", request.url);
      const redirectUri = `${request.protocol}://${request.hostname}${
        request.hostname === "localhost" ? `:${process.env.PORT || 3000}` : ""
      }/api/gmail/callback`;
      debugServer("redirectUri", redirectUri);

      const oAuth2Client = new google.auth.OAuth2(
        GMAIL_CLIENT_ID,
        GMAIL_CLIENT_SECRET,
        redirectUri
      );

      const authUrl = oAuth2Client.generateAuthUrl({
        access_type: "offline",
        scope: ["https://www.googleapis.com/auth/gmail.modify"],
        prompt: "consent",
      });

      return reply.send({ authUrl });
    } catch (error) {
      debugServer("Error in /api/gmail/connect:", error);
      return reply.status(500).send({
        error: "Failed to generate Gmail auth URL",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  app.get("/api/gmail/callback", async (request, reply) => {
    try {
      const query = request.query as { code?: string; error?: string };
      const { code, error } = query;

      if (error) {
        reply.header("Content-Type", "text/html");
        return reply.send(`
          <!DOCTYPE html>
          <html>
            <head>
              <title>Keep.AI</title>
              <style>
                body {
                  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
                  display: flex;
                  justify-content: center;
                  align-items: center;
                  min-height: 100vh;
                  margin: 0;
                  background-color: #f5f5f5;
                }
                .container {
                  text-align: center;
                  background: white;
                  padding: 40px;
                  border-radius: 8px;
                  box-shadow: 0 2px 10px rgba(0,0,0,0.1);
                }
                .logo {
                  width: 64px;
                  height: 64px;
                  border: 2px solid #D6A642;
                  border-radius: 4px;
                  margin: 0 auto 20px auto;
                  display: flex;
                  align-items: center;
                  justify-content: center;
                  font-size: 32px;
                  font-weight: bold;
                }
                .title {
                  font-size: 24px;
                  font-weight: bold;
                  margin-bottom: 20px;
                  color: #333;
                }
                .error {
                  color: #dc3545;
                  margin: 20px 0;
                }
                .countdown {
                  color: #666;
                  font-size: 14px;
                  margin-top: 10px;
                }
              </style>
            </head>
            <body>
              <div class="container">
                <div class="logo">K</div>
                <div class="title">Keep.AI</div>
                <div class="error">
                  <h2>Authorization Failed</h2>
                  <p>Error: ${error}</p>
                </div>
                <div class="countdown">This page will close in <span id="countdown">5</span> seconds</div>
              </div>
              <script>
                let timeLeft = 5;
                const countdownEl = document.getElementById('countdown');
                const timer = setInterval(() => {
                  timeLeft--;
                  countdownEl.textContent = timeLeft;
                  if (timeLeft <= 0) {
                    clearInterval(timer);
                    window.close();
                  }
                }, 1000);
              </script>
            </body>
          </html>
        `);
      }

      if (!code) {
        return reply
          .status(400)
          .send({ error: "No authorization code received" });
      }

      if (!GMAIL_CLIENT_SECRET) {
        return reply.status(500).send({
          error: "Gmail client secret not configured",
        });
      }

      const redirectUri = `${request.protocol}://${request.hostname}${
        request.hostname === "localhost" ? `:${process.env.PORT || 3000}` : ""
      }/api/gmail/callback`;

      const oAuth2Client = new google.auth.OAuth2(
        GMAIL_CLIENT_ID,
        GMAIL_CLIENT_SECRET,
        redirectUri
      );

      const { tokens } = await oAuth2Client.getToken(code);

      taskScheduler.gmailOAuth2Client?.setCredentials(tokens);
      workflowScheduler.gmailOAuth2Client?.setCredentials(tokens);

      const gmailTokenPath = path.join(userPath, "gmail.json");
      await fsPromises.writeFile(
        gmailTokenPath,
        JSON.stringify(tokens, null, 2),
        { mode: 0o600 }
      );

      reply.header("Content-Type", "text/html");
      return reply.send(`
        <!DOCTYPE html>
        <html>
          <head>
            <title>Keep.AI</title>
            <style>
              body {
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
                display: flex;
                justify-content: center;
                align-items: center;
                min-height: 100vh;
                margin: 0;
                background-color: #f5f5f5;
              }
              .container {
                text-align: center;
                background: white;
                padding: 40px;
                border-radius: 8px;
                box-shadow: 0 2px 10px rgba(0,0,0,0.1);
              }
              .logo {
                width: 64px;
                height: 64px;
                border: 2px solid #D6A642;
                border-radius: 4px;
                margin: 0 auto 20px auto;
                display: flex;
                align-items: center;
                justify-content: center;
                font-size: 32px;
                font-weight: bold;
              }
              .title {
                font-size: 24px;
                font-weight: bold;
                margin-bottom: 20px;
                color: #333;
              }
              .success {
                color: #28a745;
                margin: 20px 0;
              }
              .countdown {
                color: #666;
                font-size: 14px;
                margin-top: 10px;
              }
            </style>
          </head>
          <body>
            <div class="container">
              <div class="logo">K</div>
              <div class="title">Keep.AI</div>
              <div class="success">
                <h2>Connected!</h2>
                <p>Gmail has been successfully connected to your Keep.AI account.</p>
              </div>
              <div class="countdown">This page will close in <span id="countdown">5</span> seconds</div>
            </div>
            <script>
              let timeLeft = 5;
              const countdownEl = document.getElementById('countdown');
              const timer = setInterval(() => {
                timeLeft--;
                countdownEl.textContent = timeLeft;
                if (timeLeft <= 0) {
                  clearInterval(timer);
                  window.close();
                }
              }, 1000);
            </script>
          </body>
        </html>
      `);
    } catch (error) {
      debugServer("Error in /api/gmail/callback:", error);
      reply.header("Content-Type", "text/html");
      return reply.send(`
        <!DOCTYPE html>
        <html>
          <head>
            <title>Keep.AI</title>
            <style>
              body {
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
                display: flex;
                justify-content: center;
                align-items: center;
                min-height: 100vh;
                margin: 0;
                background-color: #f5f5f5;
              }
              .container {
                text-align: center;
                background: white;
                padding: 40px;
                border-radius: 8px;
                box-shadow: 0 2px 10px rgba(0,0,0,0.1);
              }
              .logo {
                width: 64px;
                height: 64px;
                border: 2px solid #D6A642;
                border-radius: 4px;
                margin: 0 auto 20px auto;
                display: flex;
                align-items: center;
                justify-content: center;
                font-size: 32px;
                font-weight: bold;
              }
              .title {
                font-size: 24px;
                font-weight: bold;
                margin-bottom: 20px;
                color: #333;
              }
              .error {
                color: #dc3545;
                margin: 20px 0;
              }
              .countdown {
                color: #666;
                font-size: 14px;
                margin-top: 10px;
              }
            </style>
          </head>
          <body>
            <div class="container">
              <div class="logo">K</div>
              <div class="title">Keep.AI</div>
              <div class="error">
                <h2>Connection Failed</h2>
                <p>There was an error connecting Gmail to your account.</p>
              </div>
              <div class="countdown">This page will close in <span id="countdown">5</span> seconds</div>
            </div>
            <script>
              let timeLeft = 5;
              const countdownEl = document.getElementById('countdown');
              const timer = setInterval(() => {
                timeLeft--;
                countdownEl.textContent = timeLeft;
                if (timeLeft <= 0) {
                  clearInterval(timer);
                  window.close();
                }
              }, 1000);
            </script>
          </body>
        </html>
      `);
    }
  });

  app.post("/api/gmail/check", async (request, reply) => {
    try {
      const gmailTokenPath = path.join(userPath, "gmail.json");

      if (!fs.existsSync(gmailTokenPath)) {
        return reply.status(400).send({
          success: false,
          error: "Gmail token not found. Please connect Gmail first.",
        });
      }

      if (!GMAIL_CLIENT_SECRET) {
        return reply.status(500).send({
          success: false,
          error: "Gmail client secret not configured",
        });
      }

      // Load stored tokens
      const tokenData = await fsPromises.readFile(gmailTokenPath, "utf8");
      const tokens = JSON.parse(tokenData);

      // Create OAuth client with stored tokens
      const oAuth2Client = new google.auth.OAuth2(
        GMAIL_CLIENT_ID,
        GMAIL_CLIENT_SECRET
      );
      oAuth2Client.setCredentials(tokens);

      // Create Gmail API client
      const gmail = google.gmail({ version: "v1", auth: oAuth2Client });

      // Make a basic API call to test the connection
      const response = await gmail.users.getProfile({ userId: "me" });

      if (response.data && response.data.emailAddress) {
        return reply.send({
          success: true,
          email: response.data.emailAddress,
          messagesTotal: response.data.messagesTotal || 0,
          threadsTotal: response.data.threadsTotal || 0,
        });
      } else {
        return reply.status(500).send({
          success: false,
          error: "Invalid response from Gmail API",
        });
      }
    } catch (error) {
      debugServer("Error in /api/gmail/check:", error);
      return reply.status(500).send({
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Unknown error checking Gmail connection",
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

          // Trigger sync to notify peers of new connection
          triggerLocalSync();
        } catch (error) {
          debugServer("NostrConnector listen failed:", error);
        }
      })();

      // Return connection string to client
      return reply.send({ str: connectionInfo.str });
    } catch (error) {
      debugServer("Error in /api/connect:", error);
      return reply.status(500).send({
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
        return reply.status(500).send({ error: "Failed to get site_id" });
      }

      // Convert binary site_id to hex
      const siteIdBuffer = result[0].site_id;
      const siteIdHex = bytesToHex(new Uint8Array(siteIdBuffer));

      return reply.send({ site_id: siteIdHex });
    } catch (error) {
      debugServer("Error in /api/id:", error);
      return reply.status(500).send({
        error: "Failed to get site_id",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  // Helper function to process file uploads from HTTP multipart
  async function processFileUpload(
    data: MultipartFile,
    userPath: string,
    fileStore: FileStore
  ): Promise<File> {
    // Check file size (10MB limit) and read file to buffer
    const MAX_FILE_SIZE = 10 * 1024 * 1024;
    const chunks: Buffer[] = [];
    let totalSize = 0;

    for await (const chunk of data.file) {
      totalSize += chunk.length;
      if (totalSize > MAX_FILE_SIZE) {
        throw new Error(
          `File size exceeds limit: ${totalSize} > ${MAX_FILE_SIZE}`
        );
      }
      chunks.push(chunk);
    }

    const fileBuffer = Buffer.concat(chunks);
    const filename = data.filename || "unknown";

    return storeFileData(fileBuffer, filename, userPath, fileStore);
  }

  // POST /api/file/upload - Upload file endpoint
  app.post("/api/file/upload", async (request: FastifyRequest, reply) => {
    try {
      const data = (await (request as any).file()) as MultipartFile;
      if (!data) {
        return reply.status(400).send({ error: "No file provided" });
      }

      const fileRecord = await processFileUpload(data, userPath, fileStore);
      // Trigger sync immediately after file upload
      triggerLocalSync();
      return reply.send(fileRecord);
    } catch (error) {
      debugServer("Error in /api/upload:", error);
      return reply.status(500).send({
        error: "Failed to upload file",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  // GET /api/file/get?url=<url> - Read file endpoint
  app.get("/api/file/get", async (request, reply) => {
    try {
      const query = request.query as { url?: string };
      const { url } = query;

      if (!url) {
        return reply.status(400).send({ error: "url parameter is required" });
      }

      // Extract file ID from URL (assuming URL format like /files/:id or just :id)
      const fileId = path.basename(url, path.extname(url));

      // Get file record from database
      const fileRecord = await fileStore.getFile(fileId);
      if (!fileRecord) {
        return reply.status(404).send({ error: "File not found" });
      }

      const filesDir = path.join(userPath, "files");
      const filePathLocal = path.join(filesDir, fileRecord.path);

      // Check if file exists on disk
      if (!fs.existsSync(filePathLocal)) {
        return reply.status(404).send({ error: "File not found on disk" });
      }

      // Set appropriate headers
      reply.header("Content-Type", fileRecord.media_type);
      reply.header("Content-Length", fileRecord.size);
      // Properly encode the filename for Content-Disposition header to handle non-ASCII characters
      const encodedFilename = encodeURIComponent(fileRecord.name);
      const asciiFilename = fileRecord.name.replace(/[^\x20-\x7e]/g, "_"); // Replace non-ASCII with underscore for fallback
      reply.header(
        "Content-Disposition",
        `inline; filename="${asciiFilename}"; filename*=UTF-8''${encodedFilename}`
      );

      // Stream the file
      const fileStream = fs.createReadStream(filePathLocal);
      return reply.send(fileStream);
    } catch (error) {
      debugServer("Error in /api/file:", error);
      return reply.status(500).send({
        error: "Failed to serve file",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  // GET /api/file/info?url=<url> - Get file info from database
  app.get("/api/file/info", async (request, reply) => {
    try {
      const query = request.query as { url?: string };
      const { url } = query;

      if (!url) {
        return reply.status(400).send({ error: "url parameter is required" });
      }

      // Extract file ID from URL (assuming URL format like /files/:id or just :id)
      const fileId = url.includes("/")
        ? path.basename(url, path.extname(url))
        : url;

      // Get file record from database
      const fileRecord = await fileStore.getFile(fileId);
      if (!fileRecord) {
        return reply.status(404).send({ error: "File not found" });
      }

      // Return only the file info from database
      return reply.send(fileRecord);
    } catch (error) {
      debugServer("Error in /api/file/info:", error);
      return reply.status(500).send({
        error: "Failed to get file info",
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
        return reply.status(404).send({ error: "API endpoint not found" });
      }

      // Serve index.html for SPA routes
      // @ts-ignore
      return reply.sendFile("index.html");
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
      // Clean up file transfer instances
      for (const sender of fileSenders.values()) {
        sender.stop();
      }
      for (const receiver of fileReceivers.values()) {
        receiver.stop();
      }
      fileSenders.clear();
      fileReceivers.clear();

      await app.close();
      await keyStore.stop();
    },
  };
}
