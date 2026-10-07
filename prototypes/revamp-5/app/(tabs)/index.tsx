import { useNavigation, useRouter, useScrollToTop } from "expo-router";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import Animated, { FadeInLeft, FadeInRight, FadeOutLeft, FadeOutRight, LayoutAnimationConfig, useAnimatedRef } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Tea } from "../../src/art/Pictures";
import { addDays, dateOf, dayLabel, daysBetween, today, weekStart } from "../../src/lib/dates";
import { comingUp, doneOn, notesOn, openOn, slipped } from "../../src/store/selectors";
import { getSage, useSage, useSageStatus, useWhenEditable } from "../../src/data/sage";
import { LoadProblem, SkeletonCards, usePullToRefresh } from "../../src/ui/Loading";
import { arrive, arriveSlow, duration, easeIn, easeOut, leave, reducedAtLaunch, settle, squashSmall } from "../../src/theme/motion";
import { useTheme } from "../../src/theme/ThemeProvider";
import { edge, radius, space } from "../../src/theme/tokens";
import { Button, ButtonPair } from "../../src/ui/Button";
import { CardGroup, CardRow } from "../../src/ui/Card";
import { useScrollY } from "../../src/ui/chrome";
import { tap } from "../../src/ui/haptics";
import { Icon } from "../../src/ui/Icon";
import { IconButton } from "../../src/ui/IconButton";
import { NoteCard } from "../../src/ui/NoteCard";
import { PressableScale } from "../../src/ui/PressableScale";
import { SectionTitle } from "../../src/ui/SectionTitle";
import { DoneFold, TaskCard } from "../../src/ui/TaskCard";
import { TodayCards } from "../../src/ui/TodayCards";
import { TopBar } from "../../src/ui/TopBar";
import { Txt } from "../../src/ui/Txt";
import { WeekStrip, type StripDay } from "../../src/ui/WeekStrip";

/**
 * Today, in Rosebud's order: the day's name and its date, with the week
 * under them, stay at the top as one compact head; then the day's two ways
 * in (write, focus), then its tasks on a card with their two actions
 * underneath, then what was written. Tap another day, or swipe the week,
 * and the page becomes that day, sliding in from the side it came from.
 * Nothing on it counts.
 */
