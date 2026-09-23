import React, { useMemo } from "react";
import { StyleSheet, View } from "react-native";
import { useAppTheme } from "../providers/AppThemeProvider";
import { type Colors } from "../theme";

// Past this many, separate segments turn to slivers; one continuous bar reads better.
const MAX_SEGMENTS = 10;

type Props = { total: number; filled: number; accessibilityLabel?: string };

/** "1 of 3" as three short bars, the first lit. */
export function SegmentBar({ total, filled, accessibilityLabel }: Props) {
  const { colors } = useAppTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  if (total <= 0) return null;
  const done = Math.max(0, Math.min(filled, total));

  if (total > MAX_SEGMENTS) {
    return (
      <View style={styles.track} accessibilityLabel={accessibilityLabel}>
        <View style={[styles.fill, { width: `${(done / total) * 100}%` }]} />
      </View>
    );
  }
  return (
    <View style={styles.row} accessibilityLabel={accessibilityLabel}>
      {Array.from({ length: total }, (_, i) => (
        <View key={i} style={[styles.segment, i < done && styles.segmentOn]} />
      ))}
    </View>
  );
}

function makeStyles(colors: Colors) {
  return StyleSheet.create({
    row: { flexDirection: "row", gap: 6 },
    segment: { flex: 1, height: 5, borderRadius: 3, backgroundColor: colors.muted },
    segmentOn: { backgroundColor: colors.primary },
    track: { height: 5, borderRadius: 3, backgroundColor: colors.muted, overflow: "hidden" },
    fill: { height: 5, backgroundColor: colors.primary },
  });
}
