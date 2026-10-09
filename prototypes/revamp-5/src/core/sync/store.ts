import AsyncStorage from "@react-native-async-storage/async-storage";
import superjson from "superjson";
import {
  addToQueue,
  countPending,
  mainHead,
  nextPhotoEntry,
  nextPhotoTime,
  remapProject,
  subjectOf,
  type Entry,
  type Op,
  type PhotoProgress,
} from "./outbox";

/**
 * The outbox as the app holds it: the queue in memory, mirrored to the
 * phone's storage after every change so nothing is lost if the app is closed,
 * one queue per signed-in person. The runner sends from the head.
 */

type State = {
  userId: string | null;
  queue: Entry[];
  /** The entry being sent right now, which no later change may alter. */
  sending: number | null;
  /** Bumped on every change, for React's useSyncExternalStore. */
  version: number;
};

let state: State = { userId: null, queue: [], sending: null, version: 0 };
let lastSeq = 0;
// Bumped whenever the queue changes hands (sign-out, another person's queue
// picked up), so work started for one person never lands on the next's.
let owner = 0;
const listeners = new Set<() => void>();
let onEnqueue: (() => void) | null = null;

const keyFor = (userId: string) => `clarity:outbox:v1:${userId}`;

function commit(next: Partial<State>, persist = true) {
  state = { ...state, ...next, version: state.version + 1 };
  if (persist && state.userId) {
    void AsyncStorage.setItem(keyFor(state.userId), superjson.stringify(state.queue)).catch(() => {});
  }
  for (const listener of listeners) listener();
}

export const outbox = {
  /**
   * Pick up the signed-in person's queue from the phone. Anything queued
   * before it was read (a very quick first change) goes after it.
   */
  async load(userId: string): Promise<void> {
    if (state.userId === userId) return;
    let saved: Entry[] = [];
    try {
      const raw = await AsyncStorage.getItem(keyFor(userId));
      if (raw) saved = superjson.parse<Entry[]>(raw) ?? [];
    } catch {
      saved = [];
    }
    lastSeq = Math.max(lastSeq, ...saved.map((entry) => entry.seq));
    if (state.userId !== null) owner += 1;
    commit({ userId, queue: [...saved, ...state.queue], sending: null });
  },

  enqueue(op: Op) {
    lastSeq += 1;
    commit({ queue: addToQueue(state.queue, op, lastSeq, state.sending, Date.now()) });
    onEnqueue?.();
  },

  /** The main lane's next entry: the oldest that isn't a photo (revamp 5). */
  head(): Entry | null {
    return mainHead(state.queue);
  },

  /** The photo lane's next entry: the oldest photo due by `now` (revamp 5). */
  nextPhoto(now: number): Entry | null {
    return nextPhotoEntry(state.queue, now);
  },

  /** When the next photo is due, or null when none is waiting (revamp 5). */
  nextPhotoAt(): number | null {
    return nextPhotoTime(state.queue);
  },

  /** A photo's progress, kept with the queue (revamp 5). */
  patchPhoto(seq: number, photo: PhotoProgress) {
    if (!state.queue.some((entry) => entry.seq === seq)) return;
    commit({ queue: state.queue.map((entry) => (entry.seq === seq ? { ...entry, photo } : entry)) });
  },

  /** Every photo entry waiting, for the lane's own checks (revamp 5). */
  photoEntries(): Entry[] {
    return state.queue.filter((entry) => entry.op.kind === "photo.upload");
  },

  markSending(seq: number | null) {
    commit({ sending: seq }, false);
  },

  /** Sent (or given up on): take it off the queue. */
  remove(seq: number) {
    commit({ queue: state.queue.filter((entry) => entry.seq !== seq), sending: state.sending === seq ? null : state.sending });
  },

  remapProject(fromId: string, toId: string) {
    commit({ queue: remapProject(state.queue, fromId, toId) });
  },

  /** Everything waiting; `{ photos: false }` leaves photos out (revamp 5: a photo can't change a list). */
  pendingCount(options?: { photos?: boolean }): number {
    return countPending(state.queue, options);
  },

  /** Whether anything about this thing ("note:<id>", "task:<id>") is still waiting. */
  isPending(subject: string): boolean {
    return state.queue.some((entry) => subjectOf(entry.op) === subject);
  },

  version(): number {
    return state.version;
  },

  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },

  /** The runner asks to hear about new work. */
  setOnEnqueue(callback: (() => void) | null) {
    onEnqueue = callback;
  },

  /** Changes when the queue changes hands: the photo lane checks it across its long waits. */
  owner(): number {
    return owner;
  },

  /** Signing out or deleting the account: forget this person's queue. */
  async clear(): Promise<void> {
    owner += 1;
    const userId = state.userId;
    commit({ userId: null, queue: [], sending: null }, false);
    if (userId) await AsyncStorage.removeItem(keyFor(userId)).catch(() => {});
  },
};

/** Resolves once nothing about this thing is waiting, or false after `timeoutMs`. */
export function waitUntilSynced(subject: string, timeoutMs: number): Promise<boolean> {
  if (!outbox.isPending(subject)) return Promise.resolve(true);
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      unsubscribe();
      resolve(false);
    }, timeoutMs);
    const unsubscribe = outbox.subscribe(() => {
      if (outbox.isPending(subject)) return;
      clearTimeout(timer);
      unsubscribe();
      resolve(true);
    });
  });
}
