import React from "react";
import { Switch as RNSwitch, type SwitchProps } from "react-native";
import { useAppTheme } from "../providers/AppThemeProvider";

export function Switch(props: SwitchProps) {
  const { colors } = useAppTheme();
  return (
    <RNSwitch
      trackColor={{ false: colors.border, true: colors.primary }}
      thumbColor={colors.card}
      ios_backgroundColor={colors.border}
      {...props}
    />
  );
}
