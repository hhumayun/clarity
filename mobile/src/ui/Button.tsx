import React, { useMemo } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  type PressableProps,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import { fonts, radius, spacing, type Colors } from "../theme";
import { useAppTheme } from "../providers/AppThemeProvider";

type Variant = "primary" | "secondary" | "ghost" | "destructive";
type Size = "sm" | "md" | "lg" | "icon";

type Props = PressableProps & {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
};

export function Button({
  variant = "primary",
  size = "md",
  loading,
  disabled,
  children,
  style,
  textStyle,
  ...rest
}: Props) {
  const { colors, scale } = useAppTheme();
  const styles = useMemo(() => makeStyles(colors, scale), [colors, scale]);
  const isIcon = size === "icon";

  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled || loading}
      style={({ pressed }) => [
        styles.base,
        styles[variant],
        styles[size],
        (disabled || loading) && styles.disabled,
        pressed && !disabled && styles.pressed,
        style,
      ]}
      {...rest}
    >
      {loading ? (
        <ActivityIndicator
          color={variant === "primary" ? colors.primaryForeground : colors.foreground}
        />
      ) : typeof children === "string" ? (
        <Text style={[styles.label, styles[`${variant}Label`], isIcon && styles.iconLabel, textStyle]}>
          {children}
        </Text>
      ) : (
        children
      )}
    </Pressable>
  );
}

function makeStyles(colors: Colors, scale: number) {
  return StyleSheet.create({
    base: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: spacing[2],
      borderRadius: radius.md,
    },
    primary: { backgroundColor: colors.primary },
    secondary: { backgroundColor: colors.secondary },
    ghost: { backgroundColor: "transparent" },
    destructive: { backgroundColor: colors.error },
    sm: { minHeight: 40, paddingHorizontal: spacing[3] },
    md: { minHeight: 48, paddingHorizontal: spacing[4] },
    lg: { minHeight: 56, paddingHorizontal: spacing[6] },
    icon: { width: 48, height: 48, paddingHorizontal: 0 },
    disabled: { opacity: 0.5 },
    pressed: { opacity: 0.85 },
    label: {
      fontFamily: fonts.baseSemi,
      fontSize: 16 * scale,
    },
    primaryLabel: { color: colors.primaryForeground },
    secondaryLabel: { color: colors.secondaryForeground },
    ghostLabel: { color: colors.foreground },
    destructiveLabel: { color: colors.errorForeground },
    iconLabel: { fontSize: 18 * scale },
  });
}
