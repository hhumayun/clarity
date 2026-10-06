import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";
import { useStore } from "../store/store";
import { declined, useAccountStore } from "./account";
import type { SageState, SageStatus } from "./types";

export type { SageState, SageStatus } from "./types";

export type DataMode = "demo" | "account";

/**
 * Which notes the app shows: the samples (signed out, looking around) or
 * your account's (signed in). Set by AccountSource, which only exists while
 * you're signed in, so demo mode can never meet a session.
 */
export const useDataMode = create<{ mode: DataMode }>(() => ({ mode: "demo" }));

const nothing = () => null;

/**
 * The one switch. Every screen reads its notes, tasks and areas here, with
 * the same selectors it used on the sample store. Demo mode reads the
 * sample store; signed in, your account's. Both hooks are always called, so
 * the switch is safe mid-render, but the one not in use selects nothing.
 */
export function useSage<T>(selector: (state: SageState) => T): T {
  const mode = useDataMode((state) => state.mode);
  const fromSamples = useStore(mode === "demo" ? selector : (nothing as unknown as (state: SageState) => T));
  const fromAccount = useAccountStore(mode === "account" ? selector : (nothing as unknown as (state: SageState) => T));
  return mode === "demo" ? fromSamples : fromAccount;
}

/** The same, outside render (a callback, a memo that reads once). */
export function getSage(): SageState {
  return useDataMode.getState().mode === "demo" ? useStore.getState() : useAccountStore.getState();
}

const DEMO_STATUS: SageStatus = { ready: true, problem: null, editable: true, refresh: async () => {} };

/** Whether your account's lists have arrived, why not, and whether changes save. */
export function useSageStatus(): SageStatus {
  const mode = useDataMode((state) => state.mode);
  const account = useAccountStore(useShallow((state) => ({ ready: state.ready, problem: state.problem, editable: state.editable, refresh: state.refresh })));
  return mode === "demo" ? DEMO_STATUS : account;
}

/**
 * For the ways into writing something new (a note, a task): go, or, on an
 * account that can't save yet, say so instead of opening a page whose words
 * would be lost.
 */
export function useWhenEditable(): (go: () => void) => void {
  const { editable } = useSageStatus();
  return (go) => (editable ? go() : declined("Read-only for now: writing is off"));
}
