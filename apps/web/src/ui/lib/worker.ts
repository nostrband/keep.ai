import { MessagePortLike, WorkerTransport } from "@app/browser";
import { WorkerEventRouter } from "./worker-event-router";
import { KeepDb, NostrPeerStore } from "@app/db";
import { ServerlessNostrSigner } from "./signer";
import {
  NostrConnector,
  NostrTransport,
  Peer,
  Transport,
  TransportClientHttp,
} from "@app/sync";
import { getPublicKey } from "nostr-tools";
import { bytesToHex } from "nostr-tools/utils";
import { createDB } from "../../db";
import { DB_FILE } from "../../const";

const isServerless = import.meta.env.VITE_FLAVOR === "serverless";

export class SyncWorker {
  private readonly backendUrl?: string;
  private readonly embeddedWorker: boolean;

  // Talk to the tab that created the worker
  private tabTransport?: WorkerTransport;

  // Buffer+forward to event handlers below
  private workerEvents = new WorkerEventRouter();

  // Worker db status
  private status: "initializing" | "sync" | "ready" = "initializing";

  constructor(backendUrl?: string, embeddedWorker?: boolean) {
    console.log("[Worker] Initializing...");
    this.backendUrl = backendUrl;
    this.embeddedWorker = !!embeddedWorker;
    if (!isServerless && !backendUrl) throw new Error("Backend url required");

    if (!this.embeddedWorker)
      this.tabTransport = new WorkerTransport()
  }

  addPort(port: MessagePortLike) {
    // Pass to tab transport
    this.tabTransport?.addMessagePort(port);

    // Pass to router too for our additional
    // tab-worker protocol
    this.workerEvents.addPort(port);

    // Notify about current db status
    if (this.status === "sync") port.postMessage({ type: "worker_sync" });
    else if (this.status === "ready") port.postMessage({ type: "worker_eose" });
  }

  async start() {
    try {
      // Create local persistent db
      const db = await createDB(DB_FILE);
      const keepDB = new KeepDb(db);

      // Initialize database
      await keepDB.start();

      // Create NostrPeerStore for managing peers
      const peerStore = new NostrPeerStore(keepDB);

      // Create NostrSigner for serverless mode
      const signer = new ServerlessNostrSigner();

      // Talk to backend server over http
      // or sync through nostr
      let backendTransport: Transport | undefined;
      if (isServerless) {
        // Create NostrTransport (but don't start it yet - need key first)
        backendTransport = new NostrTransport({
          store: peerStore,
          signer: signer,
        });
      } else {
        backendTransport = new TransportClientHttp(this.backendUrl!);
      }

      // Transport list
      const transports = [backendTransport];
      if (this.tabTransport) transports.push(this.tabTransport);

      // Create cr-sqlite peer with transports
      const peer = new Peer(db, transports);

      // Peer event handlers

      // Let tabs know we've started to sync
      peer.on("connect", (peerId: string, transport: Transport) => {
        if (transport === backendTransport) {
          console.log("[Worker] connected to backend peer", peerId);
          this.status = "sync";
          this.workerEvents.broadcast({ type: "worker_sync" });
        }
      });
      // Let tabs know we've finished syncing
      peer.on("eose", (peerId: string, transport: Transport) => {
        if (transport === backendTransport) {
          console.log("[Worker] finished sync from backend peer", peerId);
          this.status = "ready";
          this.workerEvents.broadcast({ type: "worker_eose" });
        }
      });

      if (isServerless) {
        // Notify nostr transport if peer set changes
        peer.on("change", (tables) => {
          // Make sure we notice the new connection and react properly
          if (tables.includes("nostr_peers"))
            (backendTransport as NostrTransport).updatePeers();
        });
      }

      // Start peer
      await peer.start();

      // Start transports after peer has configuration for them
      if (this.tabTransport)
        await this.tabTransport.start(peer.getConfig());

      // Start http transport immediately, serverless transport will
      // be started later below
      if (!isServerless) {
        await backendTransport.start(peer.getConfig());
      } else {
        // Init serverless message protocol handlers
        this.workerEvents.on("connect", async (connStr, port) => {
          try {
            console.log("[Worker] Received connect_device message:", connStr);

            // Create NostrConnector and connect
            const connector = new NostrConnector();
            const result = await connector.connect(
              connStr,
              peer!.id,
              "Serverless Device"
            );

            console.log("[Worker] Connected successfully:", {
              peer_pubkey: result.peer_pubkey,
              peer_id: result.peer_id,
              peer_device_info: result.peer_device_info,
            });

            // Set the key in the signer
            signer.setKey(result.key);

            // Add peer to the store
            await peerStore.addPeer({
              peer_pubkey: result.peer_pubkey,
              peer_id: result.peer_id,
              device_info: result.peer_device_info,
              local_pubkey: getPublicKey(result.key),
              relays: result.relays.join(","),
              local_id: peer!.id,
              timestamp: "",
            });

            // Start NostrTransport
            await backendTransport.start(peer.getConfig());

            // Send the local key back to all connected tabs
            port.postMessage({
              type: "local_key",
              data: {
                key: bytesToHex(result.key),
              },
            });

            console.log("[Worker] Device connected and key sent to tab");
          } catch (error) {
            console.error("[Worker] Failed to connect device:", error);
            port.postMessage({
              type: "connect_error",
              data: {
                error: error instanceof Error ? error.message : "Unknown error",
              },
            });
          }
        });

        this.workerEvents.on("local_key", async (key) => {
          try {
            console.log("[Worker] Received local_key message");

            // Set the key in the signer
            signer.setKey(key);

            // Start NostrTransport
            await backendTransport.start(peer.getConfig());

            console.log("[Worker] NostrTransport started with existing key");
          } catch (error) {
            console.error("[Worker] Failed to start with local key:", error);
          }
        });

        // Page was frozen on mobile and now resumed
        this.workerEvents.on("reconnect", async () => {
          this.workerEvents.broadcast({ type: "worker_reconnecting" });
          await (backendTransport as NostrTransport).reconnect();
          this.workerEvents.broadcast({ type: "worker_reconnected" });
        });
      }

      // Can start now - will deliver buffered messages
      this.workerEvents.start();

      console.log("[Worker] Initialized successfully");
    } catch (error) {
      console.error("[Worker] Failed to initialize:", error);
      throw error;
    }
  }
}
