const DB_NAME = "tab-locks";
const LOCK_NAME = "active-tab";

const TAB_ID = (() => {
  const key = "tab-id";
  const existing = sessionStorage.getItem(key);
  if (existing) return existing;
  const id = crypto.randomUUID();
  sessionStorage.setItem(key, id);
  return id;
})();


type LockRecord = {
  name: string;
  tabId: string;
  lastSeen: number;
};

function openLockDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('locks')) {
        db.createObjectStore('locks', { keyPath: 'name' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
export async function tryBecomeActiveTab(): Promise<boolean> {
  const db = await openLockDb();

  return new Promise((resolve, reject) => {
    const tx = db.transaction("locks", "readwrite");
    const store = tx.objectStore("locks");

    const now = Date.now();
    const timeoutMs = 10_000; // consider lock stale after 10s

    const request = store.get(LOCK_NAME) as IDBRequest<LockRecord | undefined>;

    request.onsuccess = (e: Event) => {
      const req = e.target as IDBRequest<LockRecord | undefined>;
      const existing = req.result;

      if (existing) {
        const age = now - existing.lastSeen;

        // Only block if it's a *different* tab and not stale
        if (existing.tabId !== TAB_ID && age < timeoutMs) {
          resolve(false);
          tx.abort();
          return;
        }
      }

      // either no lock, or stale, or same tabId → (re)acquire
      store.put({ name: LOCK_NAME, tabId: TAB_ID, lastSeen: now });
    };

    request.onerror = () => reject(request.error);

    tx.oncomplete = () => {
      startHeartbeat(db);
      resolve(true);
    };

    tx.onerror = () => reject(tx.error);
  });
}

let heartbeatHandle: ReturnType<typeof setInterval> | undefined;

function startHeartbeat(db: IDBDatabase) {
  if (heartbeatHandle) return; // already running

  heartbeatHandle = setInterval(() => {
    const tx = db.transaction('locks', 'readwrite');
    const store = tx.objectStore('locks');
    store.put({ name: LOCK_NAME, tabId: TAB_ID, lastSeen: Date.now() });
  }, 5000);
}
