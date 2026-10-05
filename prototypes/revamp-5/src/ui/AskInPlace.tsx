import React, { useState } from "react";
import { StyleSheet } from "react-native";
import Animated, { FadeIn, LinearTransition } from "react-native-reanimated";
import { duration, easeOut } from "../theme/motion";
import { space } from "../theme/tokens";
import { Button, ButtonPair, type ButtonVariant } from "./Button";
import { tick } from "./haptics";
import type { IconName } from "./Icon";
import { Txt } from "./Txt";

const settle = LinearTransition.duration(duration.enter).easing(easeOut);

export type AskStep = { question: string; confirm: string; icon?: IconName };

/**
 * A button that asks before it acts, in place, as Rosebud's "Finish entry?
 * Back / Confirm" does: pressed, it becomes the question and two answers.
 * More than one step asks again (deleting an account). The acting answer
 * spins while it works; if it fails, the reason is said under it and the
 * question stays.
 */
export function AskInPlace({
  label,
  icon,
  variant = "secondary",
  steps,
  cancel = "Keep",
  danger,
  onConfirm,
}: {
  label: string;
  icon?: IconName;
  variant?: ButtonVariant;
  steps: AskStep[];
  cancel?: string;
  danger?: boolean;
  onConfirm: () => Promise<void> | void;
}) {
  const [at, setAt] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const step = at === null ? null : steps[Math.min(at, steps.length - 1)];

  const answer = async () => {
    if (at === null || busy) return;
    if (at < steps.length - 1) {
      tick();
      setAt(at + 1);
      return;
    }
    setBusy(true);
    setError("");
    try {
      await onConfirm();
      setAt(null);
    } catch (failure) {
      setError(failure instanceof Error && failure.message ? failure.message : "That didn't work. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Animated.View layout={settle}>
      {step === null ? (
        <Animated.View entering={FadeIn.duration(duration.base)}>
          <Button
            label={label}
            icon={icon}
            variant={variant}
            size="md"
            onPress={() => {
              tick();
              setError("");
              setAt(0);
            }}
          />
        </Animated.View>
      ) : (
        <Animated.View key={at} entering={FadeIn.duration(duration.base)} style={styles.ask}>
          <Txt variant="subhead" tone="ink2" center>
            {step.question}
          </Txt>
          <ButtonPair>
            <Button
              label={cancel}
              variant="secondary"
              size="md"
              flex
              disabled={busy}
              onPress={() => {
                tick();
                setAt(null);
              }}
            />
            <Button label={step.confirm} icon={step.icon} variant={danger ? "danger" : "primary"} size="md" flex state={busy ? "busy" : "idle"} onPress={() => void answer()} />
          </ButtonPair>
          {error ? (
            <Txt variant="footnote" tone="danger" center>
              {error}
            </Txt>
          ) : null}
        </Animated.View>
      )}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  ask: { gap: space[3] },
});
