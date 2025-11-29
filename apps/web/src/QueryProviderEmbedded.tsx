import {
  createContext,
  useContext,
  useState,
  useEffect,
  ReactNode,
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
import { bytesToHex, hexToBytes } from "nostr-tools/utils";
import { getPublicKey, SimplePool } from "nostr-tools";
import { tryBecomeActiveTab } from "./lib/tab-lock";
import { PushNotificationManager } from "./lib/PushNotificationManager";

// Serverless mode (nostr-sync with main device)
const isServerless = (import.meta as any).env?.VITE_FLAVOR === "serverless";
// Electron (desktop)
const isElectron = (import.meta as any).env?.VITE_FLAVOR === "electron";

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
  enableReconnect: true
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

  useEffect(() => {
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
          pool
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
        "Serverless Device"
      );

      dbg("Connected successfully:", {
        peer_pubkey: result.peer_pubkey,
        peer_id: result.peer_id,
        peer_device_info: result.peer_device_info,
      });

      // Set the key in the signer
      signer.setKey(result.key);

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
