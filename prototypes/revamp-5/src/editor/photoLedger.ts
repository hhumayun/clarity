import AsyncStorage from "@react-native-async-storage/async-storage";
import { useSyncExternalStore } from "react";

/**
 * The photos added on this phone for account notes that the server hasn't
 * confirmed yet (docs/photos-server.md 9.4), so signing out, which deletes
 * the phone's photos, can't silently delete the only copy: the sign-out
 * warning counts them. Kept per person in the phone's storage, beside the
 * outbox, as id → "waiting" (on its way) or "rejected" (the server will never
 * take it; it stays on this phone, and isn't offered again).
 */
type Mark = "waiting" | "rejected";

let userId: string | null = null;
let marks: Record<string, Mark> = {};
let version = 0;
const listeners = new Set<() => void>();

const keyFor = (id: string) => `clarity:photos-unsent:v1:${id}`;

function commit(next: Record<string, Mark>) {
  marks = next;
  version += 1;
  if (userId) void AsyncStorage.setItem(keyFor(userId), JSON.stringify(marks)).catch(() => {});
  for (const listener of listeners) listener();
}

export const photoLedger = {
  /** Picks up the signed-in person's list (with the outbox). Anything marked before it was read is kept. */
  async load(id: string): Promise<void> {
    if (userId === id) return;
    let saved: Record<string, Mark> = {};
    try {
      const raw = await AsyncStorage.getItem(keyFor(id));
      const parsed: unknown = raw ? JSON.parse(raw) : null;
      if (parsed && typeof parsed === "object") saved = parsed as Record<string, Mark>;
    } catch {
      saved = {};
    }
    userId = id;
    commit({ ...saved, ...marks });
  },
  /** A photo on its way to the server. */
  add(id: string) {
    if (marks[id] === "waiting") return;
    commit({ ...marks, [id]: "waiting" });
  },
  /** On the server (or its file is gone): nothing to warn about. */
  remove(id: string) {
    if (!(id in marks)) return;
    const { [id]: _gone, ...rest } = marks;
    commit(rest);
  },
  /** The server will never take it: it stays on this phone only. */
  reject(id: string) {
    commit({ ...marks, [id]: "rejected" });
  },
  isRejected(id: string): boolean {
    return marks[id] === "rejected";
  },
  /** Photos only this phone has (waiting or refused). */
  count(): number {
    return Object.keys(marks).length;
  },
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  version(): number {
    return version;
  },
  /** Signing out or deleting the account: forget this person's list. */
  async clear(): Promise<void> {
    const id = userId;
    userId = null;
    commit({});
    if (id) await AsyncStorage.removeItem(keyFor(id)).catch(() => {});
  },
};

/** How many photos only this phone has, for the sign-out warning. */
export function useUnsentPhotos(): number {
  return useSyncExternalStore(photoLedger.subscribe, () => photoLedger.count());
}
