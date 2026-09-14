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
      backgroundColor: colors.accent,
      borderRadius: radius.md,
      paddingHorizontal: spacing[4],
      paddingVertical: spacing[3],
    },
    mark: { color: colors.accentForeground, fontSize: 16 * scale },
    question: {
      flex: 1,
      fontFamily: fonts.base,
      fontSize: 15 * scale,
      color: colors.accentForeground,
    },
    hint: {
      fontFamily: fonts.baseSemi,
      fontSize: 12 * scale,
      color: colors.accentForeground,
    },
  });
}
