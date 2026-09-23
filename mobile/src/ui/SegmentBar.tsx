import React, { useEffect, useMemo } from "react";
import { StyleSheet, View } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { useAppTheme } from "../providers/AppThemeProvider";
import { type Colors } from "../theme";
import { EASE_OUT, MOTION } from "./motion";

// Past this many, separate segments turn to slivers; one continuous bar reads better.
const MAX_SEGMENTS = 10;

type Props = { total: number; filled: number; accessibilityLabel?: string };

/** One segment, filling from the left when it turns on. */
function Segment({ on, styles }: { on: boolean; styles: ReturnType<typeof makeStyles> }) {
  const fill = useSharedValue(on ? 1 : 0);
  useEffect(() => {
    fill.value = withTiming(on ? 1 : 0, { duration: MOTION.slow, easing: EASE_OUT });
  }, [on, fill]);
  const style = useAnimatedStyle(() => ({ width: `${fill.value * 100}%` }));
  return (
    <View style={styles.segment}>
      <Animated.View style={[styles.segmentFill, style]} />
    </View>
  );
}

/** "1 of 3" as three short bars, the first lit. Changes glide rather than snap. */
export function SegmentBar({ total, filled, accessibilityLabel }: Props) {
  const { colors } = useAppTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const done = Math.max(0, Math.min(filled, total));
  const ratio = useSharedValue(total > 0 ? done / total : 0);
  useEffect(() => {
    ratio.value = withTiming(total > 0 ? done / total : 0, { duration: MOTION.slow, easing: EASE_OUT });
  }, [done, total, ratio]);
  const trackFill = useAnimatedStyle(() => ({ width: `${ratio.value * 100}%` }));

  if (total <= 0) return null;
  if (total > MAX_SEGMENTS) {
    return (
      <View style={styles.track} accessibilityLabel={accessibilityLabel}>
        <Animated.View style={[styles.fill, trackFill]} />
      </View>
    );
  }
  return (
    <View style={styles.row} accessibilityLabel={accessibilityLabel}>
      {Array.from({ length: total }, (_, i) => (
        <Segment key={i} on={i < done} styles={styles} />
      ))}
    </View>
  );
}

function makeStyles(colors: Colors) {
  return StyleSheet.create({
    row: { flexDirection: "row", gap: 6 },
    segment: { flex: 1, height: 5, borderRadius: 3, backgroundColor: colors.muted, overflow: "hidden" },
    segmentFill: { height: 5, backgroundColor: colors.primary },
    track: { height: 5, borderRadius: 3, backgroundColor: colors.muted, overflow: "hidden" },
    fill: { height: 5, backgroundColor: colors.primary },
  });
}
