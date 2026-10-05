import { useRouter } from "expo-router";
import React, { useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import Animated, { FadeIn, LinearTransition, useAnimatedStyle, useReducedMotion, useSharedValue, withSequence, withSpring, withTiming } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { FocusLength } from "../src/store/model";
import { useStore } from "../src/store/store";
import { duration, easeOut, spring } from "../src/theme/motion";
import { useTheme } from "../src/theme/ThemeProvider";
import { accentOrder, accents, edge, pad, paperOrder, papers, radius, space, type AccentName, type PaperName, type Phase } from "../src/theme/tokens";
import { useAcknowledge } from "../src/ui/Acknowledgement";
import { Button, ButtonPair } from "../src/ui/Button";
import { CardGroup, CardRow } from "../src/ui/Card";
import { done as doneHaptic, tick } from "../src/ui/haptics";
import { Icon, type IconName } from "../src/ui/Icon";
import { Segmented } from "../src/ui/Segmented";
import { Toggle } from "../src/ui/Toggle";
import { Txt } from "../src/ui/Txt";

const settle = LinearTransition.duration(duration.enter).easing(easeOut);

/**
 * Settings, as Rosebud keeps them: a sheet with Done at the top right and
 * small grey captions over white groups. First, your colour: six tiles,
 * Rosebud's "pick a colour, any colour"; the whole app takes it at once.
 * Then reading comfort, the focus defaults, and a few controls only this
 * prototype has. Reset asks in place.
 */
export default function Settings() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors, mode, setMode, phaseOverride, setPhaseOverride } = useTheme();
  const acknowledge = useAcknowledge();
  const prefs = useStore((state) => state.prefs);
  const setPref = useStore((state) => state.setPref);
  const reset = useStore((state) => state.reset);
  const [asking, setAsking] = useState(false);

  return (
    <View style={[styles.screen, { backgroundColor: colors.page }]}>
      {/* On the iPhone the sheet itself clears the clock; elsewhere the page does. */}
      <View style={[styles.bar, { paddingTop: process.env.EXPO_OS === "ios" ? space[4] : Math.max(insets.top, space[3]) + space[1] }]}>
        <View style={styles.side} />
        <Txt variant="headline" accessibilityRole="header" style={styles.barTitle}>
          Settings
        </Txt>
        <Pressable onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Done" hitSlop={10} style={[styles.side, styles.right]}>
          {({ pressed }) => (
            <Txt variant="headline" style={{ opacity: pressed ? 0.5 : 1 }}>
              Done
            </Txt>
          )}
        </Pressable>
      </View>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: insets.bottom + space[12] }}>
        <Caption first>Your colour</Caption>
        <View style={styles.swatches} accessibilityRole="radiogroup" accessibilityLabel="Your colour">
          {accentOrder.map((name) => (
            <Swatch
              key={name}
              name={name}
              selected={prefs.accent === name}
              onPress={() => {
                if (prefs.accent === name) return;
                tick();
                setPref("accent", name);
              }}
            />
          ))}
        </View>
        <Txt variant="footnote" tone="ink3" center style={styles.note}>
          Pick a colour, any colour. Buttons, checks and focus time take it.
        </Txt>

        <Caption>Paper</Caption>
        <View style={styles.papers} accessibilityRole="radiogroup" accessibilityLabel="Paper, for light mode">
          {paperOrder.map((name) => (
            <PaperTile
              key={name}
              name={name}
              selected={prefs.paper === name}
              onPress={() => {
                if (prefs.paper === name) return;
                tick();
                setPref("paper", name);
              }}
            />
          ))}
        </View>
        <Txt variant="footnote" tone="ink3" center style={styles.note}>
          How warm the page is in light mode, from cool stone to rosy clay.
        </Txt>

        <Caption>Appearance</Caption>
        <View style={styles.inset}>
          <Segmented
            options={[
              { label: "Auto", value: "auto" },
              { label: "Light", value: "light" },
              { label: "Dark", value: "dark" },
            ]}
            value={mode}
            onChange={setMode}
            accessibilityLabel="Appearance"
          />
        </View>
        <CardGroup style={styles.group}>
          <ToggleRow icon="format" label="Larger text" value={prefs.largeText} onChange={(value) => setPref("largeText", value)} />
        </CardGroup>

        <Caption>Focus</Caption>
        <View style={styles.inset}>
          <Segmented
            options={([10, 15, 25] as FocusLength[]).map((minutes) => ({ label: `${minutes} min`, value: minutes }))}
            value={prefs.focusLength}
            onChange={(minutes) => setPref("focusLength", minutes)}
            accessibilityLabel="Starting length"
          />
        </View>
        <CardGroup style={styles.group}>
          <ToggleRow icon="coffee" label="Take a break after" value={prefs.breakAfter} onChange={(value) => setPref("breakAfter", value)} />
        </CardGroup>

        <Caption>Prototype</Caption>
        <View style={styles.inset}>
          <Segmented
            options={[
              { label: "Follow the clock", value: "clock", icon: "clock" as const, iconOnly: true },
              ...(["dawn", "day", "dusk", "night"] as Phase[]).map((phase) => ({
                label: { dawn: "Morning", day: "Afternoon", dusk: "Evening", night: "Night" }[phase],
                value: phase as string,
                icon: ({ dawn: "sunrise", day: "today", dusk: "sunset", night: "moon" } as const)[phase],
                iconOnly: true,
              })),
            ]}
            value={phaseOverride ?? "clock"}
            onChange={(value) => setPhaseOverride(value === "clock" ? null : (value as Phase))}
            accessibilityLabel="Time of day"
          />
        </View>
        <Txt variant="footnote" tone="ink3" center style={styles.note}>
          See Today's greeting, question and picture at another hour.
        </Txt>
        <CardGroup style={styles.group}>
          <ToggleRow icon="hourglass" label="Faster timers" detail="A minute passes in two seconds." value={prefs.fastTimers} onChange={(value) => setPref("fastTimers", value)} />
          <CardRow onPress={() => router.push("/pictures")} accessibilityRole="button" accessibilityLabel="See the pictures" style={styles.row}>
            <Icon name="image" size={20} color={colors.ink2} weight="medium" />
            <Txt variant="row" style={styles.words}>
              See the pictures
            </Txt>
            <Icon name="forward" size={14} color={colors.ink3} weight="semibold" />
          </CardRow>
        </CardGroup>
        <Animated.View layout={settle} style={styles.reset}>
          {asking ? (
            <Animated.View entering={FadeIn.duration(duration.base)} style={styles.ask}>
              <Txt variant="subhead" tone="ink2" center>
                Bring back the sample notes and tasks? Your changes here are cleared.
              </Txt>
              <ButtonPair>
                <Button label="Keep" variant="secondary" size="md" flex onPress={() => (tick(), setAsking(false))} />
                <Button
                  label="Reset"
                  icon="undo"
                  variant="danger"
                  size="md"
                  flex
                  onPress={() => {
                    doneHaptic();
                    reset();
                    setAsking(false);
                    acknowledge("Sample data is back", "undo");
                  }}
                />
              </ButtonPair>
            </Animated.View>
          ) : (
            <Animated.View entering={FadeIn.duration(duration.base)}>
              <Button label="Reset sample data" icon="undo" variant="secondary" size="md" onPress={() => (tick(), setAsking(true))} />
            </Animated.View>
          )}
        </Animated.View>

        <Txt variant="footnote" tone="ink3" center style={styles.about}>
          Clarity is a calm place to write, plan and focus. This is a design prototype (revamp 5, “Sage”), with sample data and no account.
        </Txt>
      </ScrollView>
    </View>
  );
}

