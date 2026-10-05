import React, { useEffect, useRef, useState } from "react";
import { StyleSheet, Text, View, type StyleProp, type TextStyle } from "react-native";
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from "react-native-reanimated";
import { useDevice } from "../state/device";
import { duration, easeOut } from "../theme/motion";
import { type, type TypeName } from "../theme/tokens";
import { LARGE_TEXT } from "./Txt";

/**
 * A number that rolls rather than flashes: the old value slides out one
 * way as the new one slides in, up when it grows and down when it shrinks.
 * Used for the focus minutes, and nowhere that would count the user's own
 * notes or tasks. With Reduce Motion, a cross-fade.
 */
export function Roll({
  value,
  variant = "title3",
  color,
  style,
  align = "left",
  accessibilityLabel,
}: {
  value: string | number;
  variant?: TypeName;
  color: string;
  style?: StyleProp<TextStyle>;
  align?: "left" | "center" | "right";
  accessibilityLabel?: string;
}) {
  const reduced = useReducedMotion();
  const large = useDevice((state) => state.prefs.largeText);
  const text = String(value);
  const [shown, setShown] = useState({ current: text, previous: null as string | null, up: true });
  const progress = useSharedValue(1);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    setShown((old) => {
      if (old.current === text) return old;
      const a = Number.parseFloat(old.current);
      const b = Number.parseFloat(text);
      return { current: text, previous: old.current, up: Number.isNaN(a) || Number.isNaN(b) ? true : b >= a };
    });
    progress.value = 0;
    progress.value = withTiming(1, { duration: duration.roll, easing: easeOut });
  }, [text, progress]);

  const base = type[variant];
  const size = large ? { fontSize: Math.round(base.fontSize * LARGE_TEXT), lineHeight: Math.round(base.lineHeight * LARGE_TEXT) } : null;
  const travel = (size?.lineHeight ?? base.lineHeight) * 0.8;
  const dir = shown.up ? 1 : -1;
  const incoming = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ translateY: reduced ? 0 : (1 - progress.value) * travel * dir }],
  }));
  const outgoing = useAnimatedStyle(() => ({
    opacity: 1 - progress.value,
    transform: [{ translateY: reduced ? 0 : -progress.value * travel * dir }],
  }));
  const textStyle = [base, size, { color, textAlign: align }, style];
  return (
    <View accessible accessibilityLabel={accessibilityLabel ?? text}>
      {/* The current value sets the size; the previous one rides over it while it leaves. */}
      <Animated.View style={incoming}>
        <Text style={textStyle}>{shown.current}</Text>
      </Animated.View>
      {shown.previous !== null ? (
        <Animated.View style={[StyleSheet.absoluteFill, outgoing]} pointerEvents="none">
          <Text style={textStyle}>{shown.previous}</Text>
        </Animated.View>
      ) : null}
    </View>
  );
}

