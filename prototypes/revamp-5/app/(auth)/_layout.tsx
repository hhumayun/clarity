import { Stack } from "expo-router";
import React from "react";
import { useTheme } from "../../src/theme/ThemeProvider";

/** Signing in or making an account opens on the welcome; each step after it is pushed, so Back goes one step. */
export const unstable_settings = { initialRouteName: "welcome" };

export default function AuthLayout() {
  const { colors } = useTheme();
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.page } }} />;
}