function Caption({ children, first }: { children: string; first?: boolean }) {
  return (
    <Txt variant="footnote" tone="ink3" weight="semibold" style={[styles.caption, first && styles.captionFirst]}>
      {children}
    </Txt>
  );
}

/**
 * One colour in Rosebud's grid: a white tile with a disc of the colour and
 * its name. The chosen tile takes an ink edge, and its disc pops and draws
 * a check.
 */
function Swatch({ name, selected, onPress }: { name: AccentName; selected: boolean; onPress: () => void }) {
  const { colors, dark } = useTheme();
  const reduced = useReducedMotion();
  const tone = accents[name][dark ? "dark" : "light"];
  const pop = useSharedValue(1);
  const ring = useSharedValue(0);
  const first = React.useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (selected && !reduced) {
      pop.value = withSequence(withTiming(0.82, { duration: duration.press, easing: easeOut }), withSpring(1, spring.pop));
      ring.value = 0;
      ring.value = withTiming(1, { duration: 560, easing: easeOut });
    }
  }, [selected, pop, ring, reduced]);
  const disc = useAnimatedStyle(() => ({ transform: [{ scale: pop.value }] }));
  const halo = useAnimatedStyle(() => ({ opacity: ring.value > 0 && ring.value < 1 ? 0.5 * (1 - ring.value) : 0, transform: [{ scale: 1 + ring.value * 0.9 }] }));
  return (
    <Pressable onPress={onPress} accessibilityRole="radio" aria-selected={selected} accessibilityLabel={accents[name].label} style={({ pressed }) => [styles.swatch, { backgroundColor: colors.card, borderColor: selected ? colors.ink : colors.card, transform: [{ scale: pressed ? 0.96 : 1 }] }]}>
      <View>
        <Animated.View style={[styles.halo, { borderColor: tone.solid }, halo]} />
        <Animated.View style={[styles.disc, { backgroundColor: tone.solid }, disc]}>
          {selected ? (
            <Animated.View entering={FadeIn.duration(duration.base)}>
              <Icon name="check" size={20} color={tone.on} weight="bold" />
            </Animated.View>
          ) : null}
        </Animated.View>
      </View>
      <Txt variant="footnote" weight={selected ? "bold" : "semibold"} tone={selected ? "ink" : "ink2"}>
        {accents[name].label}
      </Txt>
    </Pressable>
  );
}

