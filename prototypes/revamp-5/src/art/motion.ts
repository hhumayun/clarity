import { useEffect } from "react";
import {
  cancelAnimation,
  Easing,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";
import { breathe } from "../theme/motion";

/**
 * A value that swings 0 → 1 → 0 forever on a sine, for the small loops in
 * the pictures (a cloud's drift, a star's twinkle, steam). Still at `rest`
 * under Reduce Motion, or when `run` is false.
 */
export function useSwing(period: number, delay = 0, run = true, rest = 0.5): SharedValue<number> {
  const reduced = useReducedMotion();
  const v = useSharedValue(rest);
  useEffect(() => {
    if (reduced || !run) {
      cancelAnimation(v);
      v.value = rest;
      return;
    }
    v.value = 0;
    v.value = withDelay(delay, withRepeat(withSequence(withTiming(1, { duration: period / 2, easing: breathe }), withTiming(0, { duration: period / 2, easing: breathe })), -1));
    return () => cancelAnimation(v);
  }, [reduced, run, period, delay, rest, v]);
  return v;
}

/** A value that runs 0 → 1 over and over at a steady pace (a turning sun, falling sand). */
export function useCycle(period: number, run = true): SharedValue<number> {
  const reduced = useReducedMotion();
  const v = useSharedValue(0);
  useEffect(() => {
    if (reduced || !run) {
      cancelAnimation(v);
      v.value = 0;
      return;
    }
    v.value = 0;
    v.value = withRepeat(withTiming(1, { duration: period, easing: Easing.linear }), -1, false);
    return () => cancelAnimation(v);
  }, [reduced, run, period, v]);
  return v;
}

/** A value that goes 0 → 1 once, after `delay`, when the picture first appears. Already 1 under Reduce Motion. */
export function useOnce(length: number, delay = 0, easing = Easing.bezier(0.16, 1, 0.3, 1)): SharedValue<number> {
  const reduced = useReducedMotion();
  const v = useSharedValue(reduced ? 1 : 0);
  useEffect(() => {
    if (reduced) return;
    v.value = withDelay(delay, withTiming(1, { duration: length, easing }));
  }, [reduced, length, delay, easing, v]);
  return v;
}
