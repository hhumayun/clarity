import AsyncStorage from "@react-native-async-storage/async-storage";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { fontScale, palette, type Colors, type ThemeMode, useResolvedDark } from "../theme";

const XL_KEY = "clarity:xl-text";
const ONBOARDING_KEY = "clarity:onboarding-done";
const THEME_KEY = "clarity:theme-mode";

type AppThemeValue = {
  ready: boolean;
  colors: Colors;
  dark: boolean;
  mode: ThemeMode;
  setMode: (mode: ThemeMode) => void;
  xlText: boolean;
  setXlText: (value: boolean) => void;
  scale: number;
  onboardingDone: boolean;
  completeOnboarding: () => void;
};

const AppThemeContext = createContext<AppThemeValue | undefined>(undefined);

export function AppThemeProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [mode, setModeState] = useState<ThemeMode>("auto");
  const [xlText, setXlTextState] = useState(false);
  const [onboardingDone, setOnboardingDone] = useState(false);
  const dark = useResolvedDark(mode);
  const colors = palette(dark);
  const scale = fontScale(xlText);

  useEffect(() => {
    void (async () => {
      const [xl, onboard, theme] = await Promise.all([
        AsyncStorage.getItem(XL_KEY),
        AsyncStorage.getItem(ONBOARDING_KEY),
        AsyncStorage.getItem(THEME_KEY),
      ]);
      setXlTextState(xl === "true");
      setOnboardingDone(onboard === "true");
      if (theme === "light" || theme === "dark" || theme === "auto") {
        setModeState(theme);
      }
      setReady(true);
    })();
  }, []);

  const setMode = useCallback((next: ThemeMode) => {
    setModeState(next);
    void AsyncStorage.setItem(THEME_KEY, next);
  }, []);

  const setXlText = useCallback((value: boolean) => {
    setXlTextState(value);
    void AsyncStorage.setItem(XL_KEY, value ? "true" : "false");
  }, []);

  const completeOnboarding = useCallback(() => {
    setOnboardingDone(true);
    void AsyncStorage.setItem(ONBOARDING_KEY, "true");
  }, []);

  const value = useMemo(
    () => ({
      ready,
      colors,
      dark,
      mode,
      setMode,
      xlText,
      setXlText,
      scale,
      onboardingDone,
      completeOnboarding,
    }),
    [ready, colors, dark, mode, setMode, xlText, setXlText, scale, onboardingDone, completeOnboarding],
  );

  return <AppThemeContext.Provider value={value}>{children}</AppThemeContext.Provider>;
}

export function useAppTheme(): AppThemeValue {
  const ctx = useContext(AppThemeContext);
  if (!ctx) throw new Error("useAppTheme must be used within AppThemeProvider");
  return ctx;
}
