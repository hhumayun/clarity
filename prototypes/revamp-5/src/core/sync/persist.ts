import AsyncStorage from "@react-native-async-storage/async-storage";
import superjson from "superjson";
import { createAsyncStoragePersister } from "@tanstack/query-async-storage-persister";
import type { Query, QueryClient } from "@tanstack/react-query";
import { persistQueryClientSave, type PersistedClient } from "@tanstack/react-query-persist-client";
import { noteDocs } from "../lib/noteDocs";
import { kbOf, perfNow, perfRecord } from "../lib/perf";
import { outbox } from "./store";

/** How long notes and tasks kept on the phone stay usable without a connection. */
export const OFFLINE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

/** Bump to throw away caches written in an older shape. */
export const CACHE_VERSION = "1";

const CACHE_KEY = "clarity:query-cache:v1";

// superjson, not plain JSON: notes and tasks carry Dates, which JSON would
// bring back as strings. Each write packs the whole copy at once, holding up
// everything else in the app while it runs, so it is timed.
function serialize(client: PersistedClient): string {
  const started = perfNow();
  const text = superjson.stringify(client);
  perfRecord("offline copy write", perfNow() - started, kbOf(text));
  return text;
}

/**
 * The app's last-seen data, written to the phone so it opens offline: at
 * most every 30 seconds while it changes (a save while writing changes it),
 * and at once when the app goes to the background (saveOfflineCopyNow).
 * Changes not yet on the server never depend on it: they are in the outbox,
 * and a note's words in its draft.
 */
export const queryPersister = createAsyncStoragePersister({
  storage: AsyncStorage,
  key: CACHE_KEY,
  throttleTime: 30_000,
  serialize,
  deserialize: (cached) => superjson.parse(cached),
});

// The same, written at once.
const immediatePersister = createAsyncStoragePersister({
  storage: AsyncStorage,
  key: CACHE_KEY,
  throttleTime: 0,
  serialize,
  deserialize: (cached) => superjson.parse(cached),
});

/** The offline copy, written now: the app is going to the background. */
export function saveOfflineCopyNow(queryClient: QueryClient): Promise<void> {
  return persistQueryClientSave({
    queryClient,
    persister: immediatePersister,
    buster: CACHE_VERSION,
    dehydrateOptions: { shouldDehydrateQuery: keepOnPhone },
  });
}

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
  await Promise.all([queryPersister.removeClient(), outbox.clear(), noteDocs.clearAll()]);
}
