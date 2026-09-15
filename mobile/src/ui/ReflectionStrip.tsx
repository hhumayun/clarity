import React from "react";
import { Pressable, StyleSheet, Text } from "react-native";
import { fonts, radius, spacing, type Colors } from "../theme";
import { useAppTheme } from "../providers/AppThemeProvider";

type Props = {
  question: string;
  onPress: () => void;
};

export function ReflectionStrip({ question, onPress }: Props) {
  const { colors, scale } = useAppTheme();
  const styles = makeStyles(colors, scale);
  return (
    <Pressable
      onPress={onPress}
      style={styles.strip}
      accessibilityLabel={`Reflection question: ${question}. Adds this question to your note so you can answer it.`}
    >
      <Text style={styles.mark}>✦</Text>
      <Text style={styles.question}>{question}</Text>
      <Text style={styles.hint}>tap to answer</Text>
    </Pressable>
  );
}

function makeStyles(colors: Colors, scale: number) {
  return StyleSheet.create({
    strip: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing[2],
      // Muted rather than accent-filled: this sits beside the writing, so it
      // should not be the loudest thing on the screen.
      backgroundColor: colors.muted,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radius.md,
      paddingHorizontal: spacing[3],
      paddingVertical: spacing[2],
    },
    mark: { color: colors.mutedForeground, fontSize: 14 * scale },
    question: {
      flex: 1,
      fontFamily: fonts.base,
      fontSize: 14 * scale,
      color: colors.mutedForeground,
    },
    hint: {
      fontFamily: fonts.baseSemi,
      fontSize: 12 * scale,
      color: colors.mutedForeground,
    },
  });
}
