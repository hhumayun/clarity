import React, { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withRepeat, withSequence, withSpring, withTiming } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { dateOf, longDay, today, type Day } from "../lib/dates";
import { breathe, calm, duration, easeOut, fadeTiming, spring } from "../theme/motion";
import { useTheme } from "../theme/ThemeProvider";
import { radius } from "../theme/tokens";
import { tick } from "./haptics";
import { Icon } from "./Icon";
import { useStretch } from "./stretch";
import { Txt } from "./Txt";

/** "has": something was written that day; "done": it had tasks and every one was finished. */
export type StripDay = { day: Day; mark: "none" | "has" | "done" };

const DISC = 34;

/**
 * The week in one quiet line, after Rosebud's: small weekday letters over
 * the dates, today's in the accent. The chosen day sits in a thin ink ring
 * that stretches into a capsule as it travels to another day and gathers
 * back into a ring when it lands. A day you wrote on carries a small dot;
 * a day whose tasks were all finished carries a small check instead.
 * No numbers about the days. Swipe the strip sideways for the week before
 * or after.
 */
export function WeekStrip({ days, selected, onSelect, onWeek }: { days: StripDay[]; selected: Day; onSelect: (day: Day) => void; onWeek: (step: -1 | 1) => void }) {
  const { colors, accent } = useTheme();
  const reduced = useReducedMotion();
  const [width, setWidth] = useState(0);
  const column = width / days.length;
  const index = days.findIndex((day) => day.day === selected);
  const disc = useStretch(Math.max(0, index), column, Math.max(0, (column - DISC) / 2));
  const t = today();

  // The week slides in from the side it was swiped toward.
  const x = useSharedValue(0);
  const fade = useSharedValue(1);
  const firstDay = days[0]?.day;
  const lastFirst = useRef(firstDay);
  useEffect(() => {
    if (!firstDay || lastFirst.current === firstDay) return;
    const forward = firstDay > (lastFirst.current ?? firstDay);
    lastFirst.current = firstDay;
    if (reduced) {
      fade.value = 0;
      fade.value = withTiming(1, fadeTiming(duration.base));
      return;
    }
    x.value = (forward ? 1 : -1) * Math.max(60, width * 0.25);
    fade.value = 0.2;
    x.value = withSpring(0, spring.glide);
    fade.value = withTiming(1, { duration: duration.enter, easing: easeOut });
  }, [firstDay, reduced, width, x, fade]);

  const pan = Gesture.Pan()
    .activeOffsetX([-16, 16])
    .failOffsetY([-12, 12])
    .onUpdate((event) => {
      x.value = event.translationX * 0.45;
    })
    .onEnd((event) => {
      const go = Math.abs(event.translationX) > 56 || Math.abs(event.velocityX) > 600;
      if (go) scheduleOnRN(onWeek, event.translationX < 0 ? 1 : -1);
      else x.value = withSpring(0, reduced ? calm : spring.glide);
    });

  const slide = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }], opacity: fade.value }));

  return (
    <GestureDetector gesture={pan}>
      <Animated.View onLayout={(event) => setWidth(event.nativeEvent.layout.width)} style={[styles.strip, slide]}>
        {column > 0 && index >= 0 ? <Animated.View style={[styles.disc, { borderColor: colors.ink }, disc]} /> : null}
        {days.map((day) => {
          const date = dateOf(day.day);
          const chosen = day.day === selected;
          const isToday = day.day === t;
          return (
            <Pressable
              key={day.day}
              onPress={() => {
                if (!chosen) tick();
                onSelect(day.day);
              }}
              accessibilityRole="button"
              accessibilityLabel={`${longDay(day.day)}${isToday ? ", today" : ""}${day.mark === "done" ? ", everything done" : day.mark === "has" ? ", you wrote that day" : ""}`}
              aria-selected={chosen}
              style={styles.day}
            >
              <Txt variant="caption" style={[styles.letter, { color: isToday ? accent.onSoft : colors.ink3 }]} weight={isToday ? "heavy" : "semibold"}>
                {date.toLocaleDateString("en-GB", { weekday: "short" }).slice(0, 2)}
              </Txt>
              <View style={styles.dateSlot}>
                <Txt variant="subhead" weight={chosen || isToday ? "heavy" : "semibold"} style={[styles.number, { color: isToday && !chosen ? accent.onSoft : chosen ? colors.ink : colors.ink2 }]}>
                  {date.getDate()}
                </Txt>
              </View>
              <View style={styles.markSlot}>
                {day.mark === "done" ? (
                  <Icon name="check" size={10} color={accent.onSoft} weight="bold" />
                ) : isToday ? (
                  <NowDot color={accent.solid} />
                ) : day.mark === "has" ? (
                  <View style={[styles.dot, { backgroundColor: colors.ink3 }]} />
                ) : null}
              </View>
            </Pressable>
          );
        })}
      </Animated.View>
    </GestureDetector>
  );
}

/** Today's dot: one slow breath, over and over. Still under Reduce Motion. */
export function NowDot({ color }: { color: string }) {
  const reduced = useReducedMotion();
  const swell = useSharedValue(0);
  useEffect(() => {
    if (reduced) return;
    swell.value = withRepeat(withSequence(withTiming(1, { duration: 1600, easing: breathe }), withTiming(0, { duration: 1600, easing: breathe })), -1);
  }, [reduced, swell]);
  const style = useAnimatedStyle(() => ({ opacity: 0.55 + 0.45 * swell.value, transform: [{ scale: 0.8 + 0.3 * swell.value }] }));
  return <Animated.View style={[styles.dot, { backgroundColor: color }, style]} />;
}

const styles = StyleSheet.create({
  strip: { flexDirection: "row", height: 60 },
  disc: { position: "absolute", top: 16, height: DISC, left: 0, borderRadius: radius.pill, borderCurve: "continuous", borderWidth: 1.5 },
  day: { flex: 1, alignItems: "center" },
  letter: { fontSize: 11, lineHeight: 14 },
  dateSlot: { height: DISC, marginTop: 2, alignItems: "center", justifyContent: "center" },
  number: { fontVariant: ["tabular-nums"] },
  markSlot: { height: 8, alignItems: "center", justifyContent: "center", marginTop: 1 },
  dot: { width: 4, height: 4, borderRadius: 2 },
});
