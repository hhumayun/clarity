import React, { useCallback, useMemo, useRef } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { formatShortDate } from "../lib/dates";
import { dayKey, monthGrid } from "../lib/notesList";
import { useAppTheme } from "../providers/AppThemeProvider";
import { fonts, spacing, textSize, type Colors } from "../theme";

/** What a day holds, for its marks. */
export type DayMarks = { notes: boolean; tasks: boolean };

const WEEKDAY_LETTERS = ["M", "T", "W", "T", "F", "S", "S"];
const CIRCLE = 38;

type Props = {
  /** Any day of the month to show. */
  month: Date;
  selected: Date;
  /** Each day's marks, by dayKey. */
  marks: Map<string, DayMarks>;
  onPick: (day: Date) => void;
};

/**
 * A month as six weeks of days, Monday first. Today is ringed and the chosen
 * day filled. Under each date, a grey mark if notes were written that day and
 * a teal one if open tasks are due. Days of the months either side are faint.
 */
export function MonthGrid({ month, selected, marks, onPick }: Props) {
  const { colors, scale } = useAppTheme();
  const styles = stylesFor(colors, scale);
  const year = month.getFullYear();
  const monthIndex = month.getMonth();
  const days = useMemo(() => monthGrid(new Date(year, monthIndex, 1)), [year, monthIndex]);
  const todayKey = dayKey(new Date());
  const selectedKey = dayKey(selected);
  // One function for every cell, so a cell redraws only when its own day does.
  const pickRef = useRef(onPick);
  pickRef.current = onPick;
  const pick = useCallback((ms: number) => pickRef.current(new Date(ms)), []);

  return (
    <View>
      <View style={styles.row}>
        {WEEKDAY_LETTERS.map((letter, index) => (
          <Text key={index} style={styles.letter} importantForAccessibility="no">
            {letter}
          </Text>
        ))}
      </View>
      {[0, 1, 2, 3, 4, 5].map((week) => (
        <View key={week} style={styles.row}>
          {days.slice(week * 7, week * 7 + 7).map((day) => {
            const mark = marks.get(day.key);
            return (
              <DayCell
                key={day.key}
                ms={day.date.getTime()}
                day={day.day}
                inMonth={day.date.getMonth() === monthIndex}
                today={day.key === todayKey}
                selected={day.key === selectedKey}
                notes={Boolean(mark?.notes)}
                tasks={Boolean(mark?.tasks)}
                onPick={pick}
              />
            );
          })}
        </View>
      ))}
    </View>
  );
}

type CellProps = {
  ms: number;
  day: number;
  inMonth: boolean;
  today: boolean;
  selected: boolean;
  notes: boolean;
  tasks: boolean;
  onPick: (ms: number) => void;
};

const DayCell = React.memo(function DayCell({ ms, day, inMonth, today, selected, notes, tasks, onPick }: CellProps) {
  const { colors, scale } = useAppTheme();
  const styles = stylesFor(colors, scale);
  const label = [
    today ? "Today" : formatShortDate(new Date(ms)),
    notes ? "notes" : "",
    tasks ? "tasks due" : "",
  ]
    .filter(Boolean)
    .join(", ");
  return (
    <Pressable
      onPress={() => onPick(ms)}
      style={({ pressed }) => [styles.cell, !inMonth && !selected && styles.outside, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={label}
    >
      <View style={[styles.circle, today && styles.circleToday, selected && styles.circleSelected]}>
        <Text style={[styles.number, (today || selected) && styles.numberStrong, selected && styles.numberSelected]}>
          {day}
        </Text>
      </View>
      <View style={styles.marks}>
        {notes ? <View style={[styles.mark, styles.markNotes]} /> : null}
        {tasks ? <View style={[styles.mark, styles.markTasks]} /> : null}
      </View>
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
  return StyleSheet.create({
    row: { flexDirection: "row" },
    letter: {
      flex: 1,
      textAlign: "center",
      fontFamily: fonts.baseSemi,
      fontSize: textSize.label * scale,
      color: colors.mutedForeground,
      paddingBottom: spacing[2],
    },
    cell: { flex: 1, alignItems: "center", paddingVertical: 3 },
    outside: { opacity: 0.35 },
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
    number: { fontFamily: fonts.base, fontSize: textSize.body * scale, color: colors.foreground },
    numberStrong: { fontFamily: fonts.baseSemi },
    numberSelected: { color: colors.primaryForeground },
    marks: { flexDirection: "row", gap: 3, height: 5, marginTop: 3 },
    mark: { width: 5, height: 5, borderRadius: 2.5 },
    markNotes: { backgroundColor: colors.mutedForeground },
    markTasks: { backgroundColor: colors.primary },
  });
}
