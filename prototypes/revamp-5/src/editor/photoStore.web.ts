/**
 * The web build's photos (the phone keeps files, see photoStore.ts): kept in
 * the browser's IndexedDB as `data:` addresses, by id, so they're still there
 * after a reload.
 */
const DATABASE = "clarity-photos";
const STORE = "photos";

let opened: Promise<IDBDatabase> | null = null;
function database(): Promise<IDBDatabase> {
  opened ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      opened = null;
      reject(request.error);
    };
  });
  return opened;
}

async function inStore<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const request = work(db.transaction(STORE, mode).objectStore(STORE));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export const photoStore = {
  wantsBase64: true,
  async keep(id: string, saved: { uri: string; base64?: string }): Promise<void> {
    if (!saved.base64) throw new Error("The photo's data didn't come with it");
    await inStore("readwrite", (store) => store.put(`data:image/jpeg;base64,${saved.base64}`, id));
  },
  async read(id: string): Promise<string | null> {
    try {
      const value: unknown = await inStore("readonly", (store) => store.get(id));
      return typeof value === "string" ? value : null;
    } catch {
      return null;
    }
  },
};
