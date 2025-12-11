// CRSqlite Provider with TanStack Query integration and createDB/closeDB pattern
import {
  createContext,
  useContext,
  useState,
  useEffect,
  ReactNode,
} from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { startWorker, WorkerTransport, WorkerPort } from "@app/browser";
import { KeepDb, KeepDbApi } from "@app/db";
import { Peer, Transport, TransportClientHttp } from "@app/sync";
import { createDB } from "./db";

// Serverless mode (nostr-sync with main device)
declare const __SERVERLESS__: boolean;
const isServerless = __SERVERLESS__; // (import.meta as any).env?.VITE_FLAVOR === "serverless";

type DbStatus =
  | "initializing"
  | "syncing"
  | "ready"
  | "error"
  | "disconnected"
  | "reload"
  | "reconnecting";

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
  sharedWorkerUrl?: string;
  dedicatedWorkerUrl?: string;
  queryClient: QueryClient;
  setOnLocalChanges: (cb: () => void) => void;
  onRemoteChanges: (tables: string[], api: KeepDbApi) => void;
}

export function QueryProvider({
  children,
  backendUrl,
  sharedWorkerUrl,
  dedicatedWorkerUrl,
  queryClient,
  setOnLocalChanges,
  onRemoteChanges,
}: QueryProviderProps) {
  const [dbStatus, setDbStatus] = useState<DbStatus>("initializing");
  const [error, setError] = useState<string | null>(null);
  const [db, setDb] = useState<KeepDb | null>(null);
  const [peer, setPeer] = useState<Peer | null>(null);
  const [api, setApi] = useState<KeepDbApi | null>(null);
  const [workerPort, setWorkerPort] = useState<WorkerPort | null>(null);

  // Ping/pong state
  const [pingInterval, setPingInterval] = useState<NodeJS.Timeout | null>(null);
  const [pingTimeout, setPingTimeout] = useState<NodeJS.Timeout | null>(null);

  useEffect(() => {
    let onResumeHandler: (() => void) | undefined;
    initializeDatabase().then(({ onResume }) => (onResumeHandler = onResume));

    if (onResumeHandler) document.addEventListener("resume", onResumeHandler);

    // Cleanup on unmount
    return () => {
      cleanup(onResumeHandler);
    };
  }, []);

  const cleanup = async (onResume?: () => void) => {
    stopPingInterval();

    if (onResume) document.removeEventListener("resume", onResume);

    if (peer) {
      peer.stop();
    }
    if (db) {
      try {
        await db.close();
      } catch (err) {
        console.error("[QueryProvider] Error closing database:", err);
      }
    }
  };

  const startPingInterval = (workerPort: WorkerPort) => {
    let to: ReturnType<typeof setTimeout> | undefined;

    workerPort.addEventListener("message", (event) => {
      const { type } = event.data;
      if (type === "pong") {
        // Worker responded to ping
        console.log("[QueryProvider] Received pong from worker");
        if (to) {
          clearTimeout(to);
          setPingTimeout(null);
        }
      }
    });

    const interval = setInterval(() => {
      // Only send ping if document is not hidden (tab is active)
      if (!document.hidden && workerPort) {
        console.log("[QueryProvider] Sending ping to worker");
        workerPort.postMessage({ type: "ping" });

        // Set timeout for pong response (5 seconds)
        to = setTimeout(() => {
          setPingTimeout(null);
          if (!document.hidden) {
            console.error(
              "[QueryProvider] Ping timeout - setting status to reload"
            );
            setDbStatus("reload");
          }
        }, 5000);
        setPingTimeout(to);
      }
    }, 30000); // Send ping every 30 seconds

    setPingInterval(interval);
  };

  const stopPingInterval = () => {
    if (pingInterval) {
      clearInterval(pingInterval);
      setPingInterval(null);
    }
    if (pingTimeout) {
      clearTimeout(pingTimeout);
      setPingTimeout(null);
    }
  };

  const initializeDatabase = async () => {
    let onResume: (() => void) | undefined;
    try {
      setDbStatus("initializing");
      setError(null);

      // Create database using provided factory
      const db = await createDB(":memory:");
      // (globalThis as unknown as { db: DBInterface }).db = db;
      // make sure it's initialized
      const keepDB = new KeepDb(db);
      await keepDB.start();
      setDb(keepDB);

      // Create store instance
      const api = new KeepDbApi(keepDB);
      setApi(api);

      // Create and configure tab sync with callback
      console.log("[QueryProvider] Starting worker", {
        backendUrl,
        sharedWorkerUrl,
        dedicatedWorkerUrl,
        isServerless,
      });
      let transport: Transport | undefined;
      let workerPort: WorkerPort | undefined;

      if (backendUrl && !isServerless) {
        // This is a debug-only mode to bypass local worker
        transport = new TransportClientHttp(backendUrl);
      } else {
        // Main mode: shared (where available) worker doing
        // persistence, while local peer is memory db with fast access
        workerPort = await startWorker({
          dedicatedWorkerUrl: isServerless
            ? dedicatedWorkerUrl?.replace("worker.ts", "worker.serverless.ts")
            : dedicatedWorkerUrl,
          sharedWorkerUrl: isServerless
            ? sharedWorkerUrl?.replace(
                "shared-worker.ts",
                "shared-worker.serverless.ts"
              )
            : sharedWorkerUrl,
        });
        console.log("[QueryProvider] Worker started and message port obtained");
        setWorkerPort(workerPort);

        // Create transport and add message handler to port
        const workerTransport = new WorkerTransport();
        workerTransport.addMessagePort(workerPort);

        // Start pinging
        startPingInterval(workerPort);

        // Since our tab's peer is only a local cache,
        // we're interested in worker's status and need to
        // listen to it's events to update our state
        let wasReady = false;
        workerPort.addEventListener("message", (event) => {
          const { type } = event.data;
          if (type === "worker_sync") {
            // Worker started sync
            console.log("[QueryProvider] Sync message received");
            if (!wasReady) setDbStatus("syncing");
          } else if (type === "worker_eose") {
            // Worker finished sync
            console.log("[QueryProvider] EOSE message received");
            setDbStatus("ready");
            wasReady = true;
          }
        });

        // In serverless mode we have additional worker-tab protocol
        // to initialize the connection
        if (isServerless) {
          workerPort.addEventListener("message", (event) => {
            const { type, data } = event.data;
            if (type === "local_key") {
              // If connection establishment was initialized (below)
              // and worker connects successfully, it will send
              // us a local connection key to store in localstore,
              // as workers don't have localstore access and indexeddb is too heavy for this
              localStorage.setItem("local_key", data.key);
              console.log("[QueryProvider] Stored local key");
            } else if (type === "connect_error") {
              setError(data.error);
              console.error("[QueryProvider] Connection error:", data.error);
            } else if (type === "worker_reconnecting") {
              setDbStatus("reconnecting");
              console.error("[QueryProvider] Reconnecting...");
            } else if (type === "worker_reconnected") {
              if (wasReady)
                setDbStatus("ready");
              console.error("[QueryProvider] Reconnecting...");
            }
          });
        }

        // Can start receiving messages now
        await workerPort.start();

        // Used by peer below
        transport = workerTransport;
      }

      // cr-sqlite peer for our :memory: db
      const peer = new Peer(db, [transport]);

      // Notify reactive components on changes
      peer.addListener("change", (tables: string[]) =>
        onRemoteChanges(tables, api)
      );

      // For direct backend connection we use peer's events
      // to update db status
      if (backendUrl && !isServerless) {
        // Started sync
        peer.addListener("sync", () => {
          console.log("[QueryProvider] Sync message received");
          setDbStatus("syncing");
        });
        // Finished sync
        peer.addListener("eose", () => {
          console.log("[QueryProvider] EOSE message received");
          setDbStatus("ready");
        });
      }

      // Peer can start now
      await peer.start();
      await transport.start(peer.getConfig());

      // Set up local changes callback to trigger sync
      setOnLocalChanges(() => {
        console.log("[QueryProvider] Got local changes");
        peer.checkLocalChanges();
      });

      setPeer(peer);

      // Check connection status for serverless mode
      if (isServerless) {
        const localKey = localStorage.getItem("local_key");
        if (!localKey) {
          setDbStatus("disconnected");
          console.log(
            "[QueryProvider] No local key found, setting status to disconnected"
          );
        } else {
          // Send the key to the worker
          workerPort!.postMessage({
            type: "local_key",
            data: { key: localKey },
          });
          console.log("[QueryProvider] Sent existing local key to worker");
        }

        onResume = () => {
          workerPort!.postMessage({
            type: "reconnect",
          });
        };
      }

      console.log("[QueryProvider] Initialized successfully");
    } catch (err) {
      setDbStatus("error");
      setError((err as Error).message);
      console.error("[QueryProvider] Initialization failed:", err);
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
    if (!workerPort) {
      throw new Error("Worker not initialized");
    }
    if (!isServerless) {
      throw new Error("Connect device only allowed in serverless mode");
    }

    try {
      // Reset
      setDbStatus("initializing");
      setError(null);

      // Send connection string to worker
      workerPort.postMessage({
        type: "connect_device",
        data: { connectionString },
      });

      console.log("[QueryProvider] Sent connect_device message to worker");
    } catch (err) {
      setError((err as Error).message);
      setDbStatus("disconnected");
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
      "useQueryProvider must be used within a QueryProvider"
    );
  }
  return context;
}
