import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type ListRenderItemInfo,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";
// Gesture handler's FlatList, so a sideways page and the up-or-down pull
// settle which one the finger means, rather than both moving at once.
import { FlatList, Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { interpolate, runOnJS, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { useNotes } from "../hooks/useNotes";
import { formatShortDate } from "../lib/dates";
import {
  addDays,
  dayKey,
  mondayOf,
  monthGrid,
  monthsBetween,
  rowInMonth,
  stripRange,
  weeksBetween,
} from "../lib/notesList";
import { useAppTheme } from "../providers/AppThemeProvider";
import { fonts, spacing, textSize, type Colors } from "../theme";
import { EASE_OUT, MOTION } from "./motion";

// Every day is a cell this tall, so a week is one row and a month six, and
// the month can open from the week a row at a time.
const CELL_H = 52;
const CIRCLE = 38;
const LETTERS_H = 22;
const HANDLE_H = 18;
const WEEKDAY_LETTERS = ["M", "T", "W", "T", "F", "S", "S"];
// How far back and ahead the dates go: ten years back, five ahead.
const WEEKS_BACK = 520;
const WEEKS_AHEAD = 260;
const MONTHS_BACK = 120;
const MONTHS_AHEAD = 60;
const WEEKS = Array.from({ length: WEEKS_BACK + WEEKS_AHEAD + 1 }, (_, i) => i - WEEKS_BACK);
const MONTHS = Array.from({ length: MONTHS_BACK + MONTHS_AHEAD + 1 }, (_, i) => i - MONTHS_BACK);
// Pulling this far opens the month all the way; less, and it opens if past halfway.
const PULL_RANGE = 160;
// Pushing the week up this far folds the dates away.
const FOLD_PUSH = 30;
const FLICK = 500;

/** A style for Animated.View, plain or animated. */
type AnimatedViewStyle = React.ComponentProps<typeof Animated.View>["style"];

export type DayCalendarHandle = {
  /** Open the month from the week, or close it back to the week. */
  setMonthOpen: (open: boolean) => void;
};

type Props = {
  /** The dates at all; the day's title folds them away. */
  open: boolean;
  /** The day shown below. */
  selected: Date;
  /** Days with open tasks due, by dayKey. */
  taskDays: Set<string>;
  /** A day tapped, in the week or the month. */
  onPick: (day: Date) => void;
  /** The week swiped to (its Monday). */
  onWeekChange: (monday: Date) => void;
  /** The month swiped to (its 1st). */
  onMonthChange: (first: Date) => void;
  onMonthOpenChange?: (open: boolean) => void;
  /** The week pushed up: fold the dates away. */
  onPushUp?: () => void;
};

/**
 * The day view's dates: a week, Monday first, that opens into its month.
 *
 * Both swipe sideways under the finger (native paging), the week by weeks and
 * the month by months, back into the past and on into the future. Pulling
 * down opens the month out of the week: the week's row stays where it is, the
 * weeks before it come down from above it and the ones after it appear
 * below, and the days of the months either side fade back. Pushing up closes
 * it the same way. Under each date, a grey mark for notes written that day
 * and a teal one for open tasks due.
 */
export const DayCalendar = forwardRef<DayCalendarHandle, Props>(function DayCalendar(
  { open, selected, taskDays, onPick, onWeekChange, onMonthChange, onMonthOpenChange, onPushUp },
  ref,
) {
  const { colors, scale } = useAppTheme();
  const styles = stylesFor(colors, scale);
  const { width: screenWidth } = useWindowDimensions();
  const [width, setWidth] = useState(screenWidth - 2 * spacing[4]);
  // What week 0 and month 0 count from.
  const [base] = useState(() => new Date());
  const [monthOpen, setMonthOpenState] = useState(false);

  // 0 is the week, 1 the month; `shown` folds everything away.
  const progress = useSharedValue(0);
  const shown = useSharedValue(open ? 1 : 0);
  useEffect(() => {
    shown.value = withTiming(open ? 1 : 0, { duration: MOTION.base, easing: EASE_OUT });
  }, [open, shown]);

  const selectedKey = dayKey(selected);
  const todayKey = dayKey(new Date());
  // The chosen day's row in its month, which the month opens around.
  const row = useSharedValue(rowInMonth(selected));
  useEffect(() => {
    row.value = rowInMonth(selected);
    // The key names the day; the Date itself is a new object each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedKey, row]);

  // The pages showing, kept on the chosen day when it changes from elsewhere
  // (a day picked in the month, Today, a date typed in).
  const weekIndex = WEEKS_BACK + weeksBetween(base, selected);
  const monthIndex = MONTHS_BACK + monthsBetween(base, selected);
  const weekList = useRef<FlatList<number>>(null);
  const monthList = useRef<FlatList<number>>(null);
  const shownWeek = useRef(weekIndex);
  const shownMonth = useRef(monthIndex);
  useEffect(() => {
    if (shownWeek.current !== weekIndex) {
      shownWeek.current = weekIndex;
      try {
        weekList.current?.scrollToIndex({ index: weekIndex, animated: !monthOpen });
      } catch {
        // Not laid out yet: it starts on the right page anyway.
      }
    }
    if (shownMonth.current !== monthIndex) {
      shownMonth.current = monthIndex;
      try {
        monthList.current?.scrollToIndex({ index: monthIndex, animated: monthOpen });
      } catch {
        // As above.
      }
    }
  }, [weekIndex, monthIndex, monthOpen]);

  const handlers = useRef({ onPick, onWeekChange, onMonthChange, onMonthOpenChange, onPushUp });
  handlers.current = { onPick, onWeekChange, onMonthChange, onMonthOpenChange, onPushUp };
  const pick = useCallback((ms: number) => handlers.current.onPick(new Date(ms)), []);

  const pageOf = (event: NativeSyntheticEvent<NativeScrollEvent>) =>
    Math.round(event.nativeEvent.contentOffset.x / Math.max(1, width));
  const onWeekSettled = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const index = pageOf(event);
    if (index === shownWeek.current) return;
    shownWeek.current = index;
    handlers.current.onWeekChange(addDays(mondayOf(base), (index - WEEKS_BACK) * 7));
  };
  const onMonthSettled = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const index = pageOf(event);
    if (index === shownMonth.current) return;
    shownMonth.current = index;
    handlers.current.onMonthChange(new Date(base.getFullYear(), base.getMonth() + index - MONTHS_BACK, 1));
  };

  // Opening and closing: under the finger, or on its own from the handle.
  const settle = useCallback((toMonth: boolean) => {
    setMonthOpenState(toMonth);
    handlers.current.onMonthOpenChange?.(toMonth);
  }, []);
  const pushUp = useCallback(() => handlers.current.onPushUp?.(), []);
  const setMonthOpen = useCallback(
    (toMonth: boolean) => {
      progress.value = withTiming(toMonth ? 1 : 0, { duration: MOTION.slow, easing: EASE_OUT }, (finished) => {
        if (finished) runOnJS(settle)(toMonth);
      });
    },
    [progress, settle],
  );
  useImperativeHandle(ref, () => ({ setMonthOpen }), [setMonthOpen]);

  const start = useSharedValue(0);
  const pull = useMemo(
    () =>
      Gesture.Pan()
        // Only an up-or-down drag; a sideways one pages the dates.
        .activeOffsetY([-10, 10])
        .failOffsetX([-12, 12])
        .onStart(() => {
          start.value = progress.value;
        })
        .onUpdate((event) => {
          progress.value = Math.min(1, Math.max(0, start.value + event.translationY / PULL_RANGE));
        })
        .onEnd((event) => {
          if (start.value === 0 && progress.value === 0 && event.translationY < -FOLD_PUSH) {
            runOnJS(pushUp)();
            return;
          }
          const toMonth =
            event.velocityY > FLICK ? true : event.velocityY < -FLICK ? false : progress.value > 0.5;
          progress.value = withTiming(toMonth ? 1 : 0, { duration: MOTION.base, easing: EASE_OUT }, (finished) => {
            if (finished) runOnJS(settle)(toMonth);
          });
        }),
    [progress, start, pushUp, settle],
  );

  const boxStyle = useAnimatedStyle(() => ({
    height: shown.value * (LETTERS_H + CELL_H * (1 + 5 * progress.value) + HANDLE_H),
    opacity: shown.value,
  }));
  const pagesStyle = useAnimatedStyle(() => ({ height: CELL_H * (1 + 5 * progress.value) }));
  // The two are drawn alike, so swapping them while the month is shut (its
  // chosen row exactly where the week is) cannot be seen.
  const weekLayer = useAnimatedStyle(() => ({ opacity: progress.value > 0.001 ? 0 : 1 }));
  const monthLayer = useAnimatedStyle(() => ({
    opacity: progress.value > 0.001 ? 1 : 0,
    transform: [{ translateY: -row.value * CELL_H * (1 - progress.value) }],
  }));
  // The months either side: plain in the week, faint once the month is open.
  const faint = useAnimatedStyle(() => ({ opacity: interpolate(progress.value, [0, 1], [1, 0.35]) }));

  const pageData = useMemo(
    () => ({ width, selectedKey, todayKey, taskDays }),
    [width, selectedKey, todayKey, taskDays],
  );
  const layout = useCallback(
    (_: ArrayLike<number> | null | undefined, index: number) => ({ length: width, offset: width * index, index }),
    [width],
  );
  const renderWeek = ({ item }: ListRenderItemInfo<number>) => (
    <WeekPage offset={item} base={base} {...pageData} onPick={pick} />
  );
  const renderMonth = ({ item }: ListRenderItemInfo<number>) => (
    <MonthPage offset={item} base={base} {...pageData} onPick={pick} faint={faint} />
  );

  return (
    <GestureDetector gesture={pull}>
      <Animated.View style={[styles.box, boxStyle]}>
        <View
          style={styles.letters}
          onLayout={(event) => {
            const next = Math.round(event.nativeEvent.layout.width);
            if (next > 0 && next !== width) setWidth(next);
          }}
        >
          {WEEKDAY_LETTERS.map((letter, index) => (
            <Text key={index} style={styles.letter} importantForAccessibility="no">
              {letter}
            </Text>
          ))}
        </View>
        <Animated.View style={[styles.pages, pagesStyle]}>
          <Animated.View style={[styles.layer, monthLayer]} pointerEvents={monthOpen ? "auto" : "none"}>
            <FlatList
              ref={monthList}
              data={MONTHS}
              keyExtractor={String}
              renderItem={renderMonth}
              extraData={pageData}
              horizontal
              pagingEnabled
              showsHorizontalScrollIndicator={false}
              getItemLayout={layout}
              initialScrollIndex={monthIndex}
              initialNumToRender={1}
              maxToRenderPerBatch={2}
              windowSize={3}
              onMomentumScrollEnd={onMonthSettled}
              style={styles.monthList}
            />
          </Animated.View>
          <Animated.View style={[styles.layer, weekLayer]} pointerEvents={monthOpen ? "none" : "auto"}>
            <FlatList
              ref={weekList}
              data={WEEKS}
              keyExtractor={String}
              renderItem={renderWeek}
              extraData={pageData}
              horizontal
              pagingEnabled
              showsHorizontalScrollIndicator={false}
              getItemLayout={layout}
              initialScrollIndex={weekIndex}
              initialNumToRender={1}
              maxToRenderPerBatch={2}
              windowSize={3}
              onMomentumScrollEnd={onWeekSettled}
              style={styles.weekList}
            />
          </Animated.View>
        </Animated.View>
        {/* The handle: pull it (or the dates) down for the month, push up for
            the week; a tap does the same. */}
        <Pressable
          onPress={() => setMonthOpen(!monthOpen)}
          hitSlop={{ top: 4, bottom: 8, left: 40, right: 40 }}
          style={styles.handleArea}
          accessibilityRole="button"
          accessibilityLabel={monthOpen ? "Show the week" : "Show the month"}
        >
          <View style={styles.handle} />
        </Pressable>
      </Animated.View>
    </GestureDetector>
  );
});

type PageProps = {
  base: Date;
  offset: number;
  width: number;
  selectedKey: string;
  todayKey: string;
  taskDays: Set<string>;
  onPick: (ms: number) => void;
};

/**
 * The days of a month with notes, from the same six weeks the month shows
 * (asked for by date, and kept like any other notes on the phone).
 */
function useNoteDays(anyDay: Date): Set<string> {
  const year = anyDay.getFullYear();
  const month = anyDay.getMonth();
  const range = useMemo(() => stripRange(monthGrid(new Date(year, month, 1))), [year, month]);
  const query = useNotes(range);
  return useMemo(() => {
    const notes = query.isPlaceholderData ? [] : (query.data?.notes ?? []);
    return new Set(notes.map((note) => dayKey(note.createdAt)));
  }, [query.isPlaceholderData, query.data]);
}

/** A week, Monday first. */
const WeekPage = React.memo(function WeekPage({ base, offset, width, selectedKey, todayKey, taskDays, onPick }: PageProps) {
  const { colors, scale } = useAppTheme();
  const styles = stylesFor(colors, scale);
  const monday = useMemo(() => addDays(mondayOf(base), offset * 7), [base, offset]);
  // A week across two months takes its marks from the month of its Thursday,
  // whose six weeks hold all seven days.
  const noteDays = useNoteDays(addDays(monday, 3));
  return (
    <View style={[styles.row, { width }]}>
      {Array.from({ length: 7 }, (_, i) => {
        const day = addDays(monday, i);
        const key = dayKey(day);
        return (
          <DayCell
            key={key}
            ms={day.getTime()}
            day={day.getDate()}
            today={key === todayKey}
            selected={key === selectedKey}
            notes={noteDays.has(key)}
            tasks={taskDays.has(key)}
            onPick={onPick}
          />
        );
      })}
    </View>
  );
});

/** A month as six weeks, with the days of the months either side faint. */
const MonthPage = React.memo(function MonthPage({
  base,
  offset,
  width,
  selectedKey,
  todayKey,
  taskDays,
  onPick,
  faint,
}: PageProps & { faint: AnimatedViewStyle }) {
  const { colors, scale } = useAppTheme();
  const styles = stylesFor(colors, scale);
  const first = useMemo(() => new Date(base.getFullYear(), base.getMonth() + offset, 1), [base, offset]);
  const days = useMemo(() => monthGrid(first), [first]);
  const noteDays = useNoteDays(first);
  return (
    <View style={{ width }}>
      {[0, 1, 2, 3, 4, 5].map((week) => (
        <View key={week} style={styles.row}>
          {days.slice(week * 7, week * 7 + 7).map((day) => (
            <DayCell
              key={day.key}
              ms={day.date.getTime()}
              day={day.day}
              today={day.key === todayKey}
              selected={day.key === selectedKey}
              notes={noteDays.has(day.key)}
              tasks={taskDays.has(day.key)}
              faint={day.date.getMonth() !== first.getMonth() ? faint : undefined}
              onPick={onPick}
            />
          ))}
        </View>
      ))}
    </View>
  );
});

type CellProps = {
  ms: number;
  day: number;
  today: boolean;
  selected: boolean;
  notes: boolean;
  tasks: boolean;
  /** For a day of the month either side: how faint it is just now. */
  faint?: AnimatedViewStyle;
  onPick: (ms: number) => void;
};

/** One day: today ringed, the chosen day filled, its marks beneath. */
const DayCell = React.memo(function DayCell({ ms, day, today, selected, notes, tasks, faint, onPick }: CellProps) {
  const { colors, scale } = useAppTheme();
  const styles = stylesFor(colors, scale);
  const label = [today ? "Today" : formatShortDate(new Date(ms)), notes ? "notes" : "", tasks ? "tasks due" : ""]
    .filter(Boolean)
    .join(", ");
  return (
    <Pressable
      onPress={() => onPick(ms)}
      style={({ pressed }) => [styles.cell, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={label}
    >
      <Animated.View style={[styles.cellBody, faint && !selected ? faint : null]}>
        <View style={[styles.circle, today && styles.circleToday, selected && styles.circleSelected]}>
          <Text style={[styles.number, (today || selected) && styles.numberStrong, selected && styles.numberSelected]}>
            {day}
          </Text>
        </View>
        <View style={styles.marks}>
          {notes ? <View style={[styles.mark, styles.markNotes]} /> : null}
          {tasks ? <View style={[styles.mark, styles.markTasks]} /> : null}
        </View>
      </Animated.View>
    </Pressable>
  );
});

// One set of styles per theme and text size, shared by every cell.
const styleCache = new WeakMap<Colors, Map<number, ReturnType<typeof makeStyles>>>();
function stylesFor(colors: Colors, scale: number) {
  let byScale = styleCache.get(colors);
  if (!byScale) {
    byScale = new Map();
    styleCache.set(colors, byScale);
  }
  let styles = byScale.get(scale);
  if (!styles) {
    styles = makeStyles(colors, scale);
    byScale.set(scale, styles);
  }
  return styles;
}

function makeStyles(colors: Colors, scale: number) {
  // The cells keep their size at any text size; the numbers stop growing
  // before they outgrow their circles.
  const textScale = Math.min(scale, 1.2);
  return StyleSheet.create({
    box: { overflow: "hidden", marginTop: spacing[3] },
    letters: { flexDirection: "row", height: LETTERS_H, alignItems: "center" },
    letter: {
      flex: 1,
      textAlign: "center",
      fontFamily: fonts.baseSemi,
      fontSize: textSize.label * textScale,
      color: colors.mutedForeground,
    },
    pages: { overflow: "hidden" },
    layer: { position: "absolute", top: 0, left: 0, right: 0 },
    weekList: { height: CELL_H },
    monthList: { height: CELL_H * 6 },
    row: { flexDirection: "row", height: CELL_H },
    cell: { flex: 1, height: CELL_H },
    cellBody: { flex: 1, alignItems: "center", paddingTop: 3 },
    pressed: { opacity: 0.6 },
    circle: {
      width: CIRCLE,
      height: CIRCLE,
      borderRadius: CIRCLE / 2,
      alignItems: "center",
      justifyContent: "center",
    },
    // Today: the open task's ring (2b), so colour still means chosen.
    circleToday: { borderWidth: 1.5, borderColor: colors.ring },
    circleSelected: { backgroundColor: colors.primary, borderWidth: 0 },
    number: { fontFamily: fonts.base, fontSize: textSize.body * textScale, color: colors.foreground },
    numberStrong: { fontFamily: fonts.baseSemi },
    numberSelected: { color: colors.primaryForeground },
    marks: { flexDirection: "row", gap: 3, height: 5, marginTop: 3 },
    mark: { width: 5, height: 5, borderRadius: 2.5 },
    markNotes: { backgroundColor: colors.mutedForeground },
    markTasks: { backgroundColor: colors.primary },
    handleArea: { height: HANDLE_H, alignItems: "center", justifyContent: "center" },
    handle: { width: 36, height: 4, borderRadius: 2, backgroundColor: colors.border },
  });
}
