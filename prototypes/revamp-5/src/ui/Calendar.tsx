import DateTimePicker, { DateTimePickerAndroid } from "@react-native-community/datetimepicker";
import React from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { dateOf, dayOf, type Day } from "../lib/dates";
import { clockLabel } from "../store/selectors";
import { useTheme } from "../theme/ThemeProvider";
import { radius, space } from "../theme/tokens";
import { Icon } from "./Icon";
import { Txt } from "./Txt";

/**
 * The system's own calendar: inline on the iPhone, the system dialog on
 * Android. (The web preview has no picker; the day chips cover it.)
 */
export function InlineCalendar({ value, onChange }: { value: Day | null; onChange: (day: Day) => void }) {
  const { colors, dark, accent } = useTheme();
  const date = value ? dateOf(value) : new Date();
  if (process.env.EXPO_OS === "android") {
    return (
      <Pressable
        onPress={() => DateTimePickerAndroid.open({ value: date, mode: "date", onChange: (event, picked) => event.type === "set" && picked && onChange(dayOf(picked)) })}
        accessibilityRole="button"
        style={[styles.pick, { backgroundColor: colors.sunken }]}
      >
        <Icon name="calendar" size={16} color={colors.ink2} />
        <Txt variant="subhead" tone="ink2" weight="semibold">
          Pick a date
        </Txt>
      </Pressable>
    );
  }
  if (process.env.EXPO_OS !== "ios") return null;
  return (
    <View style={[styles.calendar, { backgroundColor: colors.card, borderColor: colors.hairline }]}>
      <DateTimePicker
        value={date}
        mode="date"
        display="inline"
        accentColor={accent.solid}
        themeVariant={dark ? "dark" : "light"}
        onChange={(_, picked) => picked && onChange(dayOf(picked))}
      />
    </View>
  );
}

/** A time, five minutes at a time: the spinner on the iPhone, the clock dialog on Android. */
export function TimeSpinner({ value, onChange }: { value: number; onChange: (minutes: number) => void }) {
  const { colors, dark, accent } = useTheme();
  const date = new Date();
  date.setHours(Math.floor(value / 60), value % 60, 0, 0);
  const pick = (picked?: Date) => picked && onChange(picked.getHours() * 60 + picked.getMinutes());
  if (process.env.EXPO_OS === "ios") {
    return (
      <DateTimePicker
        value={date}
        mode="time"
        display="spinner"
        minuteInterval={5}
        themeVariant={dark ? "dark" : "light"}
        textColor={colors.ink}
        onChange={(_, picked) => pick(picked)}
        style={styles.spinner}
      />
    );
  }
  return (
    <Pressable
      onPress={() => process.env.EXPO_OS === "android" && DateTimePickerAndroid.open({ value: date, mode: "time", onChange: (event, picked) => event.type === "set" && pick(picked) })}
      accessibilityRole="button"
      style={[styles.bigTime, { backgroundColor: colors.sunken }]}
    >
      <Txt variant="title1">{clockLabel(value)}</Txt>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  calendar: { borderRadius: radius.card, borderCurve: "continuous", borderWidth: StyleSheet.hairlineWidth, overflow: "hidden", paddingHorizontal: space[2] },
  pick: { flexDirection: "row", alignItems: "center", gap: space[2], height: 44, paddingHorizontal: space[4], borderRadius: radius.pill, alignSelf: "flex-start" },
  spinner: { alignSelf: "stretch" },
  bigTime: { height: 72, borderRadius: radius.card, borderCurve: "continuous", alignItems: "center", justifyContent: "center" },
});

/** A time as a small pill that opens the system's picker (iPhone); a plain label elsewhere. */
export function CompactTime({ value, onChange }: { value: number; onChange: (minutes: number) => void }) {
  const { colors, dark, accent } = useTheme();
  const date = new Date();
  date.setHours(Math.floor(value / 60), value % 60, 0, 0);
  if (process.env.EXPO_OS === "ios") {
    return (
      <DateTimePicker
        value={date}
        mode="time"
        display="compact"
        minuteInterval={5}
        accentColor={accent.solid}
        themeVariant={dark ? "dark" : "light"}
        onChange={(_, picked) => picked && onChange(picked.getHours() * 60 + picked.getMinutes())}
      />
    );
  }
  return (
    <Pressable
      onPress={() =>
        process.env.EXPO_OS === "android" &&
        DateTimePickerAndroid.open({ value: date, mode: "time", onChange: (event, picked) => event.type === "set" && picked && onChange(picked.getHours() * 60 + picked.getMinutes()) })
      }
      accessibilityRole="button"
      style={[styles.pick, { backgroundColor: colors.sunken }]}
    >
      <Txt variant="subhead" tone="ink2" weight="semibold">
        {clockLabel(value)}
      </Txt>
    </Pressable>
  );
}
