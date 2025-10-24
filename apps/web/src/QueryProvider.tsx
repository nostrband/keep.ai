// CRSqlite Provider with TanStack Query integration and createDB/closeDB pattern
import {
  createContext,
  useContext,
  useState,
  useEffect,
  ReactNode,
} from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { startWorker, WorkerTransport } from "@app/browser";
import { KeepDb, KeepDbApi } from "@app/db";
import { Peer, Transport, TransportClientHttp } from "@app/sync";
import { createDB } from "./db";

type DbStatus = "initializing" | "ready" | "error";

interface QueryContextType {
  dbStatus: DbStatus;
  error: string | null;
  db: KeepDb | null;
  peer: Peer | null;
  setError: (error: string | null) => void;
  retryInitialization: () => Promise<void>;
  getWorkerSiteId: () => string | null;
  api: KeepDbApi | null
}

const QueryContext = createContext<QueryContextType | undefined>(undefined);

interface QueryProviderProps {
  children: ReactNode;
  backendUrl?: string;
  sharedWorkerUrl?: string;
  dedicatedWorkerUrl?: string;
  queryClient: QueryClient;
  setOnLocalChanges: (cb: () => void) => void;
  onRemoteChanges: (tables: string[]) => void;
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

  useEffect(() => {
    initializeDatabase();

    // Cleanup on unmount
    return () => {
      cleanup();
    };
  }, []);

  const cleanup = async () => {
    if (peer) {
      peer.stop();
    }
    if (db) {
      try {
        await db.close();
      } catch (err) {
        console.error("[CRSqliteQueryProvider] Error closing database:", err);
      }
    }
  };

  const initializeDatabase = async () => {
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

      // Create store instances with a default user_id
      // TODO: Replace 'default-user' with actual user ID when user management is implemented
      const defaultUserId = "cli-user";
      const api = new KeepDbApi(keepDB, defaultUserId);
      setApi(api);

      // Create and configure tab sync with callback
      console.log("starting worker", {
        backendUrl,
        sharedWorkerUrl,
        dedicatedWorkerUrl,
      });
      let transport: Transport | undefined;

      if (backendUrl) {
        transport = new TransportClientHttp(backendUrl);
      } else {
        const workerPort = await startWorker({
          dedicatedWorkerUrl,
          sharedWorkerUrl,
        });
        console.log("Worker started and message port obtained");

        // Create transport and add message handler to port
        const workerTransport = new WorkerTransport();
        workerTransport.addMessagePort(workerPort);

        // Can start receiving messages now
        await workerPort.start();

        // Used by peer below
        transport = workerTransport;
      }

      // cr-sqlite peer for our :memory: db
      const peer = new Peer(db, [transport]);

      // Notify reactive components on changes
      peer.addListener("change", onRemoteChanges);
      // Set up event handlers
      peer.addListener("sync", () => {
        // Additional sync data handling if needed
        console.log("[QueryProvider] Sync message received");
      });
      peer.addListener("eose", () => {
        // Additional sync data handling if needed
        console.log("[QueryProvider] EOSE message received");
      });

      // FIXME error handler?
      // sync.onErrorOccurred((errorMsg) => {
      //   setError(errorMsg);
      // });

      // Can start now
      await peer.start();
      await transport.start(peer.getConfig());

      // Set up local changes callback to trigger sync
      setOnLocalChanges(() => {
        console.log("local changes");
        peer.checkLocalChanges();
      });

      setPeer(peer);
      setDbStatus("ready");

      console.log("[CRSqliteQueryProvider] Initialized successfully");
    } catch (err) {
      setDbStatus("error");
      setError((err as Error).message);
      console.error("[CRSqliteQueryProvider] Initialization failed:", err);
    }
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

  const contextValue: QueryContextType = {
    dbStatus,
    error,
    db,
    peer,
    setError,
    retryInitialization,
    getWorkerSiteId,
    api,
  };

  return (
    <QueryClientProvider client={queryClient}>
      <QueryContext.Provider value={contextValue}>
        {children}
      </QueryContext.Provider>
    </QueryClientProvider>
  );
}

export function useCRSqliteQuery() {
  const context = useContext(QueryContext);
  if (context === undefined) {
    throw new Error(
      "useCRSqliteQuery must be used within a CRSqliteQueryProvider"
    );
  }
  return context;
}
