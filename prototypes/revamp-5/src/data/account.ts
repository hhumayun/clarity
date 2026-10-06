import { create } from "zustand";
import { today } from "../lib/dates";
import type { SageState, SageStatus } from "./types";

/**
 * Your account's notes, tasks and areas, in the same shape as the sample
 * store, so screens read either one the same way. AccountSource fills it
 * from the main app's data hooks while you're signed in, and puts in the
 * actions that save. Until then, and for accounts that can't save yet,
 * every change says so and changes nothing.
 *
 * It never holds a sample note: it starts empty and only ever takes what
 * the server or the phone's copy of it gives.
 */
export type AccountState = SageState & SageStatus;

let notify: (message: string) => void = () => {};

/** How a declined change is said (AccountSource gives it the acknowledgement capsule). */
export function setAccountNotifier(next: (message: string) => void) {
  notify = next;
}

/** A change that isn't saved yet, said plainly. */
export function declined(message = "Read-only for now: nothing changed") {
  notify(message);
}

export function emptyAccount(): Omit<AccountState, "refresh"> {
  return {
    areas: [],
    tasks: [],
    notes: [],
    focus: {},
    focusToday: 0,
    suggestions: {},
    searched: {},
    viewDay: today(),
    lastAdded: null,
    deleted: [],
    pages: {},
    draftArea: null,
    ready: false,
    problem: null,
    editable: false,

    setViewDay: (day) => useAccountStore.setState({ viewDay: day }),
    setDraftArea: (area) => useAccountStore.setState({ draftArea: area }),

    addTask: () => (declined(), ""),
    updateTask: () => declined(),
    setDone: () => (declined(), null),
    moveTask: () => declined(),
    deleteTask: () => declined(),
    clearCompleted: () => (declined(), 0),
    linkNote: () => declined(),
    unlinkNote: () => declined(),
    addArea: () => (declined(), null),
    renameArea: () => (declined(), false),
    deleteArea: () => declined(),
    recordFocus: () => declined(),
    parkThought: () => (declined(), ""),
    addNote: () => (declined(), ""),
    setNoteArea: () => declined(),
    findTasks: () => (declined("Finding tasks comes later"), "none"),
    toggleSuggestion: () => {},
    dismissSuggestions: () => {},
    addSuggestions: () => (declined("Finding tasks comes later"), 0),
    addSuggestion: () => declined("Finding tasks comes later"),
    skipSuggestion: () => declined("Finding tasks comes later"),
    // The samples' reset has nothing to do with an account.
    reset: () => {},
  };
}

export const useAccountStore = create<AccountState>()(() => ({ ...emptyAccount(), refresh: async () => {} }));
