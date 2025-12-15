import {
  createContext,
  useContext,
  useState,
  useEffect,
  ReactNode,
  useRef,
} from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { KeepDb, KeepDbApi } from "@app/db";
import {
  NostrConnector,
  NostrTransport,
  Peer,
  Transport,
  TransportClientHttp,
} from "@app/sync";
import { createDB } from "./db";
import { DB_FILE } from "./const";
import debug from "debug";
import { ServerlessNostrSigner } from "./lib/signer";
import { getDeviceInfo } from "./lib/browser-info";
import { bytesToHex, hexToBytes } from "nostr-tools/utils";
import { getPublicKey, SimplePool } from "nostr-tools";
import { tryBecomeActiveTab } from "./lib/tab-lock";
import { PushNotificationManager } from "./lib/PushNotificationManager";

// Helper function to send key data to service worker
async function getActiveServiceWorker() {
  if (navigator.serviceWorker.controller) {
    // Page already under SW control
    return navigator.serviceWorker.controller;
  }

  // Wait until the SW is ready
  const reg = await navigator.serviceWorker.ready;
  return reg.active;
}

async function sendKeyDataToServiceWorker(
  localPrivkey: Uint8Array,
  api: KeepDbApi
) {
  try {
    const sw = await getActiveServiceWorker();
    if (!sw) {
      console.warn("No active service worker controller");
      return;
    }

    const localPubkey = getPublicKey(localPrivkey);

    // Get peer data from store
    const peers = await api.nostrPeerStore.listPeers();
    const peer = peers.find((p) => p.local_pubkey === localPubkey);

    if (!peer) {
      console.warn("No peer found for local pubkey");
      return;
    }

    // Send the data to service worker
    const data = {
      type: "FILE_TRANSFER_KEYS",
      payload: {
        localPrivkey: bytesToHex(localPrivkey),
        peerPubkey: peer.peer_pubkey,
      },
    };

    sw.postMessage(data);
    dbg("Sent key data to service worker", {
      localPubkey,
      peerPubkey: peer.peer_pubkey,
    });
  } catch (error) {
    console.error("Failed to send key data to service worker:", error);
  }
}

declare const __SERVERLESS__: boolean;
declare const __ELECTRON__: boolean;

// Serverless mode (nostr-sync with main device)
const isServerless = __SERVERLESS__; // (import.meta as any).env?.VITE_FLAVOR === "serverless";
// Electron (desktop)
const isElectron = __ELECTRON__; // (import.meta as any).env?.VITE_FLAVOR === "electron";

type DbStatus =
  | "initializing"
  | "syncing"
  | "ready"
  | "error"
  | "disconnected"
  | "locked";

interface QueryContextType {
  dbStatus: DbStatus;
  error: string | null;
  db: KeepDb | null;
  peer: Peer | null;
  setError: (error: string | null) => void;
  retryInitialization: () => Promise<void>;
  getWorkerSiteId: () => string | null;
  api: KeepDbApi | null;
  connectDevice: (connectionString: string) => Promise<void>;
  resyncTransport: () => Promise<void>;
  reconnectServerless: () => Promise<void>;
}

const QueryContext = createContext<QueryContextType | undefined>(undefined);

interface QueryProviderProps {
  children: ReactNode;
  backendUrl?: string;
  queryClient: QueryClient;
  setOnLocalChanges: (cb: () => void) => void;
  onRemoteChanges: (tables: string[], api: KeepDbApi) => void;
}

const dbg = debug("QueryProviderEmbedded");
const pool = new SimplePool({
  enablePing: true,
  enableReconnect: true,
});

