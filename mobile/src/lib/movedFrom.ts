import AsyncStorage from "@react-native-async-storage/async-storage";
import { useSyncExternalStore } from "react";

/**
 * Where a task was planned before Catch up moved it, so Today can say "Moved
 * here from Sun, Sep 13". The server keeps only a task's current date, so
 * this lives on the device: a courtesy note, not a record. Losing it loses a
 * line of text, nothing more.
 */

const KEY = "clarity:moved-from";
// Old notes are no use to anyone; keep the map from growing without bound.
const MAX_ENTRIES = 200;

type Store = Record<string, string>; // task id -> ISO timestamp of the old date

let state: Store = {};
let loaded = false;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

async function load() {
  if (loaded) return;
  loaded = true;
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") {
        state = { ...(parsed as Store), ...state };
        emit();
      }
    }
  } catch {
    // Unreadable or absent: start empty.
  }
}

function persist() {
  const entries = Object.entries(state);
  if (entries.length > MAX_ENTRIES) {
    state = Object.fromEntries(entries.slice(entries.length - MAX_ENTRIES));
  }
  void AsyncStorage.setItem(KEY, JSON.stringify(state)).catch(() => {});
}

export function recordMovedFrom(taskId: string, previous: Date | null) {
  if (!previous) return;
  // Moving a task twice keeps its first date: that is the one worth naming.
  if (state[taskId]) return;
  state = { ...state, [taskId]: previous.toISOString() };
  persist();
  emit();
}

export function forgetMovedFrom(taskId: string) {
  if (!state[taskId]) return;
  const { [taskId]: _gone, ...rest } = state;
  state = rest;
  persist();
  emit();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  void load();
  return () => listeners.delete(listener);
}

/** The date a task was moved from, if Catch up moved it. */
export function useMovedFrom(): (taskId: string) => Date | null {
  const snapshot = useSyncExternalStore(subscribe, () => state);
  return (taskId: string) => {
    const iso = snapshot[taskId];
    return iso ? new Date(iso) : null;
  };
}
