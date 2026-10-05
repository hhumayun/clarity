import { useEffect, useRef } from "react";
import { useAnimatedStyle, useReducedMotion, useSharedValue, withSpring } from "react-native-reanimated";
import { calm, spring } from "../theme/motion";

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
