import { useRouter } from "expo-router";
import { CalendarDays, Check, X } from "lucide-react-native";
import React, { useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import Animated, { FadeIn, FadeInRight, FadeOutLeft } from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTasks } from "../../src/hooks/useTasks";
import { daysFromToday, formatPlannedDateLong, nextWeekend } from "../../src/lib/dates";
import { areaColor, overdueQueue } from "../../src/lib/lifeCenter";
import { hapticDone } from "../../src/lib/haptics";
import { recordMovedFrom } from "../../src/lib/movedFrom";
import { useAppTheme } from "../../src/providers/AppThemeProvider";
import { useToast } from "../../src/providers/ToastProvider";
import { radius, spacing, type Colors, type Fonts } from "../../src/theme";
import type { TaskRecord } from "../../src/types";
import { Button } from "../../src/ui/Button";
import { SegmentBar } from "../../src/ui/SegmentBar";
import { Skeleton } from "../../src/ui/Skeleton";

type Outcome = "today" | "moved" | "letGo" | "skipped";

/**
 * Catch up: the overdue tasks one at a time, each with three calm choices.
 * The queue is fixed when the screen opens, so acting on a task never makes
 * the count jump or reshuffle what is still to come.
 */
export default function CatchUpScreen() {
  const router = useRouter();
  const toast = useToast();
  const { colors, fonts, scale, dark } = useAppTheme();
  const styles = useMemo(() => makeStyles(colors, scale, fonts), [colors, scale, fonts]);
  const { query, update } = useTasks();

  const [queue, setQueue] = useState<string[] | null>(null);
  const [index, setIndex] = useState(0);
  const [outcomes, setOutcomes] = useState<Outcome[]>([]);

  const tasks = query.data?.tasks;
  if (queue === null && tasks) {
    // Set during render, once: the first time the list is known.
    setQueue(overdueQueue(tasks).map((task) => task.id));
  }

  const byId = useMemo(() => new Map((tasks ?? []).map((task) => [task.id, task])), [tasks]);
  const total = queue?.length ?? 0;
  const currentId = queue?.[index];
  const current: TaskRecord | undefined = currentId ? byId.get(currentId) : undefined;
  const finished = queue !== null && index >= total;

  const close = () => {
    if (router.canGoBack()) router.back();
    else router.replace("/life-center");
  };

  const advance = (outcome: Outcome) => {
    setOutcomes((prev) => [...prev, outcome]);
    setIndex((i) => i + 1);
  };

  const reschedule = (task: TaskRecord, date: Date, outcome: Outcome) => {
    recordMovedFrom(task.id, task.completeBy);
    update.mutate(
      { id: task.id, completeBy: date },
      { onError: () => toast.show("That change could not be saved. Please try again.") },
    );
    advance(outcome);
  };

  const letGo = (task: TaskRecord) => {
    hapticDone();
    update.mutate(
      { id: task.id, status: "done" },
      { onError: () => toast.show("That change could not be saved. Please try again.") },
    );
    advance("letGo");
  };

  // A task deleted elsewhere while this was open: step past it quietly.
  if (queue !== null && !finished && currentId && tasks && !current) {
    setIndex((i) => i + 1);
  }

  return (
    <SafeAreaView style={styles.page} edges={["top", "bottom"]}>
      <View style={styles.header}>
        <Pressable onPress={close} style={styles.close} accessibilityLabel="Close catch up">
          <X size={20} color={colors.foreground} />
        </Pressable>
        <Text style={styles.headerTitle}>Catch up</Text>
        <Text style={styles.count}>
          {!finished && total > 0 ? `${Math.min(index + 1, total)} of ${total}` : ""}
        </Text>
      </View>
      {total > 0 ? (
        <View style={styles.progress}>
          <SegmentBar
            total={total}
            filled={finished ? total : index + 1}
            accessibilityLabel={`Task ${Math.min(index + 1, total)} of ${total}`}
          />
        </View>
      ) : null}

      {queue === null ? (
        <View style={styles.body}>
          <Skeleton style={styles.skeleton} />
        </View>
      ) : finished ? (
        <Summary outcomes={outcomes} total={total} onDone={close} styles={styles} colors={colors} />
      ) : current ? (
        <ScrollView contentContainerStyle={styles.body} bounces={false}>
          <View style={styles.spacer} />
          <Animated.View
            key={current.id}
            entering={FadeInRight.duration(240)}
            exiting={FadeOutLeft.duration(180)}
            style={styles.card}
          >
            <View style={styles.area}>
              <View style={[styles.dot, { backgroundColor: areaColor(current.projectId, dark) }]} />
              <Text style={styles.areaText}>{current.projectName}</Text>
            </View>
            <Text style={styles.taskTitle}>{current.text}</Text>
            {current.completeBy ? (
              <View style={styles.planned}>
                <CalendarDays size={16} color={colors.mutedForeground} />
                <Text style={styles.plannedText}>
                  Planned for {formatPlannedDateLong(current.completeBy)}
                </Text>
              </View>
            ) : null}
          </Animated.View>

          <Text style={styles.prompt}>What would you like to do?</Text>

          <Pressable
            style={({ pressed }) => [styles.primary, pressed && styles.pressed]}
            onPress={() => reschedule(current, daysFromToday(0), "today")}
            accessibilityRole="button"
          >
            <Check size={20} color={colors.primaryForeground} strokeWidth={2.5} />
            <Text style={styles.primaryText}>Do it today</Text>
          </Pressable>

          <View style={styles.pickBox}>
            <Text style={styles.pickTitle}>Pick another day</Text>
            <View style={styles.pickRow}>
              {[
                { label: "Tomorrow", date: () => daysFromToday(1) },
                { label: "Weekend", date: () => nextWeekend() },
                { label: "Next week", date: () => daysFromToday(7) },
              ].map((option) => (
                <Pressable
                  key={option.label}
                  style={({ pressed }) => [styles.pick, pressed && styles.pressed]}
                  onPress={() => reschedule(current, option.date(), "moved")}
                  accessibilityRole="button"
                >
                  <Text style={styles.pickText}>{option.label}</Text>
                </Pressable>
              ))}
            </View>
          </View>

          <Pressable
            style={({ pressed }) => [styles.letGo, pressed && styles.pressed]}
            onPress={() => letGo(current)}
            accessibilityRole="button"
            accessibilityHint="Marks the task done. You can bring it back from Done."
          >
            <Text style={styles.letGoText}>Let it go</Text>
            <Text style={styles.letGoHint}>You can bring it back from Done</Text>
          </Pressable>

          <Pressable onPress={() => advance("skipped")} style={styles.skip} accessibilityRole="button">
            <Text style={styles.skipText}>Skip for now</Text>
          </Pressable>
        </ScrollView>
      ) : null}
    </SafeAreaView>
  );
}

