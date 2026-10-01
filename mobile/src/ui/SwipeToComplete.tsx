import { Check, RotateCcw } from "lucide-react-native";
import React, { useCallback, useMemo, useRef, useState } from "react";
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  Extrapolation,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  type SharedValue,
} from "react-native-reanimated";
import { hapticTick } from "../lib/haptics";
import { useAppTheme } from "../providers/AppThemeProvider";
import { fonts, spacing, textSize, type Colors } from "../theme";

// How far right a row must be pulled to count. Past it the row follows the
// finger more slowly, so it is felt as a line crossed.
const THRESHOLD = 88;
const PAST_THRESHOLD_GIVE = 0.35;
const RETURN_SPRING = { damping: 20, stiffness: 260, mass: 0.7 };

type Props = {
  /** Whether the task is done: the swipe then undoes it, and says so. */
  done: boolean;
  /** Called once when a swipe is let go past the line. */
  onSwipe: () => void;
  enabled?: boolean;
  /** The row's corner radius, so the colour behind it matches its shape. */
  radius?: number;
  /** Placement of the whole row (margins); the colour behind fills it. */
  style?: StyleProp<ViewStyle>;
  children: React.ReactNode;
};

/**
 * A task row that can be pulled to the right to mark it done (or, for a done
 * task, not done). The colour and the check show from behind as it moves; a
 * tick is felt when it passes the line, and letting go there makes the
 * change. Let go sooner and it springs back with nothing changed.
 *
 * Horizontal only: a mostly vertical drag fails the swipe and scrolls the
 * list, and a tap still reaches the row.
 *
 * Kept light, as a list can hold dozens: at rest a row has one animated
 * style and its gesture; the colour behind it is only built once a swipe
 * starts, and taken away when the row has sprung back.
 */
export function SwipeToComplete({ done, onSwipe, enabled = true, radius = 0, style, children }: Props) {
  const x = useSharedValue(0);
  const armed = useSharedValue(false);
  const [swiping, setSwiping] = useState(false);

  // The gesture is built once; it calls whatever onSwipe is current.
  const onSwipeRef = useRef(onSwipe);
  onSwipeRef.current = onSwipe;
  const fire = useCallback(() => onSwipeRef.current(), []);
  const settle = useCallback(() => setSwiping(false), []);

  const pan = useMemo(
    () =>
      Gesture.Pan()
        .enabled(enabled)
        // Only a drag to the right starts it; a vertical one lets the list scroll.
        .activeOffsetX(12)
        .failOffsetY([-10, 10])
        .onStart(() => {
          runOnJS(setSwiping)(true);
        })
        .onUpdate((event) => {
          const dx = Math.max(0, event.translationX);
          x.value = dx <= THRESHOLD ? dx : THRESHOLD + (dx - THRESHOLD) * PAST_THRESHOLD_GIVE;
          const past = dx >= THRESHOLD;
          if (past !== armed.value) {
            armed.value = past;
            if (past) runOnJS(hapticTick)();
          }
        })
        .onEnd(() => {
          if (armed.value) runOnJS(fire)();
        })
        .onFinalize(() => {
          armed.value = false;
          x.value = withSpring(0, RETURN_SPRING, (finished) => {
            if (finished) runOnJS(settle)();
          });
        }),
    [enabled, fire, settle, x, armed],
  );

  const rowStyle = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }));

  return (
    <View style={style}>
      {swiping ? <SwipeBack x={x} done={done} radius={radius} /> : null}
      <GestureDetector gesture={pan}>
        <Animated.View style={rowStyle}>{children}</Animated.View>
      </GestureDetector>
    </View>
  );
}

/** The colour and the check behind a row being swiped. */
function SwipeBack({ x, done, radius }: { x: SharedValue<number>; done: boolean; radius: number }) {
  const { colors, scale } = useAppTheme();
  const styles = stylesFor(colors, scale);
  const backStyle = useAnimatedStyle(() => ({
    opacity: interpolate(x.value, [0, 20], [0, 1], Extrapolation.CLAMP),
  }));
  // The check grows into place as the line gets closer.
  const markStyle = useAnimatedStyle(() => ({
    opacity: interpolate(x.value, [16, THRESHOLD * 0.7], [0, 1], Extrapolation.CLAMP),
    transform: [{ scale: interpolate(x.value, [16, THRESHOLD], [0.6, 1], Extrapolation.CLAMP) }],
  }));
  const ink = done ? colors.foreground : colors.primaryForeground;
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        StyleSheet.absoluteFill,
        styles.back,
        { borderRadius: radius, backgroundColor: done ? colors.muted : colors.primary },
        backStyle,
      ]}
    >
      <Animated.View style={[styles.mark, markStyle]}>
        {done ? <RotateCcw size={18} color={ink} /> : <Check size={20} color={ink} strokeWidth={2.6} />}
        <Text style={[styles.markText, { color: ink }]}>{done ? "Not done" : "Done"}</Text>
      </Animated.View>
    </Animated.View>
  );
}

// One set of styles per theme and text size, shared by every row.
const styleCache = new WeakMap<Colors, Map<number, ReturnType<typeof makeStyles>>>();
function stylesFor(colors: Colors, scale: number) {
  let byScale = styleCache.get(colors);
  if (!byScale) {
    byScale = new Map();
    styleCache.set(colors, byScale);
  }
  let styles = byScale.get(scale);
  if (!styles) {
    styles = makeStyles(colors, scale);
    byScale.set(scale, styles);
  }
  return styles;
}

function makeStyles(colors: Colors, scale: number) {
  return StyleSheet.create({
    back: { justifyContent: "center", paddingHorizontal: spacing[4] },
    mark: { flexDirection: "row", alignItems: "center", gap: spacing[2] },
    markText: { fontFamily: fonts.baseSemi, fontSize: textSize.small * scale, color: colors.primaryForeground },
  });
}
