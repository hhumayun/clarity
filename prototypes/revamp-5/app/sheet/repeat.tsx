import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useState } from "react";
import { StyleSheet, View } from "react-native";
import { dayChoices, dayLabel, type Day } from "../../src/lib/dates";
import { useTask } from "../../src/data/hooks";
import type { Repeat } from "../../src/store/model";
import { useSage } from "../../src/data/sage";
import { useTheme } from "../../src/theme/ThemeProvider";
import { space } from "../../src/theme/tokens";
import { Icon } from "../../src/ui/Icon";
import { ChoiceChips, SheetButtons, SheetFrame, SheetLabel, SheetList, SheetRow } from "../../src/ui/Sheet";
import { Txt } from "../../src/ui/Txt";

const CHOICES: { label: string; value: Repeat | null }[] = [
  { label: "Never", value: null },
  { label: "Every day", value: "daily" },
  { label: "Every weekday", value: "weekdays" },
  { label: "Every week", value: "weekly" },
  { label: "Every month", value: "monthly" },
];
const sentence: Record<Repeat, string> = { daily: "the next day", weekdays: "the next weekday", weekly: "a week later", monthly: "a month later" };

/**
 * How a task repeats, on its own: ticked off, it comes back on its next day.
 * A reminder is separate (the Reminder sheet), and can go off each time it
 * repeats or just this once.
 */
export default function RepeatSheet() {
  const { task: taskId } = useLocalSearchParams<{ task: string }>();
  const router = useRouter();
  const { colors } = useTheme();
  const task = useTask(taskId);
  const updateTask = useSage((state) => state.updateTask);
  const [day, setDay] = useState<Day | null>(task?.day ?? null);
  const [repeat, setRepeat] = useState<Repeat | null>(task?.repeat ?? null);

  if (!task) return <SheetFrame title="Repeat" description="This task could not be found." />;

  if (!day) {
    return (
      <SheetFrame title="Repeat" description="A repeat counts on from the task's day, so it needs one first.">
        <SheetLabel icon="calendar" title="Choose a day" />
        <ChoiceChips choices={dayChoices().filter((c) => c.day).map((c) => ({ label: c.label, value: c.day as Day }))} onChoose={setDay} />
      </SheetFrame>
    );
  }

  const words = repeat ? `Each time it's ticked off, it comes back ${sentence[repeat]}. Its first day is ${dayLabel(day).toLowerCase() === "today" || dayLabel(day).toLowerCase() === "tomorrow" ? dayLabel(day).toLowerCase() : dayLabel(day)}.` : "It doesn't repeat.";

  const set = () => {
    // A reminder for this time only means nothing on a task that doesn't repeat.
    updateTask(task.id, repeat ? { day, repeat } : { repeat: null, remindOnce: false });
    router.back();
  };
  const clear = () => {
    updateTask(task.id, { repeat: null, remindOnce: false });
    router.back();
  };

  return (
    <SheetFrame title="Repeat" description={task.title}>
      <SheetList>
        {CHOICES.map((choice) => (
          <SheetRow key={choice.label} label={choice.label} role="radio" selected={repeat === choice.value} onPress={() => setRepeat(choice.value)} />
        ))}
      </SheetList>
      <View style={styles.sentence}>
        <View style={styles.icon}>
          <Icon name="repeat" size={18} color={colors.ink3} weight="medium" />
        </View>
        <Txt variant="callout" tone="ink2" style={styles.sentenceText}>
          {words}
        </Txt>
      </View>
      <SheetButtons primary={{ label: repeat ? "Set repeat" : "Done", onPress: set }} secondary={task.repeat ? { label: "Don't repeat", onPress: clear } : undefined} />
    </SheetFrame>
  );
}

const styles = StyleSheet.create({
  sentence: { flexDirection: "row", alignItems: "flex-start", gap: space[3] },
  icon: { paddingTop: 2 },
  sentenceText: { flex: 1 },
});