function Summary({
  outcomes,
  total,
  onDone,
  styles,
  colors,
}: {
  outcomes: Outcome[];
  total: number;
  onDone: () => void;
  styles: ReturnType<typeof makeStyles>;
  colors: Colors;
}) {
  const count = (kind: Outcome) => outcomes.filter((o) => o === kind).length;
  const lines = [
    { n: count("today"), text: (n: number) => `${n} moved to today` },
    { n: count("moved"), text: (n: number) => `${n} moved to another day` },
    { n: count("letGo"), text: (n: number) => `${n} let go` },
    { n: count("skipped"), text: (n: number) => `${n} left for later` },
  ].filter((line) => line.n > 0);

  return (
    <Animated.View entering={FadeIn.duration(260)} style={styles.summary}>
      <View style={styles.doneCircle}>
        <Check size={34} color={colors.primaryForeground} strokeWidth={3} />
      </View>
      <Text style={styles.summaryTitle}>All caught up</Text>
      <Text style={styles.summaryLead}>
        {total === 0
          ? "Nothing has slipped past its date."
          : `You sorted ${total === 1 ? "the one task" : `all ${total} tasks`} that had slipped.`}
      </Text>
      {lines.length > 0 ? (
        <View style={styles.summaryList}>
          {lines.map((line) => (
            <Text key={line.text(line.n)} style={styles.summaryLine}>
              {line.text(line.n)}
            </Text>
          ))}
        </View>
      ) : null}
      <Button size="lg" onPress={onDone} style={styles.summaryButton}>
        Back to Life Center
      </Button>
    </Animated.View>
  );
}