export default function Today() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const whenEditable = useWhenEditable();
  const { ready } = useSageStatus();
  // Done, open or folded: kept here so the page redraws as it opens (see DoneFold).
  const [doneOpen, setDoneOpen] = useState(false);
  // Whether the tasks were waited for (the placeholder showed): then they arrive with a fade.
  const loadedLate = useRef(!ready);
  if (!ready) loadedLate.current = true;
  // Once arrived, later days don't fade it in again (they slide in whole).
  useEffect(() => {
    if (ready) loadedLate.current = false;
  }, [ready]);
  const pull = usePullToRefresh();
  const navigation = useNavigation();
  const tasks = useSage((state) => state.tasks);
  const notes = useSage((state) => state.notes);
  const viewDay = useSage((state) => state.viewDay);
  const setViewDay = useSage((state) => state.setViewDay);
  const { onScroll, scrollY } = useScrollY();
  const scroller = useAnimatedRef<Animated.ScrollView>();
  useScrollToTop(scroller as never);
  const t = today();
  const isToday = viewDay === t;

  // Tapping Today while on it comes back to today, as well as to the top.
  // Coming to Today from another place keeps the day you were looking at.
  useEffect(() => {
    const unsubscribe = (navigation as unknown as { addListener: (event: "tabPress", cb: () => void) => () => void }).addListener("tabPress", () => {
      if (!navigation.isFocused()) return;
      if (getSage().viewDay !== today()) getSage().setViewDay(today());
    });
    return unsubscribe;
  }, [navigation]);

  // Which way the day moved, so its page slides in from that side.
  const previous = useRef(viewDay);
  const forward = viewDay >= previous.current;
  useEffect(() => {
    previous.current = viewDay;
  }, [viewDay]);

  const week = useMemo<StripDay[]>(() => {
    const monday = weekStart(viewDay);
    return Array.from({ length: 7 }, (_, i) => {
      const day = addDays(monday, i);
      const open = openOn(tasks, day).length;
      const done = doneOn(tasks, day).length;
      const written = notesOn(notes, day).length;
      // A check for a day whose tasks all got done; a dot for a day you wrote. Plans alone leave no mark.
      const mark = day <= t && done > 0 && open === 0 ? "done" : written > 0 ? "has" : "none";
      return { day, mark };
    });
  }, [viewDay, notes, tasks, t]);

  const dayNotes = notesOn(notes, viewDay);
  const open = openOn(tasks, viewDay);
  const done = doneOn(tasks, viewDay);
  const late = isToday ? slipped(tasks) : [];
  const next = isToday ? comingUp(tasks) : [];
  const offset = daysBetween(t, viewDay);
  const label = dayLabel(viewDay);
  const long = dateOf(viewDay).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
  // "Today" over "Monday 5 October"; "Wednesday" over "7 October".
  const subtitle = long.startsWith(label) ? long.slice(label.length).trim() : long;

  const empty = (
    <View style={styles.empty}>
      <Tea size={64} />
      <Txt variant="subhead" tone="ink3" center>
        {/* Everything ticked off isn't "nothing planned". */}
        {done.length ? (isToday ? "All done for today. Enjoy the quiet." : offset > 0 ? "All done." : "All done that day.") : isToday ? "Nothing planned for today. Enjoy the quiet." : offset > 0 ? "Nothing planned yet." : "Nothing was planned."}
      </Txt>
    </View>
  );

  return (
    <View style={[styles.screen, { backgroundColor: colors.page }]}>
      <TopBar
        title={label}
        subtitle={subtitle}
        changeKey={viewDay}
        onTitle={() => router.push("/sheet/date?mode=day")}
        titleLabel={`${label}, ${subtitle}. Choose a day`}
        scrollY={scrollY}
        left={
          !isToday ? (
            <Animated.View entering={arrive} exiting={leave}>
              <PressableScale
                onPress={() => {
                  tap();
                  setViewDay(t);
                }}
                accessibilityRole="button"
                accessibilityLabel="Back to today"
                scaleTo={squashSmall}
                style={[styles.back, { backgroundColor: colors.card }]}
              >
                <Icon name="back" size={13} color={colors.ink} weight="bold" />
                <Txt variant="footnote" weight="bold">
                  Today
                </Txt>
              </PressableScale>
            </Animated.View>
          ) : null
        }
        right={<IconButton icon="gear" label="Settings" onPress={() => router.push("/settings")} />}
      >
        <View style={styles.strip}>
          <WeekStrip days={week} selected={viewDay} onSelect={setViewDay} onWeek={(step) => setViewDay(addDays(viewDay, step * 7))} />
        </View>
      </TopBar>

      <Animated.ScrollView
        ref={scroller}
        testID="today"
        onScroll={onScroll}
        scrollEventThrottle={16}
        contentInsetAdjustmentBehavior="never"
        showsVerticalScrollIndicator={false}
        refreshControl={pull}
        contentContainerStyle={{ paddingBottom: insets.bottom + 120 }}
      >
        <LoadProblem />
        {/* Another day: the old one leaves toward the far side, quicker than the new one arrives from the near one (it used to vanish, leaving a blank frame). */}
        <Animated.View
          key={viewDay}
          entering={reducedAtLaunch ? arriveSlow : (forward ? FadeInRight : FadeInLeft).duration(duration.enter).easing(easeOut)}
          exiting={reducedAtLaunch ? leave : (forward ? FadeOutLeft : FadeOutRight).duration(duration.quick).easing(easeIn)}
        >
          {isToday ? (
            <View style={styles.cards}>
              <TodayCards />
            </View>
          ) : null}

          <SectionTitle title="Tasks" first={!isToday} />
          {/* Loaded: the placeholder fades as the card arrives, only if it was waited for. */}
          {ready ? (
            <Animated.View entering={loadedLate.current ? arriveSlow : undefined}>
              <TaskCard tasks={open} variant={isToday ? "today" : "day"} empty={empty} foldKey={viewDay} />
            </Animated.View>
          ) : (
            <Animated.View exiting={leave}>
              <SkeletonCards cards={1} rows={3} label="Loading your tasks" />
            </Animated.View>
          )}
          {/* Everything under the tasks moves with them: the card glides as a task leaves or lands,
              and this followed in one frame, covering its edge or leaving a gap. Each block moves on
              its own, at one level (moving boxes inside moving boxes doubled their movement in the
              web build). Drawn as the day opens, nothing here animates in. */}
          <LayoutAnimationConfig skipEntering>
            <Animated.View layout={settle}>
              <ButtonPair style={styles.actions}>
                <Button label="Add task" icon="plus" variant="secondary" size="md" flex onPress={() => whenEditable(() => router.push(`/quick-add?day=${viewDay}`))} />
                {late.length ? (
                  <Button label="Catch up" icon="rotate" variant="secondary" size="md" flex onPress={() => router.push("/catch-up")} accessibilityLabel="Catch up on what slipped" />
                ) : (
                  <Button label="All tasks" icon="life" variant="secondary" size="md" flex onPress={() => router.navigate("/life")} />
                )}
              </ButtonPair>
            </Animated.View>
            {/* Kept here, so the page redraws as Done opens and what follows glides (in the web build, only what redraws moves). */}
            {ready ? <DoneFold tasks={done} open={doneOpen} onOpen={setDoneOpen} /> : null}

            {dayNotes.length ? (
              <Animated.View key="notes" layout={settle} entering={arrive} exiting={leave}>
                <SectionTitle title="Notes" />
                <View style={styles.notes}>
                  {dayNotes.map((note) => (
                    <Animated.View key={note.id} entering={arrive} exiting={leave}>
                      <NoteCard note={note} onPress={() => router.push(`/note/${note.id}`)} />
                    </Animated.View>
                  ))}
                </View>
              </Animated.View>
            ) : null}

            {next.length ? (
              <Animated.View key="next" layout={settle} entering={arrive} exiting={leave}>
                <SectionTitle title="Coming up" onPress={() => router.navigate("/life")} accessibilityLabel="Coming up. See all tasks" />
                <CardGroup moving>
                  {next.map((task) => (
                    <CardRow key={task.id} onPress={() => router.push(`/task/${task.id}`)} accessibilityRole="button" accessibilityLabel={`${task.title}, ${task.day ? dayLabel(task.day) : ""}`} style={styles.coming}>
                      <Txt variant="row" numberOfLines={1} style={styles.flex}>
                        {task.title}
                      </Txt>
                      <Txt variant="footnote" tone="ink3">
                        {task.day ? dayLabel(task.day) : ""}
                      </Txt>
                    </CardRow>
                  ))}
                </CardGroup>
              </Animated.View>
            ) : null}
          </LayoutAnimationConfig>
        </Animated.View>
      </Animated.ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  flex: { flex: 1 },
  back: { flexDirection: "row", alignItems: "center", gap: 4, height: 32, paddingHorizontal: 12, borderRadius: radius.pill, borderCurve: "continuous", marginLeft: 10 },
  strip: { paddingHorizontal: edge - 4, paddingBottom: space[2] },
  cards: { paddingTop: space[3] },
  empty: { alignItems: "center", gap: space[3] },
  actions: { marginHorizontal: edge, marginTop: space[3] },
  notes: { gap: space[3] },
  coming: { flexDirection: "row", alignItems: "center", gap: space[3], paddingVertical: 15 },
});
