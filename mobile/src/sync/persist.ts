import AsyncStorage from "@react-native-async-storage/async-storage";
import superjson from "superjson";
import { createAsyncStoragePersister } from "@tanstack/query-async-storage-persister";
import type { Query, QueryClient } from "@tanstack/react-query";
import { outbox } from "./store";

/** How long notes and tasks kept on the phone stay usable without a connection. */
export const OFFLINE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

/** Bump to throw away caches written in an older shape. */
export const CACHE_VERSION = "1";

/** The app's last-seen data, written to the phone so it opens offline. */
export const queryPersister = createAsyncStoragePersister({
  storage: AsyncStorage,
  key: "clarity:query-cache:v1",
  // Written at most every few seconds: each write serialises the whole copy.
  throttleTime: 5_000,
  // superjson, not plain JSON: notes and tasks carry Dates, which JSON would
  // bring back as strings.
  serialize: (client) => superjson.stringify(client),
  deserialize: (cached) => superjson.parse(cached),
});

// Notes, tasks, a task's notes and summary, today's focus and who is signed
// in. Not AI answers, searches or settings.
const KEPT = new Set(["notes", "tasks", "task-notes", "task-summary", "auth"]);

export function keepOnPhone(query: Query): boolean {
  if (query.state.status !== "success") return false;
  const [root, second] = query.queryKey as unknown[];
  return KEPT.has(String(root)) || (root === "focus" && second === "summary");
}

/** Signing out or deleting the account: nothing of theirs stays on the phone. */
export async function clearOfflineData(queryClient: QueryClient): Promise<void> {
  queryClient.clear();
  await Promise.all([queryPersister.removeClient(), outbox.clear()]);
}
