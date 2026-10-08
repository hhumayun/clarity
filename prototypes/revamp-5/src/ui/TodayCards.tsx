import { useRouter } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import Animated, { interpolateColor, LayoutAnimationConfig, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { Hourglass } from "../art/Pictures";
import { TimeOfDay } from "../art/TimeOfDay";
import { greetings, questions } from "../data/prompts";
import { today } from "../lib/dates";
import { noteTime, openOn } from "../store/selectors";
import { useDevice } from "../state/device";
import { useSage, useSageStatus, useWhenEditable } from "../data/sage";
import { arrive, duration, fadeTiming, leave } from "../theme/motion";
import { useTheme } from "../theme/ThemeProvider";
import { edge, radius, space } from "../theme/tokens";
import { Card } from "./Card";
import { CircleCheck } from "./CircleCheck";
import { tap } from "./haptics";
import { Icon } from "./Icon";
import { Txt, useType } from "./Txt";

// For the round-3 rows (2026-10-07): the web build's `?focusline=short` shows the Focus card without the
// task's name, since some looks name it again just below. Asked of the user before anything changes.
const FOCUS_SHORT = process.env.EXPO_OS === "web" && typeof window !== "undefined" && new URLSearchParams(window.location.search).get("focusline") === "short";

/**
 * Today's two ways in, side by side, in the shape of Rosebud's pair of
 * cards but holding Clarity's own two activities: writing to the day's
 * question, and focusing on what's next. Each has its small living
 * picture. They sit on a quieter surface than the tasks, with no lift, so
 * the day's tasks below stay the strongest thing on the page. Once today's page is written its card settles into the page,
 * like a finished thing: the card sinks into the page, the picture dims,
 * the words go grey, and a check pops in. Focus stays open for another session; a small check in
 * its corner says there's been one today.
 */
export function TodayCards() {
  const router = useRouter();
  const { phase, colors } = useTheme();
  const tasks = useSage((state) => state.tasks);
  const notes = useSage((state) => state.notes);
  const pages = useSage((state) => state.pages);
  const focusLength = useDevice((state) => state.prefs.focusLength);
  const focusToday = useSage((state) => state.focusToday);
  const t = today();
  const pageId = pages[t];
  const page = pageId ? notes.find((note) => note.id === pageId) : undefined;
  const next = openOn(tasks, t)[0];
  const whenEditable = useWhenEditable();
  const question = questions[phase][0];

  return (
    <View style={styles.pair}>
      <WriteCard
        title={greetings[phase]}
        question={question}
        written={page ? noteTime(page.time) : null}
        onPress={() => {
          tap();
          if (page) router.push(`/note/${page.id}`);
          else whenEditable(() => router.push(`/note/new?prompt=${encodeURIComponent(question)}&page=1`));
        }}
      />
      <Card
        inset={false}
        onPress={() => {
          tap();
          if (next) router.push(`/focus/${next.id}`);
          else whenEditable(() => router.push(`/quick-add?day=${t}`));
        }}
        accessibilityRole="button"
        accessibilityLabel={next ? `Focus on ${next.title}, ${focusLength} minutes` : "Nothing to focus on. Add a task"}
        style={[styles.card, { backgroundColor: colors.quiet, boxShadow: "none" }]}
      >
        {focusToday > 0 ? (
          <View style={styles.corner} accessibilityLabel="You've focused today">
            <CircleCheck on size={20} />
          </View>
        ) : null}
        <View style={styles.picture}>
          <Hourglass size={54} />
        </View>
        <Txt variant="headline" center style={styles.title}>
          Focus
        </Txt>
        {/* What's next changes (the first task ticked): the words cross-fade, as they swapped in one frame. */}
        <LayoutAnimationConfig skipEntering>
          <Animated.View key={next?.id ?? "none"} entering={arrive} exiting={leave} style={styles.next}>
            {next ? (
              <>
                {FOCUS_SHORT ? null : (
                  <Txt variant="subhead" tone="ink2" center numberOfLines={2} style={styles.sub}>
                    {next.title}
                  </Txt>
                )}
                <View style={styles.meta}>
                  <Icon name="timer" size={13} color={colors.ink3} weight="semibold" />
                  <Txt variant="footnote" tone="ink3">
                    {focusLength} min
                  </Txt>
                </View>
              </>
            ) : (
              <Txt variant="subhead" tone="ink2" center numberOfLines={2} style={styles.sub}>
                Add something to work on
              </Txt>
            )}
          </Animated.View>
        </LayoutAnimationConfig>
      </Card>
    </View>
  );
}

function WriteCard({ title, question, written, onPress }: { title: string; question: string; written: string | null; onPress: () => void }) {
  const { colors, phase } = useTheme();
  const { ready } = useSageStatus();
  const headline = useType("headline");
  // Written, the card settles into the page in one movement: it takes the page's colour and a
  // quiet outline, the picture dims, the greeting greys and the question gives way to a check.
  // That starts once you're back on Today (not while the note still covers it). Already written
  // when the day's tasks and notes arrived, it's simply settled, with no show.
  const [shown, setShown] = useState(!!written);
  const sink = useSharedValue(written ? 1 : 0);
  const before = useRef(!!written);
  const wasReady = useRef(ready);
  useEffect(() => {
    const arriving = !wasReady.current;
    wasReady.current = ready;
    if (!!written === before.current) return;
    before.current = !!written;
    if (arriving) {
      setShown(!!written);
      sink.value = written ? 1 : 0;
      return;
    }
    const timer = setTimeout(
      () => {
        setShown(!!written);
        sink.value = withTiming(written ? 1 : 0, fadeTiming(duration.enter));
      },
      written ? 520 : 0,
    );
    return () => clearTimeout(timer);
  }, [written, ready, sink]);
  const pageStyle = useAnimatedStyle(() => ({ opacity: sink.value }));
  const pictureStyle = useAnimatedStyle(() => ({ opacity: 1 - 0.4 * sink.value }));
  const titleStyle = useAnimatedStyle(() => ({ color: interpolateColor(sink.value, [0, 1], [colors.ink, colors.ink2]) }));
  return (
    <Card
      inset={false}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={written ? `${title}. Today's page, written at ${written}` : `${title}. ${question}`}
      style={[styles.card, { backgroundColor: colors.quiet, boxShadow: "none" }]}
    >
      {/* The page's colour and the outline fade in over the card, drawn over its edge so nothing inside moves. */}
      <Animated.View pointerEvents="none" testID="page-settled" style={[styles.sunk, { backgroundColor: colors.page, borderColor: colors.line }, pageStyle]} />
      {/* A new time of day: the picture and greeting cross-fade (they swapped in one frame), but not on first sight. */}
      <LayoutAnimationConfig skipEntering>
        <Animated.View key={phase} entering={arrive} exiting={leave} style={styles.phase}>
          <Animated.View style={[styles.picture, pictureStyle]}>
            <TimeOfDay phase={phase} size={76} />
          </Animated.View>
          <Animated.Text style={[headline, styles.title, styles.center, titleStyle]}>{title}</Animated.Text>
        </Animated.View>
      </LayoutAnimationConfig>
      <LayoutAnimationConfig skipEntering>
        {shown ? (
          <Animated.View key="done" entering={arrive} exiting={leave} style={styles.done}>
            <PopCheck size={24} />
            <Txt variant="footnote" tone="ink3">
              Written at {written}
            </Txt>
          </Animated.View>
        ) : (
          <Animated.View key="question" entering={arrive} exiting={leave}>
            <Txt variant="subhead" tone="ink2" center numberOfLines={3} style={styles.sub}>
              {question}
            </Txt>
          </Animated.View>
        )}
      </LayoutAnimationConfig>
    </Card>
  );
}

/** A check that arrives ticked: it mounts open and ticks itself a beat later, so it pops. */
function PopCheck({ size }: { size: number }) {
  const [on, setOn] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setOn(true), 80);
    return () => clearTimeout(timer);
  }, []);
  return <CircleCheck on={on} size={size} />;
}

const styles = StyleSheet.create({
  phase: { alignItems: "center", alignSelf: "stretch" },
  pair: { flexDirection: "row", gap: space[3], marginHorizontal: edge },
  card: { flex: 1, minHeight: 150, borderRadius: radius.card + 2, alignItems: "center", paddingHorizontal: space[3], paddingTop: space[3], paddingBottom: space[4], gap: 2 },
  picture: { height: 58, justifyContent: "center", marginBottom: 2 },
  title: { fontSize: 16, lineHeight: 21 },
  center: { textAlign: "center" },
  sunk: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, borderRadius: radius.card + 2, borderCurve: "continuous", borderWidth: 1.5 },
  next: { alignItems: "center", alignSelf: "stretch" },
  sub: { paddingHorizontal: 2, fontSize: 14, lineHeight: 19 },
  meta: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 2 },
  corner: { position: "absolute", top: 10, right: 10 },
  done: { alignItems: "center", gap: 6, marginTop: 6 },
});
