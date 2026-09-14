import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
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
};

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  accessibilityLabel,
}: Props<T>) {
  const { colors, scale } = useAppTheme();
  const styles = makeStyles(colors, scale);

  return (
    <View style={styles.row} accessibilityRole="tablist" accessibilityLabel={accessibilityLabel}>
      {options.map((option) => {
        const active = option.value === value;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            onPress={() => onChange(option.value)}
            style={[styles.item, active && styles.itemActive]}
          >
            <Text style={[styles.label, active && styles.labelActive]}>{option.label}</Text>
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
      backgroundColor: colors.muted,
      borderRadius: radius.md,
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
    itemActive: { backgroundColor: colors.card },
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
