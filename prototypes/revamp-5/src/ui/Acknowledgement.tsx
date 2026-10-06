import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { IconName } from "./Icon";
import { SavedPill } from "./SavedPill";

/** How long an acknowledgement rests before it goes. */
const REST_MS = 1_600;

type Acknowledge = (label: string, icon?: IconName) => void;
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
 */
export function AcknowledgementProvider({ children }: { children: React.ReactNode }) {
  const insets = useSafeAreaInsets();
  const [label, setLabel] = useState("");
  const [icon, setIcon] = useState<IconName>("check");
  const [visible, setVisible] = useState(false);
  // A new message replaces one still showing: the old pill leaves, the new one arrives.
  const [count, setCount] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const acknowledge = useCallback<Acknowledge>((next, nextIcon = "check") => {
    if (Date.now() < heldUntil) return;
    if (timer.current) clearTimeout(timer.current);
    setLabel(next);
    setIcon(nextIcon);
    setVisible(true);
    setCount((n) => n + 1);
    timer.current = setTimeout(() => setVisible(false), REST_MS);
  }, []);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  return (
    <AcknowledgeContext.Provider value={acknowledge}>
      {children}
      <View pointerEvents="none" style={[styles.host, { top: Math.max(insets.top, 12) + 4 }]}>
        <SavedPill key={count} visible={visible} label={label} icon={icon} />
      </View>
    </AcknowledgeContext.Provider>
  );
}

/** Say what happened: `acknowledge("Moved to Tomorrow", "calendar")`. */
export const useAcknowledge = () => useContext(AcknowledgeContext);

const styles = StyleSheet.create({
  host: { position: "absolute", left: 0, right: 0 },
});
