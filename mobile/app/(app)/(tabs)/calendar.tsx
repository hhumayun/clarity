import { useQueryClient } from "@tanstack/react-query";
import { useFocusEffect, useRouter } from "expo-router";
import { ChevronLeft, ChevronRight } from "lucide-react-native";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";
import { TASKS_ENABLED } from "../../../src/featureFlags";
import { useAfterExit } from "../../../src/hooks/useAfterExit";
import { NOTES_QUERY_KEY, prefetchNotes, useNotes } from "../../../src/hooks/useNotes";
import { TASKS_QUERY_KEY, useTasks } from "../../../src/hooks/useTasks";
import { atNoon, dateChipLabel, isSameDay } from "../../../src/lib/dates";
import { dayKey, monthGrid, monthTitle, notesOnDay, stripRange } from "../../../src/lib/notesList";
import { taskCountByNote } from "../../../src/lib/taskSort";
import { useAppTheme } from "../../../src/providers/AppThemeProvider";
import { useToast } from "../../../src/providers/ToastProvider";
import { fonts, spacing, textSize, type Colors } from "../../../src/theme";
import type { NoteRecord, TaskRecord, TaskStatus } from "../../../src/types";
import { DayTasks } from "../../../src/ui/DayTasks";
import { MonthGrid, type DayMarks } from "../../../src/ui/MonthGrid";
import { EASE_IN, EASE_OUT, MOTION } from "../../../src/ui/motion";
import { NoteCard } from "../../../src/ui/NoteCard";
import { QuickAddTask, type QuickAddDraft } from "../../../src/ui/QuickAddTask";
import { SyncBar } from "../../../src/ui/SyncBar";
import { TASK_ADDED_MS, TaskAddedOverlay } from "../../../src/ui/TaskAddedOverlay";
import { TaskMenu } from "../../../src/ui/TaskMenu";

// A month as one number (year × 12 + month), so it can cross to and from the
// animation thread, which cannot carry a Date.
const monthIndexOf = (date: Date) => date.getFullYear() * 12 + date.getMonth();
const monthStart = (index: number) => new Date(Math.floor(index / 12), index % 12, 1);
const startOfDay = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());

const SLIDE_OUT_MS = 140;
const SLIDE_IN_MS = 240;
const DAY_OUT_MS = 110;
// How far, or how fast, a sideways swipe must go to change the month.
const SWIPE_DISTANCE = 48;
const SWIPE_SPEED = 600;

/**
 * The Calendar: a month of days marked with the notes written and the tasks
 * due on them, and the chosen day's notes and tasks below. Swipe the month,
 * or use the arrows, to move between months.
 */
