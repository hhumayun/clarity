import AsyncStorage from "@react-native-async-storage/async-storage";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { fontScale, fontSet, palette, type Colors, type Fonts, type ThemeMode, useResolvedDark } from "../theme";

const XL_KEY = "clarity:xl-text";
const ONBOARDING_KEY = "clarity:onboarding-done";
const THEME_KEY = "clarity:theme-mode";
const AI_SUGGESTIONS_KEY = "clarity:ai-suggestions";

type AppThemeValue = {
  ready: boolean;
  colors: Colors;
  /** The font pair that goes with the current palette. */
  fonts: Fonts;
  dark: boolean;
  mode: ThemeMode;
  setMode: (mode: ThemeMode) => void;
  xlText: boolean;
  setXlText: (value: boolean) => void;
  scale: number;
  onboardingDone: boolean;
  completeOnboarding: () => void;
  // Whether the note editor shows AI suggestions at all. Off hides the chips
  // and the reflection question and stops fetching; on brings them back.
  aiSuggestions: boolean;
  setAiSuggestions: (value: boolean) => void;
};

const AppThemeContext = createContext<AppThemeValue | undefined>(undefined);

export function AppThemeProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [mode, setModeState] = useState<ThemeMode>("auto");
  const [xlText, setXlTextState] = useState(false);
  const [onboardingDone, setOnboardingDone] = useState(false);
  const [aiSuggestions, setAiSuggestionsState] = useState(true);
  const dark = useResolvedDark(mode);
  const colors = palette(dark);
  const fonts = fontSet(dark);
  const scale = fontScale(xlText);

  useEffect(() => {
    void (async () => {
      const [xl, onboard, theme, ai] = await Promise.all([
        AsyncStorage.getItem(XL_KEY),
        AsyncStorage.getItem(ONBOARDING_KEY),
        AsyncStorage.getItem(THEME_KEY),
        AsyncStorage.getItem(AI_SUGGESTIONS_KEY),
      ]);
      setXlTextState(xl === "true");
      setOnboardingDone(onboard === "true");
      setAiSuggestionsState(ai !== "false");
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

  const setAiSuggestions = useCallback((value: boolean) => {
    setAiSuggestionsState(value);
    void AsyncStorage.setItem(AI_SUGGESTIONS_KEY, value ? "true" : "false");
  }, []);

  const value = useMemo(
    () => ({
      ready,
      colors,
      fonts,
      dark,
      mode,
      setMode,
      xlText,
      setXlText,
      scale,
      onboardingDone,
      completeOnboarding,
      aiSuggestions,
      setAiSuggestions,
    }),
    [
      ready,
      colors,
      fonts,
      dark,
      mode,
      setMode,
      xlText,
      setXlText,
      scale,
      onboardingDone,
      completeOnboarding,
      aiSuggestions,
      setAiSuggestions,
    ],
  );

  return <AppThemeContext.Provider value={value}>{children}</AppThemeContext.Provider>;
}

export function useAppTheme(): AppThemeValue {
  const ctx = useContext(AppThemeContext);
  if (!ctx) throw new Error("useAppTheme must be used within AppThemeProvider");
  return ctx;
}
