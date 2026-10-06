import { useRouter } from "expo-router";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withSpring, withTiming } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { scheduleOnRN } from "react-native-worklets";
import { dayChoices, dayLabel, lateLabel, today, type Day } from "../src/lib/dates";
import { slipped } from "../src/store/selectors";
import { getSage, useSage } from "../src/data/sage";
import { arrive, arriveSlow, calm, duration, easeOut, fadeTiming, keep, spring } from "../src/theme/motion";
import { useTheme } from "../src/theme/ThemeProvider";
import { edge, radius, space } from "../src/theme/tokens";
import { Sprout } from "../src/art/Pictures";
import { Button, ButtonPair } from "../src/ui/Button";
import { Chip } from "../src/ui/Chip";
import { done as doneHaptic, tick } from "../src/ui/haptics";
import { Icon, type IconName } from "../src/ui/Icon";
import { IconButton } from "../src/ui/IconButton";
import { Txt } from "../src/ui/Txt";

type Result = "today" | "moved" | "let-go" | "skipped";
type Pose = { x: number; y: number; turn: number; scale: number };

/** Where a sorted card goes: up to Today, across to another day, down and away when let go, back to the left when skipped. */
const LEAVES: Record<Result, Pose> = {
  today: { x: 0, y: -150, turn: 0, scale: 0.94 },
  moved: { x: 180, y: -24, turn: 7, scale: 0.96 },
  "let-go": { x: 0, y: 80, turn: 0, scale: 0.9 },
  skipped: { x: -180, y: 0, turn: -6, scale: 0.96 },
};
const ARRIVES: Pose = { x: 90, y: 0, turn: 4, scale: 0.96 };
const STILL: Pose = { x: 0, y: 0, turn: 0, scale: 1 };

/**
 * Catch up: what slipped past its date, one card at a time, oldest first,
 * with a second card peeking from behind while there are more (never a
 * count). Each card has a few kind choices under it. Sorted cards leave in
 * the direction of what you chose and the next is dealt in from the right,
 * so the motion says what happened. A line at the top fills as you go. At
 * the end a sprout grows: all caught up. The list is fixed when the screen
 * opens, so nothing shifts under your thumb.
 */
