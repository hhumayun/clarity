import { ChevronLeft, ChevronRight } from "lucide-react-native";
import React, { useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useAppTheme } from "../providers/AppThemeProvider";
import { fonts, radius, spacing, type Colors } from "../theme";
import {
  MONTHS,
  WEEKDAY_INITIALS,
  addMonths,
  atNoon,
  isSameDay,
  monthGrid,
  startOfMonth,
} from "../lib/dates";
import { Button } from "./Button";
import { Sheet } from "./Sheet";

type Props = {
  open: boolean;
  value: Date | null;
  onClose: () => void;
  onSelect: (date: Date | null) => void;
};

export function DatePickerSheet({ open, value, onClose, onSelect }: Props) {
  const { colors, scale } = useAppTheme();
  const styles = useMemo(() => makeStyles(colors, scale), [colors, scale]);
  const today = new Date();

  const [view, setView] = useState(() => startOfMonth(value ?? today));

  // Reopening should land on the chosen date's month, not wherever the writer
  // last browsed to and then cancelled.
  useEffect(() => {
    if (open) setView(startOfMonth(value ?? new Date()));
  }, [open, value]);

  const year = view.getFullYear();
  const month = view.getMonth();
  const cells = monthGrid(year, month);

  return (
    <Sheet open={open} title="Pick a date" onClose={onClose}>
      <View style={styles.header}>
        <Button
          variant="ghost"
          size="icon"
          accessibilityLabel="Previous month"
          onPress={() => setView(addMonths(view, -1))}
        >
          <ChevronLeft size={22} color={colors.foreground} />
        </Button>
        <Text style={styles.monthLabel}>
          {MONTHS[month]} {year}
        </Text>
        <Button
          variant="ghost"
          size="icon"
          accessibilityLabel="Next month"
          onPress={() => setView(addMonths(view, 1))}
        >
          <ChevronRight size={22} color={colors.foreground} />
        </Button>
      </View>

      <View style={styles.week}>
        {WEEKDAY_INITIALS.map((day, i) => (
          <Text key={`${day}-${i}`} style={styles.weekday}>
            {day}
          </Text>
        ))}
      </View>

      <View style={styles.grid}>
        {cells.map((day, i) => {
          if (day === null) return <View key={`blank-${i}`} style={styles.cell} />;
          const date = atNoon(year, month, day);
          const selected = isSameDay(date, value);
          const isToday = isSameDay(date, today);
          return (
            <Pressable
              key={day}
              style={styles.cell}
              accessibilityLabel={`${day} ${MONTHS[month]} ${year}`}
              accessibilityState={{ selected }}
              onPress={() => {
                onSelect(date);
                onClose();
              }}
            >
              <View
                style={[
                  styles.day,
                  isToday && !selected && styles.dayToday,
                  selected && styles.daySelected,
                ]}
              >
                <Text style={[styles.dayText, selected && styles.dayTextSelected]}>
                  {day}
                </Text>
              </View>
            </Pressable>
          );
        })}
      </View>

      <Button
        variant="secondary"
        onPress={() => {
          onSelect(null);
          onClose();
        }}
      >
        Clear date
      </Button>
    </Sheet>
  );
}

function makeStyles(colors: Colors, scale: number) {
  return StyleSheet.create({
    header: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    monthLabel: {
      fontFamily: fonts.display,
      fontSize: 18 * scale,
      color: colors.foreground,
    },
    week: { flexDirection: "row" },
    weekday: {
      width: `${100 / 7}%`,
      textAlign: "center",
      fontFamily: fonts.baseSemi,
      fontSize: 12 * scale,
      color: colors.mutedForeground,
    },
    grid: { flexDirection: "row", flexWrap: "wrap" },
    // A row of seven, each a comfortable target rather than a dense grid.
    cell: {
      width: `${100 / 7}%`,
      aspectRatio: 1,
      alignItems: "center",
      justifyContent: "center",
    },
    day: {
      minWidth: 40,
      minHeight: 40,
      borderRadius: radius.full,
      alignItems: "center",
      justifyContent: "center",
    },
    dayToday: { borderWidth: 1, borderColor: colors.primary },
    daySelected: { backgroundColor: colors.primary },
    dayText: {
      fontFamily: fonts.base,
      fontSize: 16 * scale,
      color: colors.foreground,
    },
    dayTextSelected: {
      color: colors.primaryForeground,
      fontFamily: fonts.baseSemi,
    },
  });
}
