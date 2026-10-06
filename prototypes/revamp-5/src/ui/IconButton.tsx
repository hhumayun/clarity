import React from "react";
import { StyleSheet } from "react-native";
import { useTheme } from "../theme/ThemeProvider";
import { Icon, type IconName } from "./Icon";
import { squashSmall } from "../theme/motion";
import { PressableScale } from "./PressableScale";

/**
 * A bare icon with a generous touch target: no disc, no ring. Pressing
 * squashes it a little and it springs back. The icon is the whole message,
 * so `label` is what a screen reader says.
 */
export function IconButton({
  icon,
  onPress,
  label,
  tone = "ink2",
  size = 22,
}: {
  icon: IconName;
  onPress?: () => void;
  label: string;
  tone?: "ink" | "ink2" | "ink3" | "warm" | "danger";
  size?: number;
}) {
  const { colors } = useTheme();
  return (
    <PressableScale onPress={onPress} accessibilityRole="button" accessibilityLabel={label} scaleTo={squashSmall} hitSlop={4} style={styles.button}>
      <Icon name={icon} size={size} color={colors[tone]} weight="medium" />
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  button: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
});
