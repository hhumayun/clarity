import { useCallback, useRef } from "react";

/**
 * Something to do once a dialog has fully gone, such as opening a route:
 * `later(fn)` as it is asked to close, and `run` as its onExited. Presenting
 * while the dialog is still being put away is how a screen ends up frozen.
 */
export function useAfterExit() {
  const pending = useRef<(() => void) | null>(null);
  const later = useCallback((fn: () => void) => {
    pending.current = fn;
  }, []);
  const run = useCallback(() => {
    const fn = pending.current;
    pending.current = null;
    fn?.();
  }, []);
  return { later, run };
}
