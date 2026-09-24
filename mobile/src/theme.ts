import { useColorScheme } from "react-native";

export type ThemeMode = "light" | "dark" | "auto";

// Light is the "Morning Paper" palette and dark is "Evening Sage", from the
// Life Center redesign's theme lab. The comment on each colour names the
// design token it comes from; colours the design leaves out are unchanged.
const light = {
  background: "#f6f2ea", // bg
  foreground: "#24211c", // text
  surface: "#ebe5da", // segTrack: recessed boxes
  card: "#fffdf8", // surface
  primary: "#2c6861", // accent
  primaryForeground: "#ffffff", // onAccent
  secondary: "#ebe5da", // segTrack
  secondaryForeground: "#4a453d", // text2
  muted: "#e4ddd0", // track
  mutedForeground: "#655f55", // text3
  accent: "#dfece8", // accentSoft
  accentForeground: "#1d4a44", // accentSoftText
  error: "#c4574e",
  errorForeground: "#ffffff",
  success: "#41775c",
  warning: "#b7791f", // warm: overdue and slipped tasks
  // Focus-time break: a warm amber, distinct from the teal of working.
  rest: "#b7791f", // warm
  restSurface: "#f5e6c9", // warmSoft
  restForeground: "#24211c", // text
  border: "#e4ddd0", // border
  // The Today / All tasks switch: a recessed track with a raised tab.
  segTrack: "#ebe5da", // segTrack
  segActive: "#fffdf8", // segActive
  suggestionDeeper: "#6d5fa8",
  suggestionContinue: "#b45b38",
  suggestionForward: "#41775c",
};

const dark = {
  background: "#1c1b19", // bg
  foreground: "#f1eee8", // text
  surface: "#252421", // segTrack: recessed boxes
  card: "#252421", // surface
  primary: "#7fc1b9", // accent
  primaryForeground: "#10211f", // onAccent
  secondary: "#34332f", // segActive
  secondaryForeground: "#c2bdb3", // text2
  muted: "#34332f", // track
  mutedForeground: "#a39e94", // text3
  accent: "#243a37", // accentSoft
  accentForeground: "#cde8e4", // accentSoftText
  error: "#e07a70",
  errorForeground: "#2a100d",
  success: "#8fc3a7",
  warning: "#dcaa62", // warm: overdue and slipped tasks
  rest: "#dcaa62", // warm
  restSurface: "#332b1f", // warmSoft
  restForeground: "#1c1b19", // bg
  border: "#34332f", // border
  segTrack: "#252421", // segTrack
  segActive: "#34332f", // segActive
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

/**
 * Font roles. Each theme has its own pair, as in the redesign: Morning Paper
 * sets Literata headings over Atkinson Hyperlegible, and Evening Sage sets
 * Fraunces over Figtree. Atkinson Hyperlegible comes only in regular and
 * bold, so its semibold and title roles use the bold.
 */
export type Fonts = {
  /** Body text. */
  base: string;
  /** Emphasis: labels, buttons, the active tab. */
  baseSemi: string;
  baseBold: string;
  /** Task and note titles. */
  title: string;
  /** Headings. */
  display: string;
};

const paperFonts: Fonts = {
  base: "AtkinsonHyperlegible_400Regular",
  baseSemi: "AtkinsonHyperlegible_700Bold",
  baseBold: "AtkinsonHyperlegible_700Bold",
  title: "AtkinsonHyperlegible_700Bold",
  display: "Literata_600SemiBold",
};

const sageFonts: Fonts = {
  base: "Figtree_400Regular",
  baseSemi: "Figtree_600SemiBold",
  baseBold: "Figtree_700Bold",
  title: "Figtree_500Medium",
  display: "Fraunces_600SemiBold",
};

export function fontSet(darkMode: boolean): Fonts {
  return darkMode ? sageFonts : paperFonts;
}

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
