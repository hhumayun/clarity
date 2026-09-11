import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { switchToAutoMode } from "./themeMode";

/**
 * Reading-comfort preferences that live on this device: extra-large text and
 * whether the welcome steps have been seen. Kept out of the database on
 * purpose — they describe the device, not the account.
 */

const XL_TEXT_KEY = "clarity:xl-text";
const ONBOARDING_KEY = "clarity:onboarding-done";
const THEME_CHOICE_KEY = "clarity:theme-choice";

const BASE_FONT_SIZE_PX = 17;
const XL_FONT_SIZE_PX = 21;

type ClaritySettings = {
  xlText: boolean;
  setXlText: (value: boolean) => void;
  onboardingDone: boolean;
  completeOnboarding: () => void;
};

const ClaritySettingsContext = createContext<ClaritySettings | undefined>(
  undefined,
);

function readFlag(key: string): boolean {
  try {
    return window.localStorage.getItem(key) === "true";
  } catch {
    return false;
  }
}

function writeFlag(key: string, value: boolean): void {
  try {
    window.localStorage.setItem(key, value ? "true" : "false");
  } catch {
    // Private browsing or blocked storage — the preference just won't stick.
  }
}

/**
 * Record that the reader has picked light or dark for themselves, so the
 * app stops following the device from now on.
 */
export function rememberThemeChoice(followDevice: boolean): void {
  writeFlag(THEME_CHOICE_KEY, !followDevice);
}

export const ClaritySettingsProvider = ({
  children,
}: {
  children: ReactNode;
}) => {
  const [xlText, setXlTextState] = useState(false);
  const [onboardingDone, setOnboardingDone] = useState(true);

  // Read once on the client so the first paint isn't blocked on storage.
  useEffect(() => {
    setXlTextState(readFlag(XL_TEXT_KEY));
    setOnboardingDone(readFlag(ONBOARDING_KEY));
  }, []);

  // Follow the device's light/dark setting unless the reader has chosen for
  // themselves — the same behaviour the app had on the phone.
  useEffect(() => {
    let chosen = false;
    try {
      chosen = window.localStorage.getItem(THEME_CHOICE_KEY) === "true";
    } catch {
      chosen = false;
    }
    if (!chosen) switchToAutoMode();
  }, []);

  // Everything in the app is sized in rem, so one root value scales the
  // whole interface rather than a per-component font-size switch.
  useEffect(() => {
    document.documentElement.style.fontSize = `${
      xlText ? XL_FONT_SIZE_PX : BASE_FONT_SIZE_PX
    }px`;
  }, [xlText]);

  const setXlText = useCallback((value: boolean) => {
    setXlTextState(value);
    writeFlag(XL_TEXT_KEY, value);
  }, []);

  const completeOnboarding = useCallback(() => {
    setOnboardingDone(true);
    writeFlag(ONBOARDING_KEY, true);
  }, []);

  const value = useMemo(
    () => ({ xlText, setXlText, onboardingDone, completeOnboarding }),
    [xlText, setXlText, onboardingDone, completeOnboarding],
  );

  return (
    <ClaritySettingsContext.Provider value={value}>
      {children}
    </ClaritySettingsContext.Provider>
  );
};

export const useClaritySettings = (): ClaritySettings => {
  const context = useContext(ClaritySettingsContext);
  if (!context) {
    throw new Error(
      "useClaritySettings must be used within a ClaritySettingsProvider",
    );
  }
  return context;
};