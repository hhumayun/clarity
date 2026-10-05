import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import { useColorScheme } from "react-native";
import { useStore } from "../store/store";
import { accents, dark, papers, phaseOf, type Accent, type AccentName, type Palette, type Phase } from "./tokens";

type Mode = "auto" | "light" | "dark";

type Theme = {
  colors: Palette;
  /** The person's accent, resolved for this theme. */
  accent: Accent;
  accentName: AccentName;
  dark: boolean;
  phase: Phase;
  mode: Mode;
  setMode: (mode: Mode) => void;
  /** Settings can preview any hour's words and picture; null follows the clock. */
  phaseOverride: Phase | null;
  setPhaseOverride: (phase: Phase | null) => void;
};

const ThemeContext = createContext<Theme | null>(null);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const system = useColorScheme();
  const [mode, setMode] = useState<Mode>("auto");
  const [phaseOverride, setPhaseOverride] = useState<Phase | null>(null);
  const accentName = useStore((state) => state.prefs.accent);
  const paperName = useStore((state) => state.prefs.paper);
  // The hour, checked every minute so the greeting moves on by itself.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(timer);
  }, []);

  const isDark = mode === "dark" || (mode === "auto" && system === "dark");
  const phase = phaseOverride ?? phaseOf(now);
  const value = useMemo<Theme>(
    () => ({
      colors: isDark ? dark : papers[paperName].palette,
      accent: accents[accentName][isDark ? "dark" : "light"],
      accentName,
      dark: isDark,
      phase,
      mode,
      setMode,
      phaseOverride,
      setPhaseOverride,
    }),
    [isDark, phase, mode, phaseOverride, accentName, paperName],
  );
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): Theme {
  const theme = useContext(ThemeContext);
  if (!theme) throw new Error("useTheme needs ThemeProvider");
  return theme;
}
