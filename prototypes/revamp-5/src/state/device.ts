import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { Prefs } from "../store/model";

export type Mode = "auto" | "light" | "dark";

/** AI help: on, off, or not asked yet (null). */
export type AiChoice = "on" | "off" | null;

export const DEFAULT_PREFS: Prefs = { accent: "sage", paper: "linen", focusLength: 15, breakAfter: true, fastTimers: false, largeText: false };

type DeviceState = {
  prefs: Prefs;
  mode: Mode;
  /** Looking around with the sample notes and tasks, without an account. */
  demo: boolean;
  /** The first-run welcome has been seen on this phone. */
  onboarded: boolean;
  /**
   * Whether AI help may read what you write (asked on the opening screens,
   * changed in Settings). Off, nothing is sent to an AI and Sage's own
   * questions and text stand in. Null until asked.
   */
  ai: AiChoice;
  /** True once what was saved has been read back; the launch veil waits for it. */
  hydrated: boolean;
  setPref: <K extends keyof Prefs>(key: K, value: Prefs[K]) => void;
  setMode: (mode: Mode) => void;
  setDemo: (demo: boolean) => void;
  setOnboarded: (onboarded: boolean) => void;
  setAi: (ai: "on" | "off") => void;
};

/**
 * What this phone keeps, whoever is signed in: your colour, paper and
 * appearance, the focus defaults, whether you're looking around with the
 * sample notes, and whether the first-run welcome has been seen. Kept in
 * AsyncStorage, so it outlives a restart and stays when you sign out.
 */
export const useDevice = create<DeviceState>()(
  persist(
    (set) => ({
      prefs: DEFAULT_PREFS,
      mode: "auto",
      demo: false,
      onboarded: false,
      ai: null,
      hydrated: false,
      setPref: (key, value) => set((state) => ({ prefs: { ...state.prefs, [key]: value } })),
      setMode: (mode) => set({ mode }),
      setDemo: (demo) => set({ demo }),
      setOnboarded: (onboarded) => set({ onboarded }),
      setAi: (ai) => set({ ai }),
    }),
    {
      name: "clarity:sage:device",
      version: 1,
      storage: createJSONStorage(() => AsyncStorage),
      partialize: ({ prefs, mode, demo, onboarded, ai }) => ({ prefs, mode, demo, onboarded, ai }),
      // A setting added later keeps its default on phones that saved before it existed.
      merge: (saved, current) => {
        const kept = (saved ?? {}) as Partial<DeviceState>;
        return { ...current, ...kept, prefs: { ...current.prefs, ...kept.prefs } };
      },
      onRehydrateStorage: () => () => {
        useDevice.setState({ hydrated: true });
        lookAroundFromLink();
      },
    },
  ),
);

/**
 * The web build only: `?demo` in the address opens the sample notes, so the
 * screenshot and interaction scripts can look around without an account.
 */
function lookAroundFromLink() {
  if (process.env.EXPO_OS !== "web" || typeof window === "undefined") return;
  if (new URLSearchParams(window.location.search).has("demo")) useDevice.setState({ demo: true });
}
