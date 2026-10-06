import { useCallback, useEffect, useRef, useState } from "react";
import { useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { duration, easeIn, easeOut, keep, reducedAtLaunch } from "../theme/motion";
import { tick } from "./haptics";

// The list dips this quickly (scaled by how much of it still shows), and rises from this far below.
const DIP_MS = 110;
const DIP_REDUCED_MS = 80;
const DIP_LIFT = -3;
const RISE_FROM = 8;
const RISE_REDUCED_MS = 150;

/**
 * Changing what a list shows (an area chosen, words searched for) as one calm
 * beat, decided with the user on 2026-10-06 (the study's variant A):
 * 1. the choice answers at once: a tick, and the chips show it;
 * 2. the list, as one layer, dips: it fades and lifts 3 pt (110 ms, gathering speed);
 * 3. out of sight, it changes (`shown`) and goes back to the top: however long
 *    the new rows take to draw, nothing cuts;
 * 4. once they're drawn it rises 8 pt into place as it fades in (220 ms, ease-out).
 * The latest choice wins: a choice during the dip just changes what comes in;
 * one during the rise dips again from where it is. Under Reduce Motion it's a
 * plain cross-fade (80 ms out, 150 in).
 *
 * `quiet` is on from the choice until the rise is done: rows drop their own
 * leave and settle animations meanwhile (dozens of those, all at once, made
 * filtering lag). Never animate rows on a change like this: one layer moves.
 * `listStyle` goes on the list.
 */
export function useFilterSwap<T>(
  initial: T,
  { scrollToTop, same = Object.is, ready = true }: { scrollToTop?: () => void; same?: (a: T, b: T) => boolean; ready?: boolean } = {},
) {
  const [chosen, setChosen] = useState(initial);
  const [shown, setShown] = useState(initial);
  const [quiet, setQuiet] = useState(false);
  const pending = useRef(initial);
  const shownRef = useRef(initial);
  shownRef.current = shown;
  const toTop = useRef(scrollToTop);
  toTop.current = scrollToTop;
  // The new rows are on their way: they rise once drawn.
  const arriving = useRef(false);

  const fade = useSharedValue(1);
  const lift = useSharedValue(0);

  const settled = useCallback(() => {
    // Chosen again during the rise: dip again.
    if (!same(pending.current, shownRef.current)) dip();
    else setQuiet(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const rise = useCallback(() => {
    const timing = { duration: reducedAtLaunch ? RISE_REDUCED_MS : duration.base, easing: easeOut, reduceMotion: keep };
    lift.value = reducedAtLaunch ? 0 : RISE_FROM;
    lift.value = withTiming(0, timing);
    fade.value = withTiming(1, timing, (finished) => {
      if (finished) scheduleOnRN(settled);
    });
  }, [fade, lift, settled]);

  // Out of sight: change what's shown, or, back where it was, simply rise.
  const swap = useCallback(() => {
    toTop.current?.();
    if (same(pending.current, shownRef.current)) {
      rise();
      return;
    }
    arriving.current = true;
    setShown(pending.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rise]);

  const dip = useCallback(() => {
    const left = fade.get();
    const timing = { duration: Math.max(16, (reducedAtLaunch ? DIP_REDUCED_MS : DIP_MS) * left), easing: easeIn, reduceMotion: keep };
    lift.value = withTiming(reducedAtLaunch ? 0 : DIP_LIFT, timing);
    fade.value = withTiming(0, timing, (finished) => {
      if (finished) scheduleOnRN(swap);
    });
  }, [fade, lift, swap]);

  // The first content arriving (the lists were still loading): it rises in, the
  // placeholders going, rather than appearing in one frame.
  const wasReady = useRef(ready);
  useEffect(() => {
    if (ready && !wasReady.current) {
      fade.value = 0;
      const frame = requestAnimationFrame(rise);
      wasReady.current = true;
      return () => cancelAnimationFrame(frame);
    }
    wasReady.current = ready;
  }, [ready, fade, rise]);

  // The new rows are committed: they're drawn by the next frame, then rise.
  useEffect(() => {
    if (!arriving.current) return;
    arriving.current = false;
    const frame = requestAnimationFrame(rise);
    return () => cancelAnimationFrame(frame);
  }, [shown, rise]);

  /** A choice made by tapping: a tick, and the list dips. */
  const choose = (next: T, { silent = false }: { silent?: boolean } = {}) => {
    if (!silent) tick();
    pending.current = next;
    setChosen(next);
    setQuiet(true);
    dip();
  };
  /** The app changing it, not a tap (the chosen area renamed or removed): at once, no tick. */
  const reset = (next: T) => {
    pending.current = next;
    setChosen(next);
    setShown(next);
  };

  const listStyle = useAnimatedStyle(() => ({ opacity: fade.value, transform: [{ translateY: lift.value }] }));
  return { chosen, shown, quiet, choose, reset, listStyle };
}
