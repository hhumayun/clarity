import React, { useEffect, useRef } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import Animated, { FadeIn, useAnimatedStyle, useReducedMotion, useSharedValue, withSequence, withSpring, withTiming } from "react-native-reanimated";
import { duration, easeOut, spring } from "../theme/motion";
import { useTheme } from "../theme/ThemeProvider";
import { accentOrder, accents, edge, paperOrder, papers, radius, space, type AccentName, type PaperName } from "../theme/tokens";
import { tick } from "./haptics";
import { Icon } from "./Icon";
import { Txt } from "./Txt";

/**
 * Rosebud's "pick a colour, any colour": six tiles, each a white card with a
 * disc of the colour and its name. The chosen tile takes an ink edge, its
 * disc pops and draws a check, and the whole app takes the colour at once.
 * Used by Settings and by the first-run welcome.
 */
export function AccentSwatches({ value, onChange }: { value: AccentName; onChange: (name: AccentName) => void }) {
  return (
    <View style={styles.swatches} accessibilityRole="radiogroup" accessibilityLabel="Your colour">
      {accentOrder.map((name) => (
        <Swatch
          key={name}
          name={name}
          selected={value === name}
          onPress={() => {
            if (value === name) return;
            tick();
            onChange(name);
          }}
        />
      ))}
    </View>
  );
}

/** The light page's warmth: four small pages, each with a card on it. The chosen one takes an ink edge. */
export function PaperTiles({ value, onChange }: { value: PaperName; onChange: (name: PaperName) => void }) {
  return (
    <View style={styles.papers} accessibilityRole="radiogroup" accessibilityLabel="Paper, for light mode">
      {paperOrder.map((name) => (
        <PaperTile
          key={name}
          name={name}
          selected={value === name}
          onPress={() => {
            if (value === name) return;
            tick();
            onChange(name);
          }}
        />
      ))}
    </View>
  );
}

function Swatch({ name, selected, onPress }: { name: AccentName; selected: boolean; onPress: () => void }) {
  const { colors, dark } = useTheme();
  const reduced = useReducedMotion();
  const tone = accents[name][dark ? "dark" : "light"];
  const pop = useSharedValue(1);
  const ring = useSharedValue(0);
  const first = useRef(true);
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

const styles = StyleSheet.create({
  swatches: { flexDirection: "row", flexWrap: "wrap", gap: space[3], paddingHorizontal: edge },
  swatch: { width: "30.9%", flexGrow: 1, alignItems: "center", gap: space[2], paddingVertical: space[4], borderRadius: radius.card, borderCurve: "continuous", borderWidth: 1.5 },
  disc: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  halo: { position: "absolute", width: 44, height: 44, borderRadius: 22, borderWidth: 2 },
  papers: { flexDirection: "row", gap: space[2], paddingHorizontal: edge },
  paper: { flex: 1, alignItems: "center", gap: space[2], padding: 6, paddingBottom: space[2], borderRadius: radius.card, borderCurve: "continuous", borderWidth: 1.5 },
  sample: { alignSelf: "stretch", height: 64, borderRadius: radius.sm, borderCurve: "continuous", padding: 8, justifyContent: "center" },
  sampleCard: { borderRadius: 7, padding: 7, gap: 5 },
  sampleLine: { height: 4, borderRadius: 2 },
});