export function QueryProviderEmbedded({
  children,
  backendUrl,
  queryClient,
  setOnLocalChanges,
  onRemoteChanges,
}: QueryProviderProps) {
  const [dbStatus, setDbStatus] = useState<DbStatus>("initializing");
  const [error, setError] = useState<string | null>(null);
  const [db, setDb] = useState<KeepDb | null>(null);
  const [peer, setPeer] = useState<Peer | null>(null);
  const [transport, setTransport] = useState<Transport | null>(null);
  const [api, setApi] = useState<KeepDbApi | null>(null);
  const [signer] = useState<ServerlessNostrSigner>(new ServerlessNostrSigner());

  const apiRef = useRef<KeepDbApi | null>(null);

  useEffect(() => {
    const handleControllerChange = async () => {
      console.log("Service worker controller change");

      // Re-send key data to new service worker
      const localKey = localStorage.getItem("local_key");
      if (localKey && apiRef.current) {
        try {
          const keyBytes = hexToBytes(localKey);
          await sendKeyDataToServiceWorker(keyBytes, apiRef.current);
          dbg("Re-sent key data to new service worker controller");
        } catch (error) {
          dbg("Failed to re-send key data to new service worker:", error);
        }
      }
    };

    navigator.serviceWorker.addEventListener(
      "controllerchange",
      handleControllerChange
    );

    let onResumeHandler: (() => void) | undefined;

    initializeDatabase().then(({ onResume }) => {
      // Store for cleanup
      onResumeHandler = onResume;

      if (onResumeHandler) {
        document.addEventListener("visibilitychange", onResumeHandler);
        document.addEventListener("resume", onResumeHandler);
      }
    });

    // Cleanup on unmount
    return () => {
      navigator.serviceWorker.removeEventListener(
        "controllerchange",
        handleControllerChange
      );
      cleanup(onResumeHandler);
    };
  }, []);

  const cleanup = async (onResume?: () => void) => {
    if (onResume) {
      document.removeEventListener("visibilitychange", onResume);
      document.removeEventListener("resume", onResume);
    }

    if (peer) {
      peer.stop();
    }
    if (db) {
      try {
        await db.close();
      } catch (err) {
        dbg("Error closing database:", err);
      }
    }
  };

  const initializeDatabase = async () => {
    let onResume: (() => void) | undefined;
    try {
      setDbStatus("initializing");
      setError(null);

      if (!isElectron) {
        const activeTab = await tryBecomeActiveTab();
        if (!activeTab) {
          dbg("Another tab is active");
          setDbStatus("locked");
          return { onResume };
        }
      }

      // Create database using provided factory
      const db = await createDB(DB_FILE);
      // (globalThis as unknown as { db: DBInterface }).db = db;
      // make sure it's initialized
      const keepDB = new KeepDb(db);
      await keepDB.start();
      setDb(keepDB);

      // Create store instance
      const api = new KeepDbApi(keepDB);
      setApi(api);
      apiRef.current = api;

      // Create and configure tab sync with callback
      dbg("Starting worker", {
        backendUrl,
        isServerless,
      });
      let transport: Transport | undefined;

      if (!isServerless) {
        if (!backendUrl) throw new Error("Backend url required");
        // This is a debug-only mode to bypass local worker
        transport = new TransportClientHttp(backendUrl);
      } else {
        // Create NostrTransport (but don't start it yet - need key first)
        transport = new NostrTransport({
          store: api.nostrPeerStore,
          signer,
          pool,
        });
      }

      // cr-sqlite peer for our :memory: db
      const peer = new Peer(db, [transport]);

      // Notify reactive components on changes
      peer.on("change", (tables: string[]) => onRemoteChanges(tables, api));

      // Peer list update
      if (isServerless) {
        // Notify nostr transport if peer set changes
        peer.on("change", (tables) => {
          // Make sure we notice the new connection and react properly
          if (tables.includes("nostr_peers"))
            (transport as NostrTransport).updatePeers();
        });
      }

      // Status updates
      let wasReady = false;
      peer.on("connect", (peerId: string, transport: Transport) => {
        dbg("Connected to backend peer", peerId);
        if (!wasReady) setDbStatus("syncing");
      });
      peer.on("sync", (peerId: string, transport: Transport) => {
        dbg("sync to backend peer", peerId);
        if (!wasReady) setDbStatus("syncing");
      });
      // Let tabs know we've finished syncing
      peer.on("eose", (peerId: string, transport: Transport) => {
        dbg("Finished sync from backend peer", peerId);
        setDbStatus("ready");
        wasReady = true;
      });

      // Peer can start now
      await peer.start();

      // Set up local changes callback to trigger sync
      setOnLocalChanges(() => {
        dbg("Got local changes");
        peer.checkLocalChanges();
      });

      setPeer(peer);
      setTransport(transport);

      // Start logic
      if (!isServerless) {
        await transport.start(peer.getConfig());
      } else {
        const localKey = localStorage.getItem("local_key");
        if (!localKey) {
          setDbStatus("disconnected");
          dbg("No local key found, setting status to disconnected");
        } else {
          // Set the key in the signer
          const keyBytes = hexToBytes(localKey);
          signer.setKey(keyBytes);

          // Start NostrTransport
          await transport.start(peer.getConfig());

          dbg(
            "NostrTransport started with existing key, pubkey",
            getPublicKey(keyBytes)
          );

          // Send key data to service worker for file operations
          sendKeyDataToServiceWorker(keyBytes, api).catch((error) =>
            dbg("Failed to send key data to service worker:", error)
          );

          // Can setup push notifications now, don't await to avoid blocking
          // on it
          setupPush(signer, api);
        }

        // Resume after freeze might need to reconnect to relays
        onResume = () => {
          if (!document.hidden) {
            (transport as NostrTransport).reconnect();
          }
        };
      }

      dbg("Initialized successfully");
    } catch (err) {
      setDbStatus("error");
      setError((err as Error).message);
      dbg("[QueryProvider] Initialization failed:", err);
    }

    return { onResume };
  };

  const retryInitialization = async () => {
    // Cleanup existing resources
    await cleanup();
    setDb(null);
    setPeer(null);
    setApi(null);
    apiRef.current = null;

    // Retry initialization
    await initializeDatabase();
  };

  const getWorkerSiteId = (): string | null => {
    return peer?.id || null;
  };

  const connectDevice = async (connectionString: string): Promise<void> => {
    if (!isServerless)
      throw new Error("Connect device only allowed in serverless mode");

    if (!peer || !transport || !api) throw new Error("Not initialized yet");

    try {
      // Reset
      setDbStatus("initializing");
      setError(null);

      // Create NostrConnector and connect
      const connector = new NostrConnector();
      const result = await connector.connect(
        connectionString,
        peer!.id,
        getDeviceInfo()
      );

      dbg("Connected successfully:", {
        peer_pubkey: result.peer_pubkey,
        peer_id: result.peer_id,
        peer_device_info: result.peer_device_info,
      });

      // Set the key in the signer
      signer.setKey(result.key);

      // Give sender some time to start sending data
      await new Promise((ok) => setTimeout(ok, 3000));

      // Add peer to the store
      await api?.nostrPeerStore.addPeer({
        peer_pubkey: result.peer_pubkey,
        peer_id: result.peer_id,
        device_info: result.peer_device_info,
        local_pubkey: getPublicKey(result.key),
        relays: result.relays.join(","),
        local_id: peer!.id,
        timestamp: "",
      });

      // Start NostrTransport
      await transport!.start(peer!.getConfig());

      // Save key
      localStorage.setItem("local_key", bytesToHex(result.key));

      dbg("Device connected and key saved");

      // Send key data to service worker for file operations
      sendKeyDataToServiceWorker(result.key, api).catch((error) =>
        dbg("Failed to send key data to service worker:", error)
      );

      // Setup push notifications after device connection,
      // don't await for it, might take long due to sw init delays
      setupPush(signer, api);
    } catch (err) {
      dbg("Device connect error", err);
      setError((err as Error).message);
      setDbStatus("disconnected");
      throw err;
    }
  };

  const setupPush = async (signer: ServerlessNostrSigner, api: KeepDbApi) => {
    // Setup push notifications after successful peer initialization (serverless mode only)
    if (isServerless) {
      try {
        const pushManager = new PushNotificationManager(signer, pool);
        const peers = await api.nostrPeerStore.listPeers();
        await pushManager.setupPushNotifications(peers);
        dbg("Push notifications setup completed");
      } catch (error) {
        dbg("Push notifications setup failed:", error);
      }
    }
  };

  const resyncTransport = async (): Promise<void> => {
    if (!isServerless) {
      throw new Error("Resync only available in serverless mode");
    }

    if (!transport || !peer) {
      throw new Error("Transport or peer not available");
    }

    try {
      // Call resync on NostrTransport
      await (transport as NostrTransport).resync();

      // Show "Please wait..." and reload after 3 seconds
      setTimeout(() => {
        window.location.reload();
      }, 3000);
    } catch (err) {
      console.error("Resync failed:", err);
      throw err;
    }
  };

  const reconnectServerless = async (): Promise<void> => {
    if (!isServerless) {
      throw new Error("Reconnect only available in serverless mode");
    }

    try {
      // Stop everything - transport, peer, db
      if (transport) {
        await (transport as NostrTransport).stop();
      }
      if (peer) {
        peer.stop();
      }
      if (db) {
        await db.close();
      }

      // Delete the indexeddb database 'idb-batch-atomic'
      if ("indexedDB" in window) {
        try {
          await new Promise<void>((resolve, reject) => {
            const deleteReq = indexedDB.deleteDatabase("idb-batch-atomic");
            deleteReq.onerror = () => reject(deleteReq.error);
            deleteReq.onsuccess = () => resolve();
            deleteReq.onblocked = () => {
              console.warn("Database deletion blocked");
              resolve(); // Continue anyway
            };
          });
        } catch (err) {
          console.warn("Failed to delete indexedDB:", err);
        }
      }

      // Delete local_key from localStorage
      localStorage.removeItem("local_key");

      // Show "Please wait..." and reload after 3 seconds
      setTimeout(() => {
        window.location.reload();
      }, 3000);
    } catch (err) {
      console.error("Reconnect failed:", err);
      throw err;
    }
  };

  const contextValue: QueryContextType = {
    dbStatus,
    error,
    db,
    peer,
    setError,
    retryInitialization,
    getWorkerSiteId,
    api,
    connectDevice,
    resyncTransport,
    reconnectServerless,
  };

  return (
    <QueryClientProvider client={queryClient}>
      <QueryContext.Provider value={contextValue}>
        {children}
      </QueryContext.Provider>
    </QueryClientProvider>
  );
}

export function useQueryProvider() {
  const context = useContext(QueryContext);
  if (context === undefined) {
    throw new Error(
      "useQueryProvider must be used within a QueryProviderEmbedded"
    );
  }
  return context;
}
