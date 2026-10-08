import { useState } from "react";

// Unfolded on a day, it stays so for that day (until the app restarts).
const unfoldedDays = new Set<string>();

/**
 * Folding a long day: whether the list shows only its first `at` tasks, and
 * the way to show the rest. With no `foldKey` (not Today) it never folds.
 * Nothing counts what's folded away (Sage's rule: no counts).
 */
export function useDayFold(foldKey: string | undefined, total: number, at = 5): { folded: boolean; unfold: () => void; fold: () => void } {
  const [unfolded, setUnfolded] = useState(() => (foldKey ? unfoldedDays.has(foldKey) : false));
  return {
    folded: !!foldKey && !unfolded && total > at,
    unfold: () => {
      if (foldKey) unfoldedDays.add(foldKey);
      setUnfolded(true);
    },
    fold: () => {
      if (foldKey) unfoldedDays.delete(foldKey);
      setUnfolded(false);
    },
  };
}
