import React, { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { EASE_OUT, MOTION } from "./motion";
import { fonts, radius, spacing, type Colors } from "../theme";
import { useAppTheme } from "../providers/AppThemeProvider";

type Option<T extends string> = {
  label: string;
  value: T;
  count?: number;
};

type Props<T extends string> = {
  value: T;
  options: Option<T>[];
  onChange: (value: T) => void;
  accessibilityLabel: string;
  /** "sm" is a quiet, content-width switch for secondary choices. */
  size?: "md" | "sm";
};

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  accessibilityLabel,
  size = "md",
}: Props<T>) {
  const small = size === "sm";
  const { colors, scale } = useAppTheme();
  const styles = useMemo(() => makeStyles(colors, scale), [colors, scale]);

  // One pill that slides to the chosen option, instead of the highlight
  // jumping from one to the next. Positions come from each option's layout.
  const [frames, setFrames] = useState<Record<string, { x: number; y: number; width: number; height: number }>>({});
  const x = useSharedValue(0);
  const width = useSharedValue(0);
  const y = useSharedValue(0);
  const height = useSharedValue(0);
  const placed = useRef(false);
  useEffect(() => {
    const frame = frames[value];
    if (!frame) return;
    if (!placed.current) {
      // First placement lands directly; only later changes glide.
      placed.current = true;
      x.value = frame.x;
      width.value = frame.width;
    } else {
      x.value = withTiming(frame.x, { duration: MOTION.base, easing: EASE_OUT });
      width.value = withTiming(frame.width, { duration: MOTION.base, easing: EASE_OUT });
    }
    y.value = frame.y;
    height.value = frame.height;
  }, [value, frames, x, width, y, height]);
  const pillStyle = useAnimatedStyle(() => ({
    opacity: width.value > 0 ? 1 : 0,
    top: y.value,
    height: height.value,
    width: width.value,
    transform: [{ translateX: x.value }],
  }));

  return (
    <View
      style={[styles.row, small && styles.rowSm]}
      accessibilityRole="tablist"
      accessibilityLabel={accessibilityLabel}
    >
      <Animated.View pointerEvents="none" style={[styles.pill, small && styles.pillSm, pillStyle]} />
      {options.map((option) => {
        const active = option.value === value;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            onPress={() => onChange(option.value)}
            onLayout={(event) => {
              const { x: fx, y: fy, width: fw, height: fh } = event.nativeEvent.layout;
              setFrames((prev) => {
                const old = prev[option.value];
                if (old && old.x === fx && old.width === fw && old.y === fy && old.height === fh) return prev;
                return { ...prev, [option.value]: { x: fx, y: fy, width: fw, height: fh } };
              });
            }}
            style={[styles.item, small && styles.itemSm]}
          >
            <Text style={[styles.label, small && styles.labelSm, active && styles.labelActive]}>
              {option.label}
            </Text>
            {option.count !== undefined ? (
              <Text style={[styles.count, active && styles.labelActive]}>{option.count}</Text>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}

function makeStyles(colors: Colors, scale: number) {
  return StyleSheet.create({
    row: {
      flexDirection: "row",
      backgroundColor: colors.segTrack,
      borderRadius: radius.full,
      padding: 4,
      gap: 4,
    },
    item: {
      flex: 1,
      minHeight: 44,
      borderRadius: radius.sm,
      alignItems: "center",
      justifyContent: "center",
      flexDirection: "row",
      gap: 6,
      paddingHorizontal: spacing[2],
    },
    pill: { position: "absolute", left: 0, borderRadius: radius.sm, backgroundColor: colors.segActive },
    pillSm: { borderRadius: radius.full },
    rowSm: { alignSelf: "center", padding: 3, gap: 3 },
    itemSm: {
      flex: 0,
      minHeight: 30,
      paddingHorizontal: spacing[4],
      borderRadius: radius.full,
    },
    labelSm: { fontSize: 13 * scale },
    label: {
      fontFamily: fonts.baseSemi,
      fontSize: 15 * scale,
      color: colors.mutedForeground,
    },
    labelActive: { color: colors.foreground },
    count: {
      fontFamily: fonts.base,
      fontSize: 13 * scale,
      color: colors.mutedForeground,
    },
  });
}
