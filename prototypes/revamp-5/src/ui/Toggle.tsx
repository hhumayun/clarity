import React from "react";
import { Switch, type SwitchProps } from "react-native";
import { useTheme } from "../theme/ThemeProvider";

/** The system switch, in the person's accent when on (Rosebud's toggles are its accent too). */
export function Toggle({ value, onValueChange, ...rest }: Pick<SwitchProps, "value" | "onValueChange" | "accessibilityLabel">) {
  const { colors, accent, dark } = useTheme();
  const off = dark ? colors.line : "#E2DED6";
  const web = process.env.EXPO_OS === "web" ? ({ activeThumbColor: "#FFFFFF", activeTrackColor: accent.solid } as object) : {};
  return <Switch {...rest} {...web} value={value} onValueChange={onValueChange} thumbColor="#FFFFFF" ios_backgroundColor={off} trackColor={{ true: accent.solid, false: off }} />;
}
