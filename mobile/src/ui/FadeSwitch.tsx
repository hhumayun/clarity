import React, { useEffect, useRef } from "react";
import { type StyleProp, type ViewStyle } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { EASE_OUT, MOTION } from "./motion";

/**
 * Fades its content in when `switchKey` changes (Today to All tasks, list
 * to days), and at no other time.
 *
 * Deliberately a plain animated opacity rather than a keyed `entering`
 * animation. A keyed remount wrapped the whole screen, so if an entrance
 * was ever left unfinished — a tab screen is detached and re-attached as you
 * navigate away and back — the whole screen stayed at zero opacity. An
 * animated value always ends at 1, and is re-applied on every render.
 */
export function FadeSwitch({
  switchKey,
  style,
  children,
}: {
  switchKey: string;
  style?: StyleProp<ViewStyle>;
  children: React.ReactNode;
}) {
  const opacity = useSharedValue(1);
  const previous = useRef(switchKey);
  useEffect(() => {
    if (previous.current === switchKey) return;
    previous.current = switchKey;
    opacity.value = 0;
    opacity.value = withTiming(1, { duration: MOTION.base, easing: EASE_OUT });
  }, [switchKey, opacity]);
  const fade = useAnimatedStyle(() => ({ opacity: opacity.value }));
  return <Animated.View style={[style, fade]}>{children}</Animated.View>;
}
