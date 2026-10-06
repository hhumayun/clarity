import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { AccessibilityInfo, StyleSheet, View } from "react-native";
import { FullWindowOverlay } from "react-native-screens";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { IconName } from "./Icon";
import { SavedPill } from "./SavedPill";

/** How long an acknowledgement rests before it goes. */
const REST_MS = 1_600;
// Long enough for the capsule to gather itself and go (SavedPill).
const LEAVE_MS = 500;

type Acknowledge = (label: string, icon?: IconName, restMs?: number) => void;
const AcknowledgeContext = createContext<Acknowledge>(() => {});

let heldUntil = 0;

/**
 * Hold other acknowledgements back for a moment: after a change that wasn't
 * saved has said so, a screen's own "Saved" or "Added" must not cover it.
 */
export function holdAcknowledgements(ms: number) {
  heldUntil = Date.now() + ms;
}

/**
 * Acknowledgements that outlive the screen that made them. "Done" leaves a
 * note at once, and what was kept is said on the screen you land on, by a
 * small ink capsule under the top of the phone: nobody waits for a confirmation.
 *
 * On iOS the capsule sits in a window above everything (FullWindowOverlay),
 * so it shows over sheets and Settings too; it was drawn under them, and
 * what they said was never seen (2026-10-06). The overlay is there only
 * while the capsule is, and never holds VoiceOver, which hears the words
 * as they're said.
 */
export function AcknowledgementProvider({ children }: { children: React.ReactNode }) {
  const insets = useSafeAreaInsets();
  const [label, setLabel] = useState("");
  const [icon, setIcon] = useState<IconName>("check");
  const [visible, setVisible] = useState(false);
  // Mounted from the first word until the capsule has gone.
  const [present, setPresent] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const gone = useRef<ReturnType<typeof setTimeout> | null>(null);

  // A new message while one shows: the same capsule rolls to the new words.
  const acknowledge = useCallback<Acknowledge>((next, nextIcon = "check", rest = REST_MS) => {
    if (Date.now() < heldUntil) return;
    if (timer.current) clearTimeout(timer.current);
    if (gone.current) clearTimeout(gone.current);
    setLabel(next);
    setIcon(nextIcon);
    setPresent(true);
    setVisible(true);
    // accessibilityLiveRegion speaks only on Android.
    if (process.env.EXPO_OS === "ios") AccessibilityInfo.announceForAccessibility(next);
    timer.current = setTimeout(() => {
      setVisible(false);
      gone.current = setTimeout(() => setPresent(false), LEAVE_MS);
    }, rest);
  }, []);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
      if (gone.current) clearTimeout(gone.current);
    },
    [],
  );

  const host = (
    <View pointerEvents="none" style={[styles.host, { top: Math.max(insets.top, 12) + 4 }]}>
      <SavedPill visible={visible} label={label} icon={icon} />
    </View>
  );

  return (
    <AcknowledgeContext.Provider value={acknowledge}>
      {children}
      {present ? process.env.EXPO_OS === "ios" ? <FullWindowOverlay unstable_accessibilityContainerViewIsModal={false}>{host}</FullWindowOverlay> : host : null}
    </AcknowledgeContext.Provider>
  );
}

/** Say what happened: `acknowledge("Moved to Tomorrow", "calendar")`. */
export const useAcknowledge = () => useContext(AcknowledgeContext);

const styles = StyleSheet.create({
  host: { position: "absolute", left: 0, right: 0 },
});
