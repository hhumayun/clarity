import React from "react";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { interpolate, useAnimatedStyle, useReducedMotion, useSharedValue, withSpring } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { calm, spring } from "../theme/motion";
import { useTheme } from "../theme/ThemeProvider";
import { pad } from "../theme/tokens";
import { tick } from "./haptics";
import { Icon } from "./Icon";

/** How far a row must travel before letting go acts. */
const THRESHOLD = 84;

/**
 * Two-way swipe on a task row. Right finishes it (or brings it back): the
 * row follows the finger over the accent's tint and the check grows as it
 * nears the mark. Left, on an open task, opens focus over the well with a
 * timer. Past the mark a selection tick is felt and the glyph pops; letting
 * go there acts, anywhere else the row springs home. Rubber-banded, so it
 * never runs away. No words: the glyph says it.
 */
export function SwipeRow({
  done,
  onToggle,
  onFocus,
  onSwipe,
  inset,
  children,
}: {
  /** The part of the row that's its card (insets, corners): the swipe's colour covers only that. */
  inset?: StyleProp<ViewStyle>;
  done: boolean;
  onToggle: () => void;
  /** Left swipe; omitted for finished tasks. */
  onFocus?: () => void;
  /** Told when a swipe starts (true) and ends (false), so the row can ignore the tap that ends it. */
  onSwipe?: (swiping: boolean) => void;
  children: React.ReactNode;
}) {
  const { colors, accent } = useTheme();
  const reduced = useReducedMotion();
  const x = useSharedValue(0);
  const past = useSharedValue(0);
  const canFocus = !!onFocus;

  const band = (dx: number) => {
    "worklet";
    const max = THRESHOLD * 1.35;
    const a = Math.abs(dx);
    const v = a < max ? a : max + (a - max) * 0.22;
    return dx < 0 ? -v : v;
  };

  const pan = Gesture.Pan()
    .activeOffsetX([-14, 14])
    .failOffsetY([-10, 10])
    .onStart(() => {
      if (onSwipe) scheduleOnRN(onSwipe, true);
    })
    .onUpdate((event) => {
      const dx = canFocus ? event.translationX : Math.max(0, event.translationX);
      x.value = band(dx);
      const side = x.value >= THRESHOLD ? 1 : x.value <= -THRESHOLD ? -1 : 0;
      if (side !== past.value) {
        past.value = side;
        if (side !== 0) scheduleOnRN(tick);
      }
    })
    .onEnd(() => {
      if (past.value === 1) scheduleOnRN(onToggle);
      if (past.value === -1 && onFocus) scheduleOnRN(onFocus);
      past.value = 0;
      x.value = withSpring(0, reduced ? calm : spring.glide);
    })
    .onFinalize(() => {
      if (x.value !== 0 && past.value === 0) x.value = withSpring(0, reduced ? calm : spring.glide);
      if (onSwipe) scheduleOnRN(onSwipe, false);
    });

  const row = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }));
  const right = useAnimatedStyle(() => ({ opacity: x.value > 0 ? 1 : 0 }));
  const left = useAnimatedStyle(() => ({ opacity: x.value < 0 ? 1 : 0 }));
  const checkGlyph = useAnimatedStyle(() => ({
    opacity: interpolate(x.value, [0, 24, THRESHOLD], [0, 0.4, 1], "clamp"),
    transform: [{ scale: interpolate(x.value, [THRESHOLD - 14, THRESHOLD, THRESHOLD + 10], [0.75, 1.18, 1], "clamp") }],
  }));
  const timerGlyph = useAnimatedStyle(() => ({
    opacity: interpolate(-x.value, [0, 24, THRESHOLD], [0, 0.4, 1], "clamp"),
    transform: [{ scale: interpolate(-x.value, [THRESHOLD - 14, THRESHOLD, THRESHOLD + 10], [0.75, 1.18, 1], "clamp") }],
  }));

  return (
    <View style={styles.wrap}>
      <Animated.View style={[StyleSheet.absoluteFill, styles.right, inset, { backgroundColor: done ? colors.sunken : accent.soft }, right]}>
        <Animated.View style={[styles.disc, { backgroundColor: done ? colors.card : accent.solid }, checkGlyph]}>
          <Icon name={done ? "undo" : "check"} size={18} color={done ? colors.ink2 : accent.on} weight="bold" />
        </Animated.View>
      </Animated.View>
      {canFocus ? (
        <Animated.View style={[StyleSheet.absoluteFill, styles.left, inset, { backgroundColor: colors.sunken }, left]}>
          <Animated.View style={[styles.disc, { backgroundColor: colors.card }, timerGlyph]}>
            <Icon name="timer" size={18} color={colors.ink} weight="semibold" />
          </Animated.View>
        </Animated.View>
      ) : null}
      <GestureDetector gesture={pan}>
        <Animated.View style={row}>{children}</Animated.View>
      </GestureDetector>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { overflow: "hidden" },
  right: { justifyContent: "center", alignItems: "flex-start", paddingLeft: pad },
  left: { justifyContent: "center", alignItems: "flex-end", paddingRight: pad },
  disc: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
});