export default function CalendarScreen() {
  const router = useRouter();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { colors, scale } = useAppTheme();
  const styles = useMemo(() => makeStyles(colors, scale), [colors, scale]);
  const { width } = useWindowDimensions();

  const [month, setMonth] = useState(() => monthIndexOf(new Date()));
  const [selected, setSelected] = useState(() => startOfDay(new Date()));
  const shownMonth = useMemo(() => monthStart(month), [month]);

  // The month's six weeks of notes, asked for by date like the Notes screen's
  // week. While a new month loads, the last one's notes are held as a
  // placeholder; they must not mark the new days.
  const range = useMemo(() => stripRange(monthGrid(shownMonth)), [shownMonth]);
  const notesQuery = useNotes(range);
  const notes = useMemo(
    () => (notesQuery.isPlaceholderData ? [] : (notesQuery.data?.notes ?? [])),
    [notesQuery.isPlaceholderData, notesQuery.data],
  );
  // The months either side are fetched ahead, so moving to one is instant.
  const monthLoaded = Boolean(notesQuery.data) && !notesQuery.isPlaceholderData;
  useEffect(() => {
    if (!monthLoaded) return;
    for (const delta of [-1, 1]) void prefetchNotes(queryClient, stripRange(monthGrid(monthStart(month + delta))));
  }, [month, monthLoaded, queryClient]);

  const tasks = useTasks(undefined, TASKS_ENABLED);
  const allTasks = useMemo(() => (TASKS_ENABLED ? (tasks.query.data?.tasks ?? []) : []), [tasks.query.data?.tasks]);
  const projectNames = useMemo(
    () => new Map((tasks.query.data?.projects ?? []).map((project) => [project.id, project.name])),
    [tasks.query.data?.projects],
  );
  const counts = useMemo(() => taskCountByNote(allTasks), [allTasks]);

  // Each day's marks, built once per change to the notes or tasks.
  const marks = useMemo(() => {
    const byDay = new Map<string, DayMarks>();
    const mark = (date: Date, kind: keyof DayMarks) => {
      const key = dayKey(date);
      const marked = byDay.get(key) ?? { notes: false, tasks: false };
      marked[kind] = true;
      byDay.set(key, marked);
    };
    for (const note of notes) mark(note.createdAt, "notes");
    for (const task of allTasks) if (task.completeBy && task.status !== "done") mark(task.completeBy, "tasks");
    return byDay;
  }, [notes, allTasks]);

  const dayNotes = useMemo(() => notesOnDay(notes, selected), [notes, selected]);
  // The day's tasks: the ones due that day, finished ones included.
  const dayTasks = useMemo(
    () => allTasks.filter((task) => task.completeBy !== null && isSameDay(task.completeBy, selected)),
    [allTasks, selected],
  );

  // Changing month slides the grid sideways (a later month comes in from the
  // right), while the day below fades out and comes back once the new
  // month's notes are here. Changing day within the month only fades the day.
  const slideX = useSharedValue(0);
  const slideStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: slideX.value }],
    opacity: 1 - 0.8 * Math.min(1, Math.abs(slideX.value) / 160),
  }));
  const dayReveal = useSharedValue(1);
  const dayStyle = useAnimatedStyle(() => ({
    opacity: dayReveal.value,
    transform: [{ translateY: (1 - dayReveal.value) * 10 }],
  }));
  // Where the grid is heading: a second quick tap or swipe counts from there.
  const target = useRef(month);
  const awaitingReveal = useRef(false);
  const revealDay = useRef(false);
  const [pendingDay, setPendingDay] = useState<Date | null>(null);
  const shownDay = pendingDay ?? selected;

  const commitMonth = (index: number, dir: number, dayMs: number) => {
    awaitingReveal.current = true;
    setMonth(index);
    setSelected(new Date(dayMs));
    setPendingDay(null);
    slideX.value = -dir * width * 0.4;
    slideX.value = withTiming(0, { duration: SLIDE_IN_MS, easing: EASE_OUT });
  };
  const changeMonth = (delta: number, day?: Date) => {
    if (delta === 0) return;
    const next = target.current + delta;
    target.current = next;
    const today = startOfDay(new Date());
    // The new month opens on the given day, today if it is this month, or its 1st.
    const dayMs = (day ?? (next === monthIndexOf(today) ? today : monthStart(next))).getTime();
    const dir = delta > 0 ? -1 : 1;
    // A faint day tapped in this grid shows as chosen while it slides away;
    // the arrows and swipes leave the choice where it is until then.
    setPendingDay(day ?? null);
    // Also stops a day change still fading, so it cannot land after this.
    dayReveal.value = withTiming(0, { duration: MOTION.fast, easing: EASE_IN });
    slideX.value = withTiming(dir * width * 0.4, { duration: SLIDE_OUT_MS, easing: EASE_IN }, (finished) => {
      if (finished) runOnJS(commitMonth)(next, dir, dayMs);
    });
  };

  const monthReady =
    notesQuery.isError || notesQuery.fetchStatus === "paused" || (Boolean(notesQuery.data) && !notesQuery.isPlaceholderData);
  useEffect(() => {
    if (!awaitingReveal.current || !monthReady) return;
    awaitingReveal.current = false;
    dayReveal.value = withTiming(1, { duration: MOTION.slow, easing: EASE_OUT });
  }, [monthReady, month, dayReveal]);

  // The animation thread hands the day back as a number.
  const commitDay = (dayMs: number) => {
    revealDay.current = true;
    setSelected(new Date(dayMs));
    setPendingDay(null);
  };
  const pickDay = (day: Date) => {
    const picked = startOfDay(day);
    // A faint day from the month either side takes you to its month.
    const index = monthIndexOf(picked);
    if (index !== target.current) {
      changeMonth(index - target.current, picked);
      return;
    }
    if (isSameDay(picked, shownDay)) return;
    setPendingDay(picked);
    const dayMs = picked.getTime();
    dayReveal.value = withTiming(0, { duration: DAY_OUT_MS, easing: EASE_IN }, (finished) => {
      if (finished) runOnJS(commitDay)(dayMs);
    });
  };
  useEffect(() => {
    if (!revealDay.current) return;
    revealDay.current = false;
    dayReveal.value = withTiming(1, { duration: MOTION.slow, easing: EASE_OUT });
  }, [selected, dayReveal]);

  // The gesture is built once; it calls whatever changeMonth is current.
  const changeMonthRef = useRef(changeMonth);
  changeMonthRef.current = changeMonth;
  const swipeMonth = useCallback((delta: number) => changeMonthRef.current(delta), []);
  const swipe = useMemo(
    () =>
      Gesture.Pan()
        // Only a sideways drag; an up-or-down one scrolls the page.
        .activeOffsetX([-16, 16])
        .failOffsetY([-12, 12])
        .onEnd((event) => {
          if (event.translationX < -SWIPE_DISTANCE || event.velocityX < -SWIPE_SPEED) runOnJS(swipeMonth)(1);
          else if (event.translationX > SWIPE_DISTANCE || event.velocityX > SWIPE_SPEED) runOnJS(swipeMonth)(-1);
        }),
    [swipeMonth],
  );

  const today = startOfDay(new Date());
  const showingToday = month === monthIndexOf(today) && isSameDay(shownDay, today);

  // Coming back to the tab: only what is out of date is fetched again.
  const firstFocus = useRef(true);
  useFocusEffect(
    useCallback(() => {
      if (firstFocus.current) {
        firstFocus.current = false;
        return;
      }
      void queryClient.refetchQueries({ queryKey: NOTES_QUERY_KEY, type: "active", stale: true });
      void queryClient.refetchQueries({ queryKey: TASKS_QUERY_KEY, type: "active", stale: true });
    }, [queryClient]),
  );

  // Tasks: the same as on the Notes screen's days.
  const [menuTask, setMenuTask] = useState<TaskRecord | null>(null);
  const afterMenu = useAfterExit();
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [added, setAdded] = useState<TaskRecord | null>(null);
  const addedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (addedTimer.current) clearTimeout(addedTimer.current);
    },
    [],
  );
  // The row has already played its own settle and haptic by the time this runs.
  const setTaskStatus = (task: TaskRecord, status: TaskStatus) => {
    tasks.update.mutate(
      { id: task.id, status },
      { onError: () => toast.show("That change could not be saved. Please try again.") },
    );
  };
  const addDayTask = async (draft: QuickAddDraft) => {
    const { task } = await tasks.create.mutateAsync({ ...draft, status: "todo" });
    setQuickAddOpen(false);
    setAdded(task);
    if (addedTimer.current) clearTimeout(addedTimer.current);
    addedTimer.current = setTimeout(() => setAdded(null), TASK_ADDED_MS);
    // A date typed into the line can send the task to another day: say where.
    if (!task.completeBy) toast.show("It has no date, so it is in Life Center.");
    else if (!isSameDay(task.completeBy, selected)) toast.show(`It is due ${dateChipLabel(task.completeBy)}.`);
  };
  const openNote = useCallback((note: NoteRecord) => router.push(`/note/${note.id}`), [router]);
  const upcoming = selected.getTime() >= today.getTime();

  return (
    <SafeAreaView style={styles.page} edges={["top"]}>
      <SyncBar />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.header}>
          <Text style={styles.title} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>
            {monthTitle(shownMonth)}
          </Text>
          {showingToday ? null : (
            <Pressable
              onPress={() => pickDay(today)}
              hitSlop={8}
              style={({ pressed }) => [styles.todayLink, pressed && styles.pressed]}
              accessibilityRole="button"
              accessibilityLabel="Go to today"
            >
              <Text style={styles.todayText}>Today</Text>
            </Pressable>
          )}
          <Pressable
            onPress={() => changeMonth(-1)}
            style={({ pressed }) => [styles.arrow, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel="Previous month"
          >
            <ChevronLeft size={22} color={colors.foreground} />
          </Pressable>
          <Pressable
            onPress={() => changeMonth(1)}
            style={({ pressed }) => [styles.arrow, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel="Next month"
          >
            <ChevronRight size={22} color={colors.foreground} />
          </Pressable>
        </View>

        <GestureDetector gesture={swipe}>
          <Animated.View style={slideStyle}>
            <MonthGrid month={shownMonth} selected={shownDay} marks={marks} onPick={pickDay} />
          </Animated.View>
        </GestureDetector>

        <Animated.View style={[styles.day, dayStyle]}>
          <Text style={styles.dayTitle}>{dateChipLabel(selected)}</Text>
          {dayNotes.length === 0 ? (
            <Text style={styles.noNotes}>{upcoming ? "No notes yet." : "No notes this day."}</Text>
          ) : (
            <View style={styles.notes}>
              {dayNotes.map((note) => (
                <NoteCard
                  key={note.id}
                  note={note}
                  taskCount={counts.get(note.id)}
                  projectNames={projectNames}
                  onOpen={openNote}
                />
              ))}
            </View>
          )}
          {TASKS_ENABLED ? (
            <DayTasks
              tasks={dayTasks}
              onStatusChange={setTaskStatus}
              onOpenMenu={setMenuTask}
              onAdd={() => setQuickAddOpen(true)}
              emptyText={upcoming ? "Nothing scheduled yet." : "Nothing was scheduled."}
            />
          ) : null}
        </Animated.View>
      </ScrollView>

      <TaskMenu
        task={menuTask}
        dueLabel={menuTask?.completeBy ? dateChipLabel(menuTask.completeBy) : "None"}
        onClose={() => setMenuTask(null)}
        onMove={(task, date) => {
          setMenuTask(null);
          tasks.update.mutate(
            { id: task.id, completeBy: date },
            {
              onSuccess: () => toast.show(date ? `Moved to ${dateChipLabel(date)}.` : "Date removed."),
              onError: () => toast.show("That task could not be moved. Please try again."),
            },
          );
        }}
        onFocus={(task) => {
          setMenuTask(null);
          router.push(`/focus/${task.id}`);
        }}
        onNotes={(task) => {
          setMenuTask(null);
          afterMenu.later(() => router.push(`/task/${task.id}`));
        }}
        onLinkNote={(task) => {
          setMenuTask(null);
          afterMenu.later(() => router.push(`/task/${task.id}?link=1`));
        }}
        onExited={afterMenu.run}
      />
      {TASKS_ENABLED ? (
        <QuickAddTask
          open={quickAddOpen}
          onClose={() => setQuickAddOpen(false)}
          projects={tasks.query.data?.projects ?? []}
          defaultProjectId={tasks.query.data?.projects[0]?.id ?? null}
          defaultDate={atNoon(selected.getFullYear(), selected.getMonth(), selected.getDate())}
          placeholder="e.g., Call Dr. Lee"
          onCreateProject={async (name) => (await tasks.createProject.mutateAsync({ name })).project}
          onSubmit={addDayTask}
        />
      ) : null}
      <TaskAddedOverlay visible={added !== null} projectName={added?.projectName ?? ""} />
    </SafeAreaView>
  );
}

function makeStyles(colors: Colors, scale: number) {
  return StyleSheet.create({
    page: { flex: 1, backgroundColor: colors.background },
    content: { padding: spacing[4], paddingBottom: spacing[8], gap: spacing[4] },
    pressed: { opacity: 0.6 },
    header: { flexDirection: "row", alignItems: "center", gap: spacing[1] },
    title: { flex: 1, fontFamily: fonts.display, fontSize: textSize.display * scale, color: colors.foreground },
    todayLink: { paddingHorizontal: spacing[2], paddingVertical: spacing[1] },
    todayText: { fontFamily: fonts.baseSemi, fontSize: textSize.small * scale, color: colors.primary },
    arrow: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
    day: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
      paddingTop: spacing[4],
      gap: spacing[3],
    },
    dayTitle: { fontFamily: fonts.display, fontSize: textSize.title * scale, color: colors.foreground },
    notes: { gap: spacing[2] },
    noNotes: { fontFamily: fonts.base, fontSize: textSize.small * scale, color: colors.mutedForeground },
  });
}
