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

// Bumped by clearAll (signing out): a download started before it is thrown away.
let generation = 0;

function asDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
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
  /** Whether a photo is kept here. */
  async has(id: string): Promise<boolean> {
    return (await this.read(id)) !== null;
  },
  /**
   * The kept photo, ready to upload: its size, and a PUT of it to a signed
   * link (on the bucket's host: its CORS must allow this page) that gives
   * back the HTTP status. Null when it isn't kept here.
   */
  async forUpload(id: string): Promise<{ bytes: number; put(url: string, headers: Record<string, string>): Promise<number> } | null> {
    const dataUrl = await this.read(id);
    if (!dataUrl) return null;
    const blob = await (await fetch(dataUrl)).blob();
    return { bytes: blob.size, put: async (url, headers) => (await fetch(url, { method: "PUT", body: blob, headers })).status };
  },
  /** Downloads a photo from a signed link and keeps it under its id, unless clearAll ran meanwhile. */
  async save(id: string, url: string): Promise<void> {
    const started = generation;
    const response = await fetch(url);
    if (!response.ok) throw Object.assign(new Error("download"), { status: response.status });
    const dataUrl = await asDataUrl(await response.blob());
    if (started !== generation) return;
    await inStore("readwrite", (store) => store.put(dataUrl, id));
  },
  /** Forgets every kept photo (signing out), and bumps `generation`. */
  async clearAll(): Promise<void> {
    generation += 1;
    await inStore("readwrite", (store) => store.clear());
  },
  /** Bumped by clearAll. A download started before it is thrown away. */
  generation(): number {
    return generation;
  },
};
