import { useColorScheme } from "react-native";

export type ThemeMode = "light" | "dark" | "auto";

const light = {
  background: "#faf6f0",
  foreground: "#2c2a26",
  surface: "#f4efe7",
  card: "#ffffff",
  primary: "#3e8e8c",
  primaryForeground: "#ffffff",
  secondary: "#efe9e0",
  secondaryForeground: "#43403a",
  muted: "#f1ece4",
  mutedForeground: "#6f6a61",
  accent: "#e4f0ef",
  accentForeground: "#2b5f5e",
  error: "#c4574e",
  errorForeground: "#ffffff",
  success: "#41775c",
  warning: "#b45b38",
  // Focus-time break: a warm amber, distinct from the teal of working.
  rest: "#b8791f",
  restSurface: "#f6ead6",
  restForeground: "#2c2a26",
  border: "#e6dfd4",
  suggestionDeeper: "#6d5fa8",
  suggestionContinue: "#b45b38",
  suggestionForward: "#41775c",
};

const dark = {
  background: "#1e1c19",
  foreground: "#f0ede7",
  surface: "#262320",
  card: "#282521",
  primary: "#5fb3b0",
  primaryForeground: "#0f2a29",
  secondary: "#33302b",
  secondaryForeground: "#e4e0d8",
  muted: "#33302b",
  mutedForeground: "#a39c90",
  accent: "#223b3a",
  accentForeground: "#9fd4d2",
  error: "#e07a70",
  errorForeground: "#2a100d",
  success: "#8fc3a7",
  warning: "#de9673",
  rest: "#e3a857",
  restSurface: "#3a2f1f",
  restForeground: "#1e1c19",
  border: "#3a362f",
  suggestionDeeper: "#b0a3dc",
  suggestionContinue: "#de9673",
  suggestionForward: "#8fc3a7",
};

export type Colors = typeof light;

export const spacing = {
  1: 4,
  2: 8,
  3: 12,
  4: 16,
  6: 24,
  8: 32,
  12: 48,
  16: 64,
};

export const radius = {
  sm: 8,
  md: 14,
  lg: 20,
  full: 999,
};

export const fonts = {
  base: "NunitoSans_400Regular",
  baseSemi: "NunitoSans_600SemiBold",
  baseBold: "NunitoSans_700Bold",
  display: "Fraunces_600SemiBold",
};

export function palette(darkMode: boolean): Colors {
  return darkMode ? dark : light;
}

export function useResolvedDark(mode: ThemeMode): boolean {
  const system = useColorScheme();
  if (mode === "light") return false;
  if (mode === "dark") return true;
  return system === "dark";
}

export function fontScale(xlText: boolean): number {
  return xlText ? 21 / 17 : 1;
}
