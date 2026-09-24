import React, { useMemo } from "react";
import { StyleSheet, TextInput, type TextInputProps } from "react-native";
import { radius, spacing, type Colors, type Fonts } from "../theme";
import { useAppTheme } from "../providers/AppThemeProvider";

export function TextArea({ style, ...props }: TextInputProps) {
  const { colors, fonts, scale } = useAppTheme();
  const styles = useMemo(() => makeStyles(colors, scale, fonts), [colors, scale, fonts]);
  return (
    <TextInput
      multiline
      textAlignVertical="top"
      placeholderTextColor={colors.mutedForeground}
      style={[styles.input, style]}
      {...props}
    />
  );
}

function makeStyles(colors: Colors, scale: number, fonts: Fonts) {
  return StyleSheet.create({
    input: {
      minHeight: 96,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.card,
      color: colors.foreground,
      fontFamily: fonts.base,
      fontSize: 17 * scale,
      paddingHorizontal: spacing[4],
      paddingVertical: spacing[3],
    },
  });
}
