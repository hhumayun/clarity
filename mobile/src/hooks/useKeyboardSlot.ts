import { useCallback, useRef } from "react";
import { useReanimatedKeyboardAnimation } from "react-native-keyboard-controller";
import {
  runOnJS,
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { EASE_OUT, MOTION } from "../ui/motion";

// If the keyboard has not started moving by now, it is not going to (a
// hardware keyboard, say): finish on an ordinary ease instead.
const KEYBOARD_START_MS = 350;
// How far the panel sinks as the keyboard covers it, for a sense of it
// going down rather than just being painted over.
const SINK = 24;

/**
 * A panel that takes the keyboard's place, like a custom keyboard: it sits
 * below the box, where the keyboard would be, and is as tall as the keyboard
 * (or its own content, if taller).
 *
 * Swapping with the keyboard, it follows the keyboard's position frame by
 * frame: as the keyboard goes down the panel comes up, and as the keyboard
 * comes back the panel goes down under it. The keyboard's space and the
 * panel's always add up to the same height, so the box above them does not
 * move. The keyboard's position comes from react-native-keyboard-controller,
 * whose KeyboardAvoidingView moves the box on the same clock.
 *
 * Put `slotStyle` on the clipping slot below the box's content, set
 * `contentHeight` from the panel's content, and put `contentStyle` on it.
 */
export function useKeyboardSlot(onHidden: () => void) {
  const { height: keyboardHeight, progress: keyboard } = useReanimatedKeyboardAnimation();
  // The keyboard's full height, last time it was all the way up.
  const fullKeyboard = useSharedValue(0);
  const contentHeight = useSharedValue(0);
  // How much of the slot is showing, 0 to 1.
  const shown = useSharedValue(0);
  // While true the slot follows the keyboard: shown = 1 - keyboard.
  const tied = useSharedValue(false);
  const wanted = useSharedValue(false);
  const onHiddenRef = useRef(onHidden);
  onHiddenRef.current = onHidden;
  const finishHide = useCallback(() => onHiddenRef.current(), []);

  useAnimatedReaction(
    () => [keyboard.value, keyboardHeight.value] as const,
    ([p, h]) => {
      if (p > 0.99) fullKeyboard.value = -h;
      if (!tied.value) return;
      shown.value = 1 - p;
      if (!wanted.value && p >= 0.999) {
        tied.value = false;
        runOnJS(finishHide)();
      } else if (wanted.value && p <= 0.001) {
        tied.value = false;
      }
    },
  );

  const ease = useCallback(
    (to: 0 | 1) => {
      tied.value = false;
      shown.value = withTiming(to, { duration: MOTION.slow, easing: EASE_OUT }, (finished) => {
        if (finished && to === 0) runOnJS(finishHide)();
      });
    },
    [finishHide, shown, tied],
  );

  /** If the keyboard never starts its move, finish on a plain ease. */
  const guard = useCallback(
    (from: number) => {
      setTimeout(() => {
        if (!tied.value || Math.abs(keyboard.value - from) > 0.02) return;
        ease(wanted.value ? 1 : 0);
      }, KEYBOARD_START_MS);
    },
    [ease, keyboard, tied, wanted],
  );

  /** Show the panel; with the keyboard up, it rises as the keyboard goes down. */
  const show = useCallback(() => {
    wanted.value = true;
    const p = keyboard.value;
    if (p > 0.05) {
      tied.value = true;
      guard(p);
    } else {
      ease(1);
    }
  }, [ease, guard, keyboard, tied, wanted]);

  /** Hide the panel; with the keyboard coming back, it goes down as the keyboard rises. */
  const hide = useCallback(
    (keyboardComing: boolean) => {
      wanted.value = false;
      const p = keyboard.value;
      if (keyboardComing && p < 0.95) {
        tied.value = true;
        guard(p);
      } else {
        ease(0);
      }
    },
    [ease, guard, keyboard, tied, wanted],
  );

  const reset = useCallback(() => {
    tied.value = false;
    wanted.value = false;
    shown.value = 0;
    contentHeight.value = 0;
  }, [contentHeight, shown, tied, wanted]);

  const slotStyle = useAnimatedStyle(() => ({
    height: Math.max(contentHeight.value, fullKeyboard.value) * shown.value,
  }));
  const contentStyle = useAnimatedStyle(() => ({
    opacity: 0.3 + 0.7 * shown.value,
    transform: [{ translateY: (1 - shown.value) * SINK }],
  }));

  return { slotStyle, contentStyle, contentHeight, show, hide, reset };
}
