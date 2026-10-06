import { useEffect, useRef } from "react";
import { useAnimatedStyle, useReducedMotion, useSharedValue, withSpring, withTiming } from "react-native-reanimated";
import { calm, keep, spring } from "../theme/motion";

/**
 * The stretching pill: the chosen-marker under a week day, a tab, a segment.
 * Its two edges are separate springs. The edge in the direction of travel
 * leads and the other trails, so the pill stretches toward where it's going
 * and gathers itself when it lands. Placed at once on first layout.
 */
export function useStretch(index: number, slot: number, inset = 0) {
  const reduced = useReducedMotion();
  const start = useSharedValue(0);
  const end = useSharedValue(0);
  const placed = useRef(false);
  const last = useRef(index);
  useEffect(() => {
    if (slot <= 0) return;
    const s = index * slot;
    const e = s + slot;
    if (!placed.current) {
      placed.current = true;
      start.value = s;
      end.value = e;
      last.current = index;
      return;
    }
    const right = index > last.current;
    last.current = index;
    start.value = withSpring(s, reduced ? calm : right ? spring.trail : spring.lead);
    end.value = withSpring(e, reduced ? calm : right ? spring.lead : spring.trail);
  }, [index, slot, start, end, reduced]);
  return useAnimatedStyle(() => ({
    transform: [{ translateX: start.value + inset }],
    width: Math.max(0, end.value - start.value - inset * 2),
  }));
}

/**
 * The same pill for places of different widths (a row of chips): it goes to
 * `x` and `width` as measured, the leading edge on `lead`, the trailing on
 * `trail`, placed at once the first time. Under Reduce Motion it doesn't
 * travel: it fades out where it was and back in where it's going.
 */
export function useStretchTo(x: number, width: number) {
  const reduced = useReducedMotion();
  const start = useSharedValue(x);
  const end = useSharedValue(x + width);
  const shown = useSharedValue(1);
  const placed = useRef(false);
  const last = useRef(x);
  useEffect(() => {
    if (width <= 0) return;
    const s = x;
    const e = x + width;
    if (!placed.current) {
      placed.current = true;
      start.value = s;
      end.value = e;
      last.current = x;
      return;
    }
    const right = x > last.current;
    last.current = x;
    if (reduced) {
      shown.value = withTiming(0, { duration: 70, reduceMotion: keep }, (finished) => {
        if (!finished) return;
        start.value = s;
        end.value = e;
        shown.value = withTiming(1, { duration: 140, reduceMotion: keep });
      });
      return;
    }
    start.value = withSpring(s, right ? spring.trail : spring.lead);
    end.value = withSpring(e, right ? spring.lead : spring.trail);
  }, [x, width, start, end, shown, reduced]);
  return useAnimatedStyle(() => ({
    opacity: shown.value,
    transform: [{ translateX: start.value }],
    width: Math.max(0, end.value - start.value),
  }));
}
