import { useEffect } from "react";

// How many screens want sync kept quiet right now (the note page, while open).
let quiet = 0;

/** While the calling screen is open, nothing is said about syncing ("Offline", "All changes saved"). */
export function useQuietSyncNotices() {
  useEffect(() => {
    quiet += 1;
    return () => {
      quiet -= 1;
    };
  }, []);
}

/** Whether a screen open now wants sync kept quiet. */
export function syncNoticesQuiet(): boolean {
  return quiet > 0;
}