/** One light page to choose: its colour with a small card on it, and its name. The chosen one takes an ink edge. */
function PaperTile({ name, selected, onPress }: { name: PaperName; selected: boolean; onPress: () => void }) {
  const { colors } = useTheme();
  const tone = papers[name].palette;
  return (
    <Pressable onPress={onPress} accessibilityRole="radio" aria-selected={selected} accessibilityLabel={papers[name].label} style={({ pressed }) => [styles.paper, { borderColor: selected ? colors.ink : "transparent", transform: [{ scale: pressed ? 0.96 : 1 }] }]}>
      <View style={[styles.sample, { backgroundColor: tone.page }]}>
        <View style={[styles.sampleCard, { backgroundColor: tone.card, boxShadow: tone.cardShadow }]}>
          <View style={[styles.sampleLine, { backgroundColor: tone.ink, width: "70%" }]} />
          <View style={[styles.sampleLine, { backgroundColor: tone.ink3, width: "45%" }]} />
        </View>
      </View>
      <Txt variant="footnote" weight={selected ? "bold" : "semibold"} tone={selected ? "ink" : "ink2"}>
        {papers[name].label}
      </Txt>
    </Pressable>
  );
}

function ToggleRow({ icon, label, detail, value, onChange }: { icon: IconName; label: string; detail?: string; value: boolean; onChange: (value: boolean) => void }) {
  const { colors } = useTheme();
  return (
    <View style={styles.row}>
      <Icon name={icon} size={20} color={colors.ink2} weight="medium" />
      <View style={styles.words}>
        <Txt variant="row">{label}</Txt>
        {detail ? (
          <Txt variant="footnote" tone="ink3">
            {detail}
          </Txt>
        ) : null}
      </View>
      <Toggle value={value} onValueChange={onChange} accessibilityLabel={label} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  bar: { flexDirection: "row", alignItems: "center", paddingHorizontal: edge, paddingBottom: space[2] },
  side: { width: 64 },
  right: { alignItems: "flex-end" },
  barTitle: { flex: 1, textAlign: "center" },
  caption: { paddingHorizontal: edge + 4, paddingTop: space[7], paddingBottom: space[2] },
  captionFirst: { paddingTop: space[4] },
  swatches: { flexDirection: "row", flexWrap: "wrap", gap: space[3], paddingHorizontal: edge },
  swatch: { width: "30.9%", flexGrow: 1, alignItems: "center", gap: space[2], paddingVertical: space[4], borderRadius: radius.card, borderCurve: "continuous", borderWidth: 1.5 },
  disc: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  halo: { position: "absolute", width: 44, height: 44, borderRadius: 22, borderWidth: 2 },
  note: { paddingHorizontal: edge * 2, paddingTop: space[3] },
  papers: { flexDirection: "row", gap: space[2], paddingHorizontal: edge },
  paper: { flex: 1, alignItems: "center", gap: space[2], padding: 6, paddingBottom: space[2], borderRadius: radius.card, borderCurve: "continuous", borderWidth: 1.5 },
  sample: { alignSelf: "stretch", height: 64, borderRadius: radius.sm, borderCurve: "continuous", padding: 8, justifyContent: "center" },
  sampleCard: { borderRadius: 7, padding: 7, gap: 5 },
  sampleLine: { height: 4, borderRadius: 2 },
  inset: { marginHorizontal: edge },
  group: { marginTop: space[3] },
  row: { minHeight: 56, flexDirection: "row", alignItems: "center", gap: space[3], paddingHorizontal: pad, paddingVertical: 10 },
  words: { flex: 1, gap: 2 },
  reset: { marginHorizontal: edge, marginTop: space[3] },
  ask: { gap: space[3] },
  about: { paddingHorizontal: edge * 2, paddingTop: space[10] },
});
