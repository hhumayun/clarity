import { useEffect, useRef, useState } from "react";
import { useSharedValue, withTiming } from "react-native-reanimated";
import { EASE_IN, EASE_OUT, MOTION } from "../ui/motion";

/**
 * Keeps something mounted just long enough to animate out.
 *
 * Dialogs here must unmount when closed: a React Native Modal left in the
 * tree keeps a transparent window that swallows every touch under the new
 * renderer. But unmounting at once means they vanish with no exit at all.
 * This keeps `mounted` true for the exit, drives `progress` 0 -> 1 on the way
 * in and back to 0 on the way out, and only then lets go.
 */
export function usePresence(open: boolean, opts: { enterMs?: number; exitMs?: number } = {}) {
  const { enterMs = MOTION.slow, exitMs = MOTION.base } = opts;
  const [mounted, setMounted] = useState(open);
  const progress = useSharedValue(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    if (open) {
      setMounted(true);
      return;
    }
    if (!mounted) return;
    progress.value = withTiming(0, { duration: exitMs, easing: EASE_IN });
    timer.current = setTimeout(() => {
      timer.current = null;
      setMounted(false);
    }, exitMs);
    // `mounted` is read, not watched: only a change of `open` starts an exit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Animate in once the content is actually on screen.
  useEffect(() => {
    if (open && mounted) progress.value = withTiming(1, { duration: enterMs, easing: EASE_OUT });
  }, [open, mounted, progress, enterMs]);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  return { mounted, progress };
}

/**
 * The last value seen while open, so a closing dialog keeps showing what it
 * showed rather than flashing to an empty state for its final frames (a
 * parent usually clears the task or note the moment it asks to close).
 */
export function useHeldWhileOpen<T>(open: boolean, value: T): T {
  const held = useRef(value);
  if (open) held.current = value;
  return held.current;
}
