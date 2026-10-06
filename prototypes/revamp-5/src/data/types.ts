import type { useStore } from "../store/store";

/**
 * What every screen reads: notes, tasks, areas, focus, and the actions that
 * change them, in the shape the sample store has always had. Both sources
 * give exactly this shape: the sample store in demo mode, and your account's
 * data (src/data/account) when signed in.
 */
export type SageState = ReturnType<typeof useStore.getState>;

/** How your account's data stands; demo mode is always ready and editable. */
export type SageStatus = {
  /** False until the first lists have arrived (or been read back from the phone). */
  ready: boolean;
  /** Why the lists couldn't be fetched, when nothing is kept on the phone either. */
  problem: string | null;
  /** Whether changes are saved. Until the offline checks pass, only test accounts save. */
  editable: boolean;
  /** Fetch the lists again (pull to refresh). */
  refresh: () => Promise<void>;
};
