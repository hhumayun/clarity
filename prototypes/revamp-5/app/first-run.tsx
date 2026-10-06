import React, { useEffect, useState } from "react";
import { BackHandler, Pressable, ScrollView, StyleSheet, View } from "react-native";
import Animated, { LinearTransition, useReducedMotion, withSpring, withTiming } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Magnifier, Notebook, Tea } from "../src/art/Pictures";
import { AI_CHOICE } from "../src/data/ai";
import { useDevice } from "../src/state/device";
import { duration, easeOut, fadeTiming, spring } from "../src/theme/motion";
import { useTheme } from "../src/theme/ThemeProvider";
import { edge, space } from "../src/theme/tokens";
import { Button, ButtonPair } from "../src/ui/Button";
import { AccentSwatches, PaperTiles } from "../src/ui/ColourPicker";
import { done as doneHaptic, tick } from "../src/ui/haptics";
import { Icon } from "../src/ui/Icon";
import { LeafMark } from "../src/ui/LaunchMark";
import { Txt } from "../src/ui/Txt";

const STEPS = [
  { key: "write", title: "Write freely", body: "Notes save themselves as you type. Nothing to remember, nothing to lose." },
  // The one question on the way in: AI help, said plainly (2026-10-06).
  { key: "help", title: AI_CHOICE.title, body: AI_CHOICE.body },
  { key: "yours", title: "Yours alone", body: "Your notes belong to you and are never shared with other people. Turn AI help on or off, or stop it learning from your writing, in Settings." },
  { key: "colour", title: "Pick a colour", body: "Buttons, checks and focus time take it. You can change it any time in Settings." },
] as const;

const pills = LinearTransition.duration(duration.base).easing(easeOut);

/**
 * The first time in: three short pages about what Clarity is, then your
 * colour and paper, Rosebud's "pick a colour, any colour". The app takes
 * the colour at once, the leaf with it. The second page asks the one
 * question: AI help, on or not now. Skip, or the last button, ends it for
 * good on this phone (skipped, the AI question is asked once on its own);
 * Back goes a page back.
 */
export default function FirstRun() {
  const { colors, accent, dark } = useTheme();
  const insets = useSafeAreaInsets();
  const reduced = useReducedMotion();
  const prefs = useDevice((state) => state.prefs);
  const setPref = useDevice((state) => state.setPref);
  const setOnboarded = useDevice((state) => state.setOnboarded);
  const setAi = useDevice((state) => state.setAi);
  const [step, setStep] = useState(0);
  const [forward, setForward] = useState(true);
  const last = step === STEPS.length - 1;
  const current = STEPS[step];

  const go = (to: number) => {
    tick();
    setForward(to > step);
    setStep(to);
  };
  const finish = () => {
    doneHaptic();
    setOnboarded(true);
  };

  // Android's back goes a page back before it leaves.
  useEffect(() => {
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      if (step === 0) return false;
      go(step - 1);
      return true;
    });
    return () => subscription.remove();
  });

  const shift = reduced ? 0 : forward ? 28 : -28;
  const arrive = () => {
    "worklet";
    return {
      initialValues: { opacity: 0, transform: [{ translateX: shift }] },
      animations: { opacity: withTiming(1, fadeTiming(duration.enter)), transform: [{ translateX: withTiming(0, { duration: duration.enter, easing: easeOut }) }] },
    };
  };
  const pop = () => {
    "worklet";
    return {
      initialValues: { opacity: 0, transform: [{ scale: reduced ? 1 : 0.8 }] },
      animations: { opacity: withTiming(1, fadeTiming(duration.quick)), transform: [{ scale: withSpring(1, spring.pop) }] },
    };
  };

  return (
    <View style={[styles.screen, { backgroundColor: colors.page, paddingTop: insets.top }]}>
      <View style={styles.bar}>
        <View style={styles.side}>
          {step > 0 ? (
            <Pressable onPress={() => go(step - 1)} hitSlop={12} accessibilityRole="button" accessibilityLabel="Back">
              {({ pressed }) => (
                <View style={{ opacity: pressed ? 0.5 : 1 }}>
                  <Icon name="back" size={24} color={colors.ink} weight="semibold" />
                </View>
              )}
            </Pressable>
          ) : null}
        </View>
        <View style={styles.pills} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          {STEPS.map((page, index) => (
            <Animated.View key={page.key} layout={pills} style={[styles.pill, index === step ? { width: 20, backgroundColor: accent.solid } : { backgroundColor: colors.line }]} />
          ))}
        </View>
        <View style={[styles.side, styles.right]}>
          {!last ? <Button label="Skip" variant="plain" size="sm" onPress={finish} /> : null}
        </View>
      </View>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Animated.View key={current.key} entering={arrive} style={styles.page}>
          <View style={styles.picture}>
            {current.key === "write" ? <Notebook size={120} /> : null}
            {current.key === "help" ? <Magnifier size={120} /> : null}
            {current.key === "yours" ? <Tea size={112} /> : null}
            {current.key === "colour" ? (
              <Animated.View key={`${prefs.accent}-${dark}`} entering={pop}>
                <LeafMark size={64} />
              </Animated.View>
            ) : null}
          </View>
          <Txt variant="title1" center accessibilityRole="header">
            {current.title}
          </Txt>
          <Txt variant="callout" tone="ink2" center style={styles.body}>
            {current.body}
          </Txt>
          {current.key === "colour" ? (
            <View style={styles.choices}>
              <AccentSwatches value={prefs.accent} onChange={(name) => setPref("accent", name)} />
              <Txt variant="footnote" tone="ink3" weight="semibold" center>
                Paper, for light mode
              </Txt>
              <PaperTiles value={prefs.paper} onChange={(name) => setPref("paper", name)} />
            </View>
          ) : null}
        </Animated.View>
      </ScrollView>
      <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, space[3]) + space[2] }]}>
        {current.key === "help" ? (
          <ButtonPair>
            <Button
              label="Not now"
              variant="outline"
              flex
              onPress={() => {
                setAi("off");
                go(step + 1);
              }}
            />
            <Button
              label="Turn on AI help"
              icon="sparkles"
              flex
              onPress={() => {
                setAi("on");
                go(step + 1);
              }}
            />
          </ButtonPair>
        ) : (
          <Button label={last ? "Start writing" : "Next"} icon={last ? "compose" : undefined} onPress={last ? finish : () => go(step + 1)} />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  bar: { height: 52, flexDirection: "row", alignItems: "center", paddingHorizontal: edge },
  side: { width: 72 },
  right: { alignItems: "flex-end" },
  pills: { flex: 1, flexDirection: "row", justifyContent: "center", gap: 6 },
  pill: { width: 6, height: 6, borderRadius: 3 },
  scroll: { flexGrow: 1, justifyContent: "center", paddingVertical: space[6] },
  page: { alignItems: "center", gap: space[3] },
  picture: { height: 132, justifyContent: "center", marginBottom: space[2] },
  body: { maxWidth: 320, paddingHorizontal: edge },
  choices: { alignSelf: "stretch", gap: space[3], paddingTop: space[4] },
  footer: { paddingHorizontal: edge, paddingTop: space[3] },
});
