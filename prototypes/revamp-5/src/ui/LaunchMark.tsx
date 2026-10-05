import React from "react";
import { StyleSheet } from "react-native";
import Animated, { withDelay, withSpring, withTiming } from "react-native-reanimated";
import Svg, { Path } from "react-native-svg";
import { duration, easeOut, spring } from "../theme/motion";
import { useTheme } from "../theme/ThemeProvider";
import { face } from "../theme/tokens";

/**
 * The mark at launch, stacked the way Rosebud stacks its own: a leaf in
 * your colour grows in with a little turn, then the name settles under it.
 * A new key replays it.
 */
export function LaunchMark({ scale = 1 }: { scale?: number }) {
  const { colors, accent } = useTheme();
  const grow = () => {
    "worklet";
    return {
      initialValues: { opacity: 0, transform: [{ scale: 0.4 }, { rotate: "-24deg" }] },
      animations: {
        opacity: withTiming(1, { duration: duration.quick }),
        transform: [{ scale: withSpring(1, spring.pop) }, { rotate: withSpring("0deg", spring.glide) }],
      },
    };
  };
  const name = () => {
    "worklet";
    return {
      initialValues: { opacity: 0, transform: [{ translateY: 8 }] },
      animations: {
        opacity: withDelay(260, withTiming(1, { duration: duration.base, easing: easeOut })),
        transform: [{ translateY: withDelay(260, withSpring(0, spring.glide)) }],
      },
    };
  };
  const size = 56 * scale;
  return (
    <Animated.View style={styles.mark}>
      <Animated.View entering={grow}>
        <Svg width={size} height={size} viewBox="0 0 56 56">
          <Path d="M10 46 C10 24 24 10 46 10 C46 32 32 46 10 46 Z" fill={accent.solid} />
          <Path d="M14 42 C22 34 30 26 38 18" stroke={accent.on} strokeWidth={2.6} strokeLinecap="round" fill="none" opacity={0.85} />
        </Svg>
      </Animated.View>
      <Animated.Text entering={name} style={{ fontFamily: face.heavy, color: colors.ink, fontSize: 34 * scale, lineHeight: 40 * scale, letterSpacing: -0.8 * scale }}>
        clarity
      </Animated.Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  mark: { alignItems: "center", gap: 10 },
});