export default function CatchUp() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors, accent } = useTheme();
  const reduced = useReducedMotion();
  const tasks = useSage((state) => state.tasks);
  const moveTask = useSage((state) => state.moveTask);
  const setDone = useSage((state) => state.setDone);
  const queue = useMemo(() => slipped(getSage().tasks), []);
  const [index, setIndex] = useState(0);
  const [note, setNote] = useState<{ icon: IconName; text: string } | null>(null);
  const current = queue[index] ? (tasks.find((task) => task.id === queue[index].id) ?? queue[index]) : null;

  const x = useSharedValue(0);
  const y = useSharedValue(0);
  const turn = useSharedValue(0);
  const scale = useSharedValue(1);
  const fade = useSharedValue(1);
  const busy = useRef(false);
  const card = useAnimatedStyle(() => ({
    opacity: fade.value,
    transform: [{ translateX: x.value }, { translateY: y.value }, { rotate: `${turn.value}deg` }, { scale: scale.value }],
  }));
  // The card behind steps back while the top one is sorted, then peeks out again under the next.
  const peek = useAnimatedStyle(() => ({ opacity: 0.7 * fade.value, transform: [{ translateY: (1 - fade.value) * -6 }] }));

  // How far through, as a line that fills: no numbers to read.
  const share = useSharedValue(0);
  useEffect(() => {
    share.value = withSpring(queue.length ? index / queue.length : 0, { ...(reduced ? calm : spring.settle), reduceMotion: keep });
  }, [index, queue.length, share, reduced]);
  const filled = useAnimatedStyle(() => ({ transform: [{ scaleX: share.value }] }));

  /** Sort the card: it leaves, then the change is made and the next card is dealt in. */
  const sort = (result: Result, apply: () => void, message: { icon: IconName; text: string } | null) => {
    if (!current || busy.current) return;
    busy.current = true;
    (result === "let-go" ? doneHaptic : tick)();
    const arrive = () => {
      apply();
      setNote(message);
      setIndex((i) => i + 1);
      const from = reduced ? STILL : ARRIVES;
      x.value = from.x;
      y.value = from.y;
      turn.value = from.turn;
      scale.value = from.scale;
      fade.value = 0;
      x.value = withSpring(0, spring.glide);
      y.value = withSpring(0, spring.glide);
      turn.value = withSpring(0, spring.glide);
      scale.value = withSpring(1, spring.glide);
      fade.value = withTiming(1, fadeTiming(duration.base));
      busy.current = false;
    };
    const to = reduced ? STILL : LEAVES[result];
    const out = { duration: duration.quick + 60, easing: easeOut };
    x.value = withTiming(to.x, out);
    y.value = withTiming(to.y, out);
    turn.value = withTiming(to.turn, out);
    scale.value = withTiming(to.scale, out);
    fade.value = withTiming(0, fadeTiming(duration.quick + 40), (finished) => {
      if (finished) scheduleOnRN(arrive);
    });
  };

  const moveTo = (day: Day, result: "today" | "moved") => {
    if (!current) return;
    const id = current.id;
    sort(result, () => moveTask(id, day, { record: true }), { icon: result === "today" ? "today" : "calendar", text: `Moved to ${dayLabel(day)}` });
  };
  const letGo = () => {
    if (!current) return;
    const id = current.id;
    sort("let-go", () => setDone(id, true), { icon: "check", text: "Let go. It's in Done if you want it back." });
  };
  const skip = () => sort("skipped", () => {}, null);

  const days = dayChoices().filter((choice) => choice.label === "Tomorrow" || choice.label === "Weekend" || choice.label === "Next week");

  return (
    <View style={[styles.screen, { backgroundColor: colors.page, paddingTop: insets.top + space[1], paddingBottom: insets.bottom + space[3] }]}>
      <View style={styles.head}>
        <IconButton icon="close" label="Close" onPress={() => router.back()} />
        <Txt variant="headline" accessibilityRole="header">
          Catch up
        </Txt>
        <View style={styles.spacer} />
      </View>
      {current ? (
        <View style={[styles.track, { backgroundColor: colors.line }]}>
          <Animated.View style={[styles.filled, { backgroundColor: accent.solid }, filled]} />
        </View>
      ) : null}

      {current ? (
        <>
          <ScrollView style={styles.flex} contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
            <View>
              {index < queue.length - 1 ? <Animated.View style={[styles.peek, { backgroundColor: colors.card, boxShadow: colors.cardShadow }, peek]} /> : null}
              <Animated.View style={[styles.card, { backgroundColor: colors.card, boxShadow: colors.shadow }, card]}>
                <Txt variant="footnote" tone="ink3" weight="semibold">
                  {current.area}
                </Txt>
                <Txt variant="title1" center style={styles.cardTitle}>
                  {current.title}
                </Txt>
                <View style={[styles.late, { backgroundColor: colors.warmSoft }]}>
                  <Icon name="late" size={14} color={colors.warm} weight="semibold" />
                  <Txt variant="footnote" tone="warm" weight="bold">
                    {current.day ? (lateLabel(current.day) ?? dayLabel(current.day)) : "No day"}
                  </Txt>
                </View>
              </Animated.View>
            </View>
            <View style={styles.noteSlot}>
              {note ? (
                <Animated.View key={`${index}-note`} entering={arrive} style={styles.note}>
                  <Icon name={note.icon} size={15} color={colors.ink3} weight="medium" />
                  <Txt variant="footnote" tone="ink3">
                    {note.text}
                  </Txt>
                </Animated.View>
              ) : null}
            </View>
          </ScrollView>

          <View style={styles.actions}>
            <Button label="Do it today" icon="today" onPress={() => moveTo(today(), "today")} />
            <View style={styles.days} accessibilityLabel="Move to another day">
              {days.map((choice) => (
                <Chip key={choice.label} icon="calendar" label={choice.label} onPress={() => choice.day && moveTo(choice.day, "moved")} />
              ))}
            </View>
            <ButtonPair>
              <Button label="Let it go" icon="close" variant="plain" size="md" flex onPress={letGo} accessibilityLabel="Let it go. You can bring it back from Done." />
              <Button label="Skip" icon="forward" variant="plain" size="md" flex onPress={skip} accessibilityLabel="Skip for now" />
            </ButtonPair>
          </View>
        </>
      ) : (
        <>
          <Animated.View entering={arriveSlow} style={styles.summary}>
            <Sprout size={128} />
            <Txt variant="title1" center>
              All caught up
            </Txt>
            <Txt variant="callout" tone="ink2" center>
              {queue.length === 0 ? "Nothing has slipped past its day." : "Everything that slipped has a place now."}
            </Txt>
          </Animated.View>
          <View style={styles.actions}>
            <Button label="Back to today" onPress={() => router.back()} />
          </View>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  flex: { flex: 1 },
  head: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: edge - 11 },
  spacer: { width: 44 },
  track: { height: 4, borderRadius: 2, marginHorizontal: edge * 3, marginTop: space[2], overflow: "hidden" },
  filled: { height: 4, borderRadius: 2, transformOrigin: "left" },
  body: { flexGrow: 1, paddingHorizontal: edge, paddingTop: space[6], paddingBottom: space[3], justifyContent: "center" },
  peek: { position: "absolute", left: 14, right: 14, bottom: -10, height: 60, borderRadius: radius.lg, borderCurve: "continuous" },
  card: { minHeight: 250, padding: space[6], borderRadius: radius.lg, borderCurve: "continuous", gap: space[4], alignItems: "center", justifyContent: "center" },
  cardTitle: { paddingHorizontal: space[2] },
  late: { flexDirection: "row", alignItems: "center", gap: 6, height: 28, paddingHorizontal: 12, borderRadius: radius.pill },
  noteSlot: { minHeight: 24, marginTop: space[5], alignItems: "center", justifyContent: "center" },
  note: { flexDirection: "row", alignItems: "center", gap: 6 },
  actions: { paddingHorizontal: edge, gap: space[3], paddingBottom: space[2] },
  days: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: space[2], flexWrap: "wrap" },
  summary: { flex: 1, alignItems: "center", justifyContent: "center", gap: space[3], paddingHorizontal: edge },
});
