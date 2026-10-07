import type { LinkitProfile, LinkitUserNote } from "./types.js";

/// Persistent stale-while-revalidate cache for the data LinkitUserInfo renders:
/// public profiles per Linkit instance and the viewer's private notes per
/// instance and viewer. Reads prefill the provider's in-memory cache before the
/// network revalidates, and network-confirmed writes persist so the next page
/// load starts warm.
///
/// Every operation is best-effort: without IndexedDB (server rendering, private
/// browsing, denied storage) reads return empty and writes are dropped, so the
/// provider keeps its in-memory fetch-on-demand behavior.
export const userInfoCacheDatabaseName = "linkit-react-components.user-info";

const databaseVersion = 1;
const profileStoreName = "profiles";
const noteStoreName = "notes";

type ProfileCacheEntry = { user_id: string; profile: LinkitProfile | null };
type NoteCacheEntry = { user_id: string; note: LinkitUserNote | null };

export async function readCachedProfiles(
  baseUrl: string,
): Promise<Map<string, LinkitProfile | null>> {
  const entries = await readEntries<ProfileCacheEntry>(profileStoreName, [baseUrl]);
  return new Map(entries.map((entry) => [entry.user_id, entry.profile]));
}

export async function writeCachedProfiles(
  baseUrl: string,
  updates: ReadonlyMap<string, LinkitProfile | null>,
): Promise<void> {
  await writeEntries(
    profileStoreName,
    [...updates].map(
      ([userId, profile]): readonly [IDBValidKey, ProfileCacheEntry] => [
        [baseUrl, userId],
        { user_id: userId, profile },
      ],
    ),
  );
}

export async function readCachedNotes(
  baseUrl: string,
  viewerUserId: string,
): Promise<Map<string, LinkitUserNote | null>> {
  const entries = await readEntries<NoteCacheEntry>(noteStoreName, [baseUrl, viewerUserId]);
  return new Map(entries.map((entry) => [entry.user_id, entry.note]));
}

export async function writeCachedNotes(
  baseUrl: string,
  viewerUserId: string,
  updates: ReadonlyMap<string, LinkitUserNote | null>,
): Promise<void> {
  await writeEntries(
    noteStoreName,
    [...updates].map(
      ([userId, note]): readonly [IDBValidKey, NoteCacheEntry] => [
        [baseUrl, viewerUserId, userId],
        { user_id: userId, note },
      ],
    ),
  );
}

export async function clearCachedNotes(
  baseUrl: string,
  viewerUserId: string,
): Promise<void> {
  const db = await database();
  if (!db) return;
  try {
    const transaction = db.transaction(noteStoreName, "readwrite");
    transaction.objectStore(noteStoreName).delete(keyRange([baseUrl, viewerUserId]));
    await completeTransaction(transaction);
  } catch {
    // RECOVERY: Clearing is best-effort like every other cache operation; the
    // viewer-scoped key space still keeps records out of other viewers' reach.
  }
}

let databasePromise: Promise<IDBDatabase | null> | undefined;

// RECOVERY: The cache is optional by design; when IndexedDB is unavailable the
// provider falls back to its in-memory fetch-on-demand behavior.
function database(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  databasePromise ??= openDatabase().catch(() => null);
  return databasePromise;
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(userInfoCacheDatabaseName, databaseVersion);
    request.onupgradeneeded = () => {
      const db = request.result;
      // The cache is disposable, so a schema change discards previous entries
      // instead of migrating them.
      for (const name of [...db.objectStoreNames]) db.deleteObjectStore(name);
      db.createObjectStore(profileStoreName);
      db.createObjectStore(noteStoreName);
    };
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => {
        // Another tab is upgrading the cache database; drop this connection so
        // it can proceed, and reopen lazily on the next operation.
        db.close();
        databasePromise = undefined;
      };
      resolve(db);
    };
    request.onerror = () => reject(request.error);
  });
}

async function readEntries<Entry>(
  storeName: string,
  prefix: readonly string[],
): Promise<Entry[]> {
  const db = await database();
  if (!db) return [];
  try {
    const transaction = db.transaction(storeName, "readonly");
    const request = transaction.objectStore(storeName).getAll(keyRange(prefix));
    await completeTransaction(transaction);
    return request.result as Entry[];
  } catch {
    // RECOVERY: Treat an unavailable store as an empty cache; the provider refetches.
    return [];
  }
}

async function writeEntries(
  storeName: string,
  entries: ReadonlyArray<readonly [IDBValidKey, unknown]>,
): Promise<void> {
  if (!entries.length) return;
  const db = await database();
  if (!db) return;
  try {
    const transaction = db.transaction(storeName, "readwrite");
    const store = transaction.objectStore(storeName);
    for (const [key, entry] of entries) store.put(entry, key);
    await completeTransaction(transaction);
  } catch {
    // RECOVERY: Caching is optional; a failed write only loses the warm start.
  }
}

// One database serves every Linkit instance this origin embeds. Profile records
// key on [baseUrl, userId] and note records on [baseUrl, viewerUserId, userId];
// array keys sort element-wise and an empty array sorts after any string, so
// these bounds select exactly the records under their own prefix.
function keyRange(prefix: readonly string[]): IDBKeyRange {
  return IDBKeyRange.bound(prefix, [...prefix, []]);
}

function completeTransaction(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error);
    transaction.onerror = () => reject(transaction.error);
  });
}
