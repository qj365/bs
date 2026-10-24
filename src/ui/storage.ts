// Best-effort persistence. Every call tolerates storage being unavailable
// (private windows, blocked site data) and simply does nothing then.

const DB_NAME = 'ball-studio';
const STORE = 'files';

function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export async function idbSet(key: string, value: unknown): Promise<void> {
  const db = await openDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readwrite');
      if (value === undefined) tx.objectStore(STORE).delete(key);
      else tx.objectStore(STORE).put(value, key);
      tx.oncomplete = tx.onerror = tx.onabort = () => resolve();
    } catch {
      resolve();
    }
  });
  db.close();
}

export async function idbGet<T>(key: string): Promise<T | undefined> {
  const db = await openDb();
  if (!db) return undefined;
  const value = await new Promise<T | undefined>((resolve) => {
    try {
      const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(key);
      req.onsuccess = () => resolve(req.result as T | undefined);
      req.onerror = () => resolve(undefined);
    } catch {
      resolve(undefined);
    }
  });
  db.close();
  return value;
}

export function lsGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function lsSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Storage full or blocked — nothing to do.
  }
}
