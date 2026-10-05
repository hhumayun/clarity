import React, { useEffect, useState } from "react";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withDelay, withSpring, withTiming } from "react-native-reanimated";
import { duration, easeOut, spring } from "../theme/motion";
import { useTheme } from "../theme/ThemeProvider";
import { space } from "../theme/tokens";
import { Icon, type IconName } from "./Icon";
import { Txt } from "./Txt";

const CLOSED = 40;

/**
 * Quiet acknowledgement: a small ink capsule with the accent's check
 * appears and springs open to the width of what it has to say, rests,
 * then gathers itself back in and goes. Nobody waits for it and it never
 * takes a tap.
 */
export function SavedPill({ visible, label, icon = "check", style }: { visible: boolean; label: string; icon?: IconName; style?: StyleProp<ViewStyle> }) {
  const { colors, accent } = useTheme();
  const reduced = useReducedMotion();
  const [width, setWidth] = useState(0);
  const [mounted, setMounted] = useState(visible);
  const open = useSharedValue(0);
  const w = useSharedValue(CLOSED);
  const words = useSharedValue(0);

  useEffect(() => {
    if (visible) setMounted(true);
  }, [visible]);

  useEffect(() => {
    if (!mounted || width === 0) return;
    if (visible) {
      open.value = withTiming(1, { duration: duration.quick, easing: easeOut });
      w.value = reduced ? width : withSpring(width, spring.glide);
      words.value = withDelay(reduced ? 0 : 120, withTiming(1, { duration: duration.base, easing: easeOut }));
      return;
    }
    // Leaving: the words go first, the capsule gathers, then it fades.
    words.value = withTiming(0, { duration: 110, easing: easeOut });
    w.value = withDelay(80, withTiming(CLOSED, { duration: 200, easing: easeOut }));
    open.value = withDelay(220, withTiming(0, { duration: duration.quick, easing: easeOut }));
    const timer = setTimeout(() => setMounted(false), 420);
    return () => clearTimeout(timer);
  }, [visible, mounted, width, reduced, open, w, words]);

  const capsule = useAnimatedStyle(() => ({
    width: w.value,
    opacity: open.value,
    transform: [{ translateY: reduced ? 0 : (1 - open.value) * -8 }, { scale: reduced ? 1 : 0.86 + 0.14 * open.value }],
  }));
  const content = useAnimatedStyle(() => ({ opacity: words.value }));

  if (!mounted) return null;
  const row = (
    <>
      <View style={[styles.check, { backgroundColor: accent.solid }]}>
        <Icon name={icon} size={11} color={accent.on} weight="bold" />
      </View>
      <Txt variant="subhead" weight="bold" numberOfLines={1} style={{ color: colors.page }}>
        {label}
      </Txt>
    </>
  );
  return (
    <View style={[styles.wrap, style]} pointerEvents="none" accessibilityLiveRegion="polite" accessibilityLabel={label}>
      <Animated.View style={[styles.capsule, { backgroundColor: colors.ink, boxShadow: colors.shadow }, capsule]}>
        <Animated.View style={[styles.row, content]}>{row}</Animated.View>
      </Animated.View>
      {/* Measured once, off to the side: the width the capsule opens to. */}
      <View style={[styles.row, styles.measure]} onLayout={(event) => setWidth(Math.ceil(event.nativeEvent.layout.width))}>
        {row}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: "absolute", left: 0, right: 0, alignItems: "center" },
  capsule: { height: CLOSED, borderRadius: CLOSED / 2, borderCurve: "continuous", overflow: "hidden", alignItems: "center", justifyContent: "center" },
  row: { flexDirection: "row", alignItems: "center", gap: space[2], paddingLeft: 10, paddingRight: 16, height: CLOSED },
  measure: { position: "absolute", opacity: 0, top: 0 },
  check: { width: 20, height: 20, borderRadius: 10, alignItems: "center", justifyContent: "center" },
});