function makeStyles(colors: Colors, scale: number, fonts: Fonts) {
  return StyleSheet.create({
    page: { flex: 1, backgroundColor: colors.background },
    header: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: spacing[4],
      paddingTop: spacing[2],
    },
    close: {
      width: 44,
      height: 44,
      borderRadius: 22,
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: "center",
      justifyContent: "center",
    },
    headerTitle: { fontFamily: fonts.baseBold, fontSize: 17 * scale, color: colors.foreground },
    count: {
      width: 44,
      textAlign: "right",
      fontFamily: fonts.base,
      fontSize: 15 * scale,
      color: colors.mutedForeground,
    },
    progress: { paddingHorizontal: spacing[4], paddingTop: spacing[3] },
    body: { flexGrow: 1, padding: spacing[4], gap: spacing[4] },
    spacer: { flexGrow: 1, minHeight: spacing[8] },
    skeleton: { height: 160, borderRadius: radius.lg },
    card: {
      backgroundColor: colors.card,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.border,
      padding: spacing[6],
      gap: spacing[3],
    },
    area: { flexDirection: "row", alignItems: "center", gap: spacing[2] },
    dot: { width: 8, height: 8, borderRadius: 4 },
    areaText: { fontFamily: fonts.base, fontSize: 14 * scale, color: colors.mutedForeground },
    taskTitle: { fontFamily: fonts.display, fontSize: 28 * scale, color: colors.foreground },
    planned: { flexDirection: "row", alignItems: "center", gap: spacing[2] },
    plannedText: { fontFamily: fonts.base, fontSize: 15 * scale, color: colors.mutedForeground },
    prompt: { fontFamily: fonts.base, fontSize: 16 * scale, color: colors.mutedForeground },
    primary: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: spacing[2],
      minHeight: 58,
      borderRadius: radius.md,
      backgroundColor: colors.primary,
    },
    primaryText: { fontFamily: fonts.baseBold, fontSize: 18 * scale, color: colors.primaryForeground },
    pressed: { opacity: 0.8 },
    pickBox: {
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      padding: spacing[4],
      gap: spacing[3],
    },
    pickTitle: { fontFamily: fonts.baseSemi, fontSize: 16 * scale, color: colors.foreground },
    pickRow: { flexDirection: "row", gap: spacing[2] },
    pick: {
      flex: 1,
      minHeight: 46,
      borderRadius: radius.sm,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
      alignItems: "center",
      justifyContent: "center",
    },
    pickText: { fontFamily: fonts.base, fontSize: 15 * scale, color: colors.foreground },
    letGo: { alignItems: "center", paddingVertical: spacing[2], gap: 2 },
    letGoText: { fontFamily: fonts.baseSemi, fontSize: 16 * scale, color: colors.foreground },
    letGoHint: { fontFamily: fonts.base, fontSize: 13 * scale, color: colors.mutedForeground },
    skip: { alignItems: "center", paddingVertical: spacing[3] },
    skipText: {
      fontFamily: fonts.base,
      fontSize: 15 * scale,
      color: colors.mutedForeground,
      textDecorationLine: "underline",
    },
    summary: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      padding: spacing[6],
      gap: spacing[3],
    },
    doneCircle: {
      width: 76,
      height: 76,
      borderRadius: 38,
      backgroundColor: colors.primary,
      alignItems: "center",
      justifyContent: "center",
      marginBottom: spacing[2],
    },
    summaryTitle: { fontFamily: fonts.display, fontSize: 30 * scale, color: colors.foreground },
    summaryLead: {
      fontFamily: fonts.base,
      fontSize: 16 * scale,
      color: colors.mutedForeground,
      textAlign: "center",
    },
    summaryList: { alignItems: "center", gap: 4, marginTop: spacing[2] },
    summaryLine: { fontFamily: fonts.base, fontSize: 16 * scale, color: colors.foreground },
    summaryButton: { alignSelf: "stretch", marginTop: spacing[6] },
  });
}
