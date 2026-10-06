import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useState } from "react";
import { StyleSheet, View } from "react-native";
import { dateOf, dayChoices, dayLabel, type Day } from "../../src/lib/dates";
import { useTask } from "../../src/data/hooks";
import type { Repeat } from "../../src/store/model";
import { clockLabel } from "../../src/store/selectors";
import { useSage } from "../../src/data/sage";
import { useTheme } from "../../src/theme/ThemeProvider";
import { space } from "../../src/theme/tokens";
import { Icon } from "../../src/ui/Icon";
import { ChoiceChips, SheetButtons, SheetFrame, SheetLabel, SheetList, SheetRow, TextField } from "../../src/ui/Sheet";
import { Txt } from "../../src/ui/Txt";

type Unit = "minutes" | "hours" | "days" | "weeks";
const UNIT_MINUTES: Record<Unit, number> = { minutes: 1, hours: 60, days: 1_440, weeks: 10_080 };
const repeatSentence: Record<Repeat, string> = { daily: "every day", weekdays: "every weekday", weekly: "every week", monthly: "every month" };

/**
 * A reminder counts back from the task's time (or 9:00 on its day); the
 * sentence at the end says when it will go off. How the task repeats is its
 * own sheet: here, a repeating task's reminder goes off each time, or just
 * this once.
 */
export default function ReminderSheet() {
  const { task: taskId } = useLocalSearchParams<{ task: string }>();
  const router = useRouter();
  const { colors } = useTheme();
  const task = useTask(taskId);
  const updateTask = useSage((state) => state.updateTask);
  const [day, setDay] = useState<Day | null>(task?.day ?? null);
  const hasTime = task?.time != null;
  const presets = hasTime
    ? [
        { label: "At the time", value: 0 },
        { label: "15 minutes before", value: 15 },
        { label: "30 minutes before", value: 30 },
        { label: "1 day before", value: 1_440 },
      ]
    : [
        { label: "On the day (9:00 am)", value: 0 },
        { label: "1 day before (9:00 am)", value: 1_440 },
      ];
  const initial = task?.remind ?? null;
  const isPreset = initial === null || presets.some((preset) => preset.value === initial);
  const [choice, setChoice] = useState<number | "custom">(isPreset ? (initial ?? presets[0].value) : "custom");
  const units: Unit[] = hasTime ? ["minutes", "hours", "days"] : ["days", "weeks"];
  const [unit, setUnit] = useState<Unit>(units[0]);
  const [amount, setAmount] = useState(isPreset || initial === null ? "" : String(initial / UNIT_MINUTES[units[0]]));
  const [once, setOnce] = useState(task?.remindOnce ?? false);

  if (!task) return <SheetFrame title="Reminder" description="This task could not be found." />;

  if (!day) {
    return (
      <SheetFrame title="Reminder" description="A reminder counts back from the task's day, so it needs one first.">
        <SheetLabel icon="calendar" title="Choose a day" />
        <ChoiceChips choices={dayChoices().filter((c) => c.day).map((c) => ({ label: c.label, value: c.day as Day }))} onChoose={setDay} />
      </SheetFrame>
    );
  }

  const minutesBefore = choice === "custom" ? (amount ? Number(amount) * UNIT_MINUTES[unit] : null) : choice;
  const when = (() => {
    if (minutesBefore === null) return null;
    const at = dateOf(day);
    at.setMinutes((task.time ?? 9 * 60) - minutesBefore);
    return at;
  })();
  const sentence = (() => {
    if (!when) return "How long before?";
    const every = !!task.repeat && !once;
    if (when.getTime() < Date.now() && !every) return "That time has already passed, so it will not go off.";
    const whenDay = `${when.getFullYear()}-${String(when.getMonth() + 1).padStart(2, "0")}-${String(when.getDate()).padStart(2, "0")}`;
    const label = dayLabel(whenDay);
    const prefix = label === "Today" || label === "Tomorrow" || label === "Yesterday" ? label.toLowerCase() : `on ${label}`;
    const base = `Reminds you ${prefix} at ${clockLabel(when.getHours() * 60 + when.getMinutes())}`;
    if (task.repeat && once) return `${base}, this time only.`;
    return task.repeat ? `${base}, then each time it repeats (${repeatSentence[task.repeat]}).` : `${base}.`;
  })();

  const set = () => {
    if (minutesBefore === null) return;
    updateTask(task.id, { day, remind: minutesBefore, remindOnce: task.repeat ? once : false });
    router.back();
  };
  const clear = () => {
    // The reminder only: how the task repeats stays as it is.
    updateTask(task.id, { remind: null, remindOnce: false });
    router.back();
  };

  return (
    <SheetFrame title="Reminder" description={task.title} scroll>
      <SheetList>
        {presets.map((preset) => (
          <SheetRow key={preset.label} label={preset.label} role="radio" selected={choice === preset.value} onPress={() => setChoice(preset.value)} />
        ))}
        <SheetRow key="custom" label="Custom" role="radio" selected={choice === "custom"} onPress={() => setChoice("custom")} />
      </SheetList>
      {choice === "custom" ? (
        <View style={styles.custom}>
          <TextField
            variant="title3"
            value={amount}
            onChangeText={(text) => setAmount(text.replace(/[^0-9]/g, "").slice(0, 3))}
            keyboardType="number-pad"
            placeholder="2"
            style={styles.amount}
            accessibilityLabel="How many"
          />
          <ChoiceChips choices={units.map((u) => ({ label: u, value: u }))} selected={(u) => u === unit} onChoose={setUnit} style={styles.units} />
          <Txt variant="subhead" tone="ink2">
            before
          </Txt>
        </View>
      ) : null}
      {task.repeat ? (
        <View style={styles.block}>
          <SheetLabel icon="repeat" title={`It repeats ${repeatSentence[task.repeat]}. Remind me`} />
          <ChoiceChips
            choices={[
              { label: "Every time", value: false },
              { label: "Just this time", value: true },
            ]}
            selected={(value) => value === once}
            onChoose={setOnce}
          />
        </View>
      ) : null}
      <View style={styles.sentence}>
        <View style={styles.bell}>
          <Icon name="bell" size={18} color={colors.ink3} weight="medium" />
        </View>
        <Txt variant="callout" tone="ink2" style={styles.sentenceText}>
          {sentence}
        </Txt>
      </View>
      <Txt variant="footnote" tone="ink3">
        This prototype doesn't send notifications.
      </Txt>
      <SheetButtons primary={{ label: "Set reminder", onPress: set, disabled: minutesBefore === null }} secondary={task.remind !== null ? { label: "No reminder", onPress: clear } : undefined} />
    </SheetFrame>
  );
}

const styles = StyleSheet.create({
  custom: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: space[2] },
  amount: { width: 72, paddingHorizontal: 0, textAlign: "center" },
  units: { flexWrap: "nowrap" },
  block: { gap: space[3] },
  sentence: { flexDirection: "row", alignItems: "flex-start", gap: space[3] },
  bell: { paddingTop: 2 },
  sentenceText: { flex: 1 },
});
