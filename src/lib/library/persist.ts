// The library, kept in this browser between visits (IndexedDB): each activity's summary and route,
// plus the file it came from so it can still be opened in full. Nothing leaves the device.

import type { LibraryEntry } from "./types";

const DB = "av-library";
const STORE = "entries";

let db: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  db ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "id" });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  // A failed open (private mode, storage off) is retried next time.
  db.catch(() => (db = null));
  return db;
}

function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  return open().then(
    (d) =>
      new Promise((resolve, reject) => {
        const tx = d.transaction(STORE, mode);
        const req = fn(tx.objectStore(STORE));
        tx.oncomplete = () => resolve(req ? req.result : undefined);
        tx.onerror = tx.onabort = () => reject(tx.error);
      }),
  );
}

export async function loadEntries(): Promise<LibraryEntry[]> {
  if (typeof indexedDB === "undefined") return [];
  return ((await run("readonly", (s) => s.getAll())) as LibraryEntry[] | undefined) ?? [];
}

let asked: Promise<boolean | null> | null = null;

/**
 * Asks once to keep the library through storage pressure and long absences, and resolves with
 * the answer (null where the browser can't say). Chrome and Safari decide silently (installed
 * apps and sites you use often get it); Firefox asks.
 */
export function askPersist(): Promise<boolean | null> {
  asked ??= typeof navigator !== "undefined" && navigator.storage?.persist ? navigator.storage.persist().catch(() => null) : Promise.resolve(null);
  return asked;
}

/** Whether the browser has promised to keep this site's storage (null where it can't say). */
export async function isPersisted(): Promise<boolean | null> {
  if (typeof navigator === "undefined" || !navigator.storage?.persisted) return null;
  return navigator.storage.persisted().catch(() => null);
}

/** Saves new entries; false if the browser refused (storage full or unavailable). */
export async function saveEntries(entries: LibraryEntry[]): Promise<boolean> {
  if (typeof indexedDB === "undefined" || !entries.length) return true;
  void askPersist();
  try {
    await run("readwrite", (s) => {
      for (const e of entries) s.put(e);
    });
    return true;
  } catch {
    return false;
  }
}

/** Drops these entries from the saved library. */
export async function deleteEntries(ids: string[]): Promise<void> {
  if (typeof indexedDB === "undefined" || !ids.length) return;
  await run("readwrite", (s) => {
    for (const id of ids) s.delete(id);
  }).catch(() => {});
}

export async function clearEntries(): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  await run("readwrite", (s) => s.clear()).catch(() => {});
}
