import React from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { useTheme } from "../theme/ThemeProvider";
import { space } from "../theme/tokens";
import { Icon, type IconName } from "./Icon";
import { Txt } from "./Txt";

/**
 * A section's name: small, grey, centred, sentence case. It labels what
 * follows and never counts it. With `onPress` the name and a small chevron
 * become one quiet link ("Coming up ›").
 */
export function SectionTitle({ title, icon, onPress, accessibilityLabel, first }: { title: string; icon?: IconName; onPress?: () => void; accessibilityLabel?: string; first?: boolean }) {
  const { colors } = useTheme();
  const words = (pressed = false) => (
    <View style={[styles.words, { opacity: pressed ? 0.5 : 1 }]}>
      {icon ? <Icon name={icon} size={15} color={colors.ink3} weight="semibold" /> : null}
      <Txt variant="section" tone="ink3" accessibilityRole="header">
        {title}
      </Txt>
      {onPress ? <Icon name="forward" size={13} color={colors.ink3} weight="bold" /> : null}
    </View>
  );
  return (
    <View style={[styles.row, first && styles.first]}>
      {onPress ? (
        <Pressable onPress={onPress} hitSlop={10} accessibilityRole="button" accessibilityLabel={accessibilityLabel ?? title}>
          {({ pressed }) => words(pressed)}
        </Pressable>
      ) : (
        words()
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { alignItems: "center", paddingTop: space[7], paddingBottom: space[3] },
  first: { paddingTop: space[4] },
  words: { flexDirection: "row", alignItems: "center", gap: 6 },
});
