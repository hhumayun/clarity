import { useCallback, useRef } from "react";
import { useReanimatedKeyboardAnimation } from "react-native-keyboard-controller";
import {
  runOnJS,
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from "react-native-reanimated";
import { EASE_OUT, MOTION } from "../ui/motion";

/** A glide whose progress is the keyboard's own, so the two move as one. */
type Glide = { from: number; to: number; toContent: boolean; kFrom: number; kTo: number };

// If the keyboard has not started moving by now, it is not going to (a
// hardware keyboard, say): finish on an ordinary ease instead.
const KEYBOARD_START_MS = 350;

/**
 * The height of a panel that can trade places with the keyboard.
 *
 * Opening or closing on its own, it eases over the usual time. Opening as
 * the keyboard goes down, or closing as it comes up, its height follows the
 * keyboard's position frame by frame: the panel shrinks exactly as fast as
 * the keyboard grows, so the two read as one movement rather than two that
 * happen to overlap. The keyboard's position comes from
 * react-native-keyboard-controller, which also moves the box around them.
 *
 * Closing can also go in steps (`fadeFirst`): the contents fade out where
 * they are, then the panel folds, so what was showing has gone before
 * anything around it moves.
 *
 * Set `contentHeight` from the panel's content (laid out at its natural
 * size), and put `style` on the clipping wrapper.
 */
export function useKeyboardSyncedHeight(onClosed: () => void) {
  const { progress: keyboard } = useReanimatedKeyboardAnimation();
  const height = useSharedValue(0);
  const contentHeight = useSharedValue(0);
  const opened = useSharedValue(false);
  const glide = useSharedValue<Glide | null>(null);
  // The contents' own opacity, for closing in steps.
  const fade = useSharedValue(1);
  const onClosedRef = useRef(onClosed);
  onClosedRef.current = onClosed;
  // Something to do once this close has finished (e.g. bring the keyboard back).
  const afterCloseRef = useRef<(() => void) | undefined>(undefined);
  const finishClose = useCallback(() => {
    onClosedRef.current();
    const after = afterCloseRef.current;
    afterCloseRef.current = undefined;
    after?.();
  }, []);

  // Follow the keyboard while a glide is tied to it.
  useAnimatedReaction(
    () => keyboard.value,
    (k) => {
      const g = glide.value;
      if (!g) return;
      const span = g.kTo - g.kFrom;
      const t = span === 0 ? 1 : Math.min(1, Math.max(0, (k - g.kFrom) / span));
      const to = g.toContent ? contentHeight.value : g.to;
      height.value = g.from + (to - g.from) * t;
      if (t >= 1) {
        glide.value = null;
        if (!opened.value) runOnJS(finishClose)();
      }
    },
  );

  // Content that changes size while open (or is measured a frame after
  // opening) is eased to, unless the keyboard is driving.
  useAnimatedReaction(
    () => contentHeight.value,
    (next, previous) => {
      if (!opened.value || glide.value || next === previous) return;
      height.value = withTiming(next, { duration: MOTION.slow, easing: EASE_OUT });
    },
  );

  const ease = useCallback(
    (to: number, closing: boolean) => {
      glide.value = null;
      height.value = withTiming(to, { duration: MOTION.slow, easing: EASE_OUT }, (finished) => {
        if (finished && closing) runOnJS(finishClose)();
      });
    },
    [finishClose, glide, height],
  );

  /** If a keyboard-tied glide never gets going, finish it on a plain ease. */
  const guard = useCallback(
    (kFrom: number) => {
      setTimeout(() => {
        const g = glide.value;
        if (!g || Math.abs(keyboard.value - kFrom) > 0.02) return;
        ease(opened.value ? contentHeight.value : 0, !opened.value);
      }, KEYBOARD_START_MS);
    },
    [contentHeight, ease, glide, keyboard, opened],
  );

  /** Open to the content's height; with "hide", in step with the keyboard going down. */
  const open = useCallback(
    (withKeyboard?: "hide") => {
      opened.value = true;
      afterCloseRef.current = undefined;
      fade.value = 1;
      const k = keyboard.value;
      if (withKeyboard === "hide" && k > 0.05) {
        glide.value = { from: height.value, to: 0, toContent: true, kFrom: k, kTo: 0 };
        guard(k);
      } else if (contentHeight.value > 0) {
        ease(contentHeight.value, false);
      }
      // Otherwise the content's first measurement starts the ease.
    },
    [contentHeight, ease, fade, glide, guard, height, keyboard, opened],
  );

  /**
   * Close to nothing. With `withKeyboard: "show"`, in step with the keyboard
   * coming up; with `fadeFirst`, the contents fade out first and then the
   * panel folds. `then` runs once it has gone.
   */
  const close = useCallback(
    (opts: { withKeyboard?: "show"; fadeFirst?: boolean; then?: () => void } = {}) => {
      opened.value = false;
      afterCloseRef.current = opts.then;
      if (opts.fadeFirst) {
        glide.value = null;
        fade.value = withTiming(0, { duration: MOTION.fast, easing: EASE_OUT });
        height.value = withDelay(
          MOTION.fast,
          withTiming(0, { duration: MOTION.slow, easing: EASE_OUT }, (finished) => {
            if (finished) runOnJS(finishClose)();
          }),
        );
        return;
      }
      const k = keyboard.value;
      if (opts.withKeyboard === "show" && k < 0.95) {
        glide.value = { from: height.value, to: 0, toContent: false, kFrom: k, kTo: 1 };
        guard(k);
      } else {
        ease(0, true);
      }
    },
    [ease, fade, finishClose, glide, guard, height, keyboard, opened],
  );

  /** Forget the content's size once the panel is gone, so it is measured afresh. */
  const reset = useCallback(() => {
    glide.value = null;
    height.value = 0;
    contentHeight.value = 0;
    fade.value = 1;
  }, [contentHeight, fade, glide, height]);

  const style = useAnimatedStyle(() => ({
    height: height.value,
    opacity:
      fade.value * (contentHeight.value > 0 ? Math.min(1, height.value / contentHeight.value) : 0),
  }));

  return { style, contentHeight, open, close, reset };
}
