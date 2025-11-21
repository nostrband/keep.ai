const TAB_ID = crypto.randomUUID();
const DB_NAME = "tab-locks";
const LOCK_NAME = "active-tab";

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

async function tryBecomeActiveTab(): Promise<boolean> {
  const db = await openLockDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('locks', 'readwrite');
    const store = tx.objectStore('locks');

    const now = Date.now();
    const timeoutMs = 10_000; // consider lock stale after 10s

    store.get(LOCK_NAME).onsuccess = (e) => {
      const req = e.target as IDBRequest<LockRecord | undefined>;
      // @ts-ignore
      const existing = req.result;

      if (existing && now - existing.lastSeen < timeoutMs) {
        // another tab is active and not stale
        resolve(false);
        tx.abort();
        return;
      }

      // either no lock or stale → overwrite
      store.put({ name: LOCK_NAME, tabId: TAB_ID, lastSeen: now });
    };

    tx.oncomplete = () => {
      startHeartbeat(db);
      resolve(true);
    };
    tx.onerror = () => reject(tx.error);
  });
}

function startHeartbeat(db: IDBDatabase) {
  setInterval(() => {
    const tx = db.transaction('locks', 'readwrite');
    const store = tx.objectStore('locks');
    store.put({ name: LOCK_NAME, tabId: TAB_ID, lastSeen: Date.now() });
  }, 5000);
}
