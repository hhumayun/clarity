import { useQueryClient } from "@tanstack/react-query";
import { useFocusEffect, useRouter } from "expo-router";
import { ArrowRight, Plus, SlidersHorizontal, Timer } from "lucide-react-native";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { InteractionManager, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import Animated, {
  FadeInDown,
  FadeOutUp,
  LinearTransition,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { EASE_IN, EASE_OUT, MOTION } from "../../../src/ui/motion";
import { useFocusedMotion } from "../../../src/hooks/useFocusedMotion";
import { fadeInFast, fadeOut } from "../../../src/ui/motion";
import { RotatingChevron } from "../../../src/ui/RotatingChevron";
import { AreaMenu, AreaPill } from "../../../src/ui/AreaFilter";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusSummary } from "../../../src/hooks/useFocus";
import { useNotes } from "../../../src/hooks/useNotes";
import { useTasks } from "../../../src/hooks/useTasks";
import { linkedNoteIds } from "../../../src/lib/taskLinks";
import {
  daysFromToday,
  dateChipLabel,
  formatLongDate,
  formatWeekdayShort,
  isSameDay,
} from "../../../src/lib/dates";
import {
  greeting,
  groupAllTasks,
  slippedLabel,
  todayFocus,
} from "../../../src/lib/lifeCenter";
import { todayFocusLabel } from "../../../src/lib/focus";
import { useMovedFrom } from "../../../src/lib/movedFrom";
import { dueState } from "../../../src/lib/taskDates";
import { sortProjects } from "../../../src/lib/taskSort";
import { useAppTheme } from "../../../src/providers/AppThemeProvider";
import { useToast } from "../../../src/providers/ToastProvider";
import { fonts, radius, spacing, type Colors, textSize } from "../../../src/theme";
import type { ProjectRecord, TaskRecord, TaskStatus } from "../../../src/types";
import { Button } from "../../../src/ui/Button";
import { ConfirmModal } from "../../../src/ui/ConfirmModal";
import { ProjectSheet } from "../../../src/ui/ProjectSheet";
import { QuickAddTask, type QuickAddDraft } from "../../../src/ui/QuickAddTask";
import { Segmented } from "../../../src/ui/Segmented";
import { Skeleton } from "../../../src/ui/Skeleton";
import { TASK_ADDED_MS, TaskAddedOverlay } from "../../../src/ui/TaskAddedOverlay";
import { SyncBar } from "../../../src/ui/SyncBar";
import { TaskCard } from "../../../src/ui/TaskCard";
import { TaskQuickMenu } from "../../../src/ui/TaskQuickMenu";

type View_ = "today" | "all";

const VIEW_OUT_MS = 110;
// No enter, leave or layout animations: for building a whole list unseen.
const STILL = {
  enter: undefined,
  exit: undefined,
  layout: undefined,
  rowEnter: undefined,
  rowExit: undefined,
  rowLayout: undefined,
};
const ALL = "__all__";

export default function LifeCenterScreen() {
  const router = useRouter();
  const toast = useToast();
  const { colors, scale, dark } = useAppTheme();
  const styles = useMemo(() => makeStyles(colors, scale), [colors, scale]);
  const { query, create, update, clearDone, createProject, renameProject, deleteProject } = useTasks();
  const notes = useNotes({});
  const movedFrom = useMovedFrom();
  const focusSummary = useFocusSummary();
  const focusedMotion = useFocusedMotion();
  // Coming back to the tab: refresh what is out of date (changed elsewhere,
  // or marked so after a sync), and nothing else.
  const queryClientForFocus = useQueryClient();
  useFocusEffect(
    useCallback(() => {
      for (const key of [["tasks"], ["focus"]]) {
        void queryClientForFocus.refetchQueries({ queryKey: key, type: "active", stale: true });
      }
    }, [queryClientForFocus]),
  );

  // Today is the calm place to start; All tasks is one tap away.
  const [view, setView] = useState<View_>("today");
  // Switching between Today and All tasks. Both lists stay built once seen
  // (the other is built in the background soon after the screen opens), so a
  // switch only changes which one shows: the control moves at once, the list
  // fades out, the other is shown, and it fades in rising slightly. The hidden
  // list keeps its rows' own animations off.
  const [pendingView, setPendingView] = useState<View_ | null>(null);
  const [built, setBuilt] = useState<Record<View_, boolean>>({ today: true, all: false });
  const revealView = useRef(false);
  const viewReveal = useSharedValue(1);
  const viewRevealStyle = useAnimatedStyle(() => ({
    opacity: viewReveal.value,
    transform: [{ translateY: (1 - viewReveal.value) * 8 }],
  }));
  // Rows animate on Today (a short list) only. All tasks is the long one:
  // working out enter, leave and movement for every row on every change was
  // a large part of its lag.
  const motionFor = (which: View_) => (which === view && which === "today" ? focusedMotion : STILL);
  const allMotion = motionFor("all");
  const todayMotion = motionFor("today");
  useEffect(() => {
    const handle = InteractionManager.runAfterInteractions(() => setBuilt({ today: true, all: true }));
    return () => handle.cancel();
  }, []);
  const showView = (next: View_) => {
    scrollRef.current?.scrollTo({ y: 0, animated: false });
    revealView.current = true;
    setBuilt((current) => (current[next] ? current : { ...current, [next]: true }));
    setView(next);
    setPendingView(null);
  };
  const switchView = (next: View_) => {
    setAreaMenuOpen(false);
    if (next === (pendingView ?? view)) return;
    setPendingView(next);
    viewReveal.value = withTiming(0, { duration: VIEW_OUT_MS, easing: EASE_IN }, (finished) => {
      if (finished) runOnJS(showView)(next);
    });
  };
  useEffect(() => {
    if (!revealView.current) return;
    revealView.current = false;
    viewReveal.value = withTiming(1, { duration: MOTION.slow, easing: EASE_OUT });
  }, [view, viewReveal]);
  const [areaFilter, setAreaFilter] = useState<string>(ALL);
  const [areaMenuOpen, setAreaMenuOpen] = useState(false);
  const [showDone, setShowDone] = useState(false);
  // A task's press-and-hold menu; a tap opens the task itself.
  const [menuTask, setMenuTask] = useState<TaskRecord | null>(null);
  const [projectsOpen, setProjectsOpen] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  // After an add: the confirmation, then which card to scroll to and flash.
  const [added, setAdded] = useState<TaskRecord | null>(null);
  const [flash, setFlash] = useState<{ id: string; key: number } | null>(null);

  const scrollRef = useRef<ScrollView>(null);
  const scrollOffset = useRef(0);
  const cardRefs = useRef(new Map<string, View>());
  const revealTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (revealTimer.current) clearTimeout(revealTimer.current);
    },
    [],
  );


  const now = new Date();
  const projects = useMemo(() => sortProjects(query.data?.projects ?? []), [query.data?.projects]);
  const allTasks = useMemo(() => query.data?.tasks ?? [], [query.data?.tasks]);

  const loading = query.isFetching && !query.data;
  const activeArea: ProjectRecord | null =
    areaFilter === ALL ? null : projects.find((project) => project.id === areaFilter) ?? null;

  const focusByTask = useMemo(
    () => new Map((focusSummary.data?.tasks ?? []).map((row) => [row.taskId, row])),
    [focusSummary.data?.tasks],
  );
  const focusToday = todayFocusLabel(focusSummary.data?.todaySeconds ?? 0);

  const noteTitles = useMemo(
    () => new Map((notes.data?.notes ?? []).map((note) => [note.id, note.title])),
    [notes.data?.notes],
  );

  // The All view honours the area filter; Today always shows the whole day.
  const filtered = useMemo(
    () => (activeArea ? allTasks.filter((task) => task.projectId === activeArea.id) : allTasks),
    [allTasks, activeArea],
  );
  const groups = useMemo(() => groupAllTasks(filtered), [filtered]);
  const focus = useMemo(() => todayFocus(allTasks), [allTasks]);
  const todayOpenTasks = focus.today.filter((task) => task.status !== "done");
  const todayDoneTasks = focus.today.filter((task) => task.status === "done");
  const todayOpen = groupAllTasks(allTasks).today.length;
  const overdueAll = focus.overdueCount;

  const changeStatus = (task: TaskRecord, status: TaskStatus) => {
    update.mutate(
      { id: task.id, status },
      { onError: () => toast.show("That change could not be saved. Please try again.") },
    );
  };

  // Bring the new card into view and pulse it. Measured against the scroll
  // view's own native instance: under the new renderer measureLayout accepts
  // only a host instance. That gives a place in the viewport, so the current
  // offset is added to land on its place in the content.
  const revealTask = (id: string) => {
    const node = cardRefs.current.get(id);
    const scroller = scrollRef.current;
    const viewport = scroller?.getNativeScrollRef();
    if (node && scroller && viewport) {
      node.measureLayout(
        viewport,
        (_x, y) =>
          scroller.scrollTo({ y: Math.max(0, scrollOffset.current + y - 120), animated: true }),
        () => {},
      );
    }
    setFlash({ id, key: Date.now() });
  };

  const handleAdded = (task: TaskRecord) => {
    setQuickAddOpen(false);
    // The card must be on screen to be pointed at: stay on Today only if the
    // task is for today, and drop an area filter that would hide it.
    const dueToday = Boolean(task.completeBy && isSameDay(task.completeBy, new Date()));
    if (view === "today" && !dueToday) {
      setBuilt({ today: true, all: true });
      setView("all");
    }
    if (areaFilter !== ALL && areaFilter !== task.projectId) setAreaFilter(ALL);
    setAdded(task);
    if (revealTimer.current) clearTimeout(revealTimer.current);
    revealTimer.current = setTimeout(() => {
      revealTimer.current = null;
      setAdded(null);
      revealTask(task.id);
    }, TASK_ADDED_MS);
  };

  const addTask = async (draft: QuickAddDraft) => {
    const { task } = await create.mutateAsync({ ...draft, status: "todo" });
    handleAdded(task);
  };

  const cardRef = (id: string) => (node: View | null) => {
    if (node) cardRefs.current.set(id, node);
    else cardRefs.current.delete(id);
  };

  const renderRow = (task: TaskRecord, variant: "row" | "focus" = "row") => {
    const motion = motionFor(variant === "focus" ? "today" : "all");
    return (
    <Animated.View key={task.id} layout={motion.rowLayout} entering={motion.rowEnter} exiting={motion.rowExit}>
      <View collapsable={false} ref={cardRef(task.id)}>
        <TaskCard
          task={task}
          variant={variant}
          showProject={variant === "focus" || !activeArea}
          noteTitle={linkedNoteIds(task)[0] ? noteTitles.get(linkedNoteIds(task)[0]) : undefined}
          movedFrom={variant === "focus" ? movedFrom(task.id) : null}
          focusSummary={variant === "focus" ? focusByTask.get(task.id) : undefined}
          flashKey={flash?.id === task.id ? flash.key : undefined}
          onStatusChange={(next) => changeStatus(task, next)}
          onOpen={() => router.push(`/task/${task.id}`)}
          onLongPress={() => setMenuTask(task)}
          onStartFocus={variant === "focus" ? () => router.push(`/focus/${task.id}`) : undefined}
        />
      </View>
    </Animated.View>
  );
  };

  // Sections only appear in All tasks.
  const section = (label: string, tasks: TaskRecord[]) =>
    tasks.length > 0 ? (
      <Animated.View
        key={label}
        style={styles.section}
        entering={allMotion.enter}
        exiting={allMotion.exit}
        layout={allMotion.layout}
      >
        <Text style={styles.sectionLabel}>{label}</Text>
        {/* Rows share hairlines, so no gap between them. */}
        <View>{tasks.map((task) => renderRow(task))}</View>
      </Animated.View>
    ) : null;

  const viewSwitch = (
    <Segmented
      size="sm"
      accessibilityLabel="Which tasks to show"
      value={pendingView ?? view}
      onChange={switchView}
      options={[
        { label: "Today", value: "today" },
        { label: "All tasks", value: "all" },
      ]}
    />
  );

  const settingsButton = (
    <Pressable
      onPress={() => router.push("/settings")}
      style={styles.iconButton}
      accessibilityLabel="Settings"
    >
      <SlidersHorizontal size={20} color={colors.foreground} />
    </Pressable>
  );

  const hasOpen =
    groups.today.length + groups.thisWeek.length + groups.later.length + groups.noDate.length > 0;

  return (
    <SafeAreaView style={styles.page} edges={["top"]}>
      <SyncBar />
      <ScrollView
        ref={scrollRef}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        onScroll={(event) => {
          scrollOffset.current = event.nativeEvent.contentOffset.y;
        }}
        scrollEventThrottle={16}
      >
        <Animated.View style={[styles.viewBody, viewRevealStyle]}>
        {view === "all" ? (
          <>
            <View style={styles.titleRow}>
              <View style={styles.flex}>
                <Text style={styles.title}>Life Center</Text>
                <Text style={styles.subtitle}>
                  {formatLongDate(now)} ·{" "}
                  {todayOpen === 0
                    ? "nothing today"
                    : `${todayOpen} ${todayOpen === 1 ? "thing" : "things"} today`}
                </Text>
              </View>
              {settingsButton}
            </View>
            <View>
            <View style={styles.controls}>
              {viewSwitch}
              <AreaPill area={activeArea} open={areaMenuOpen} onPress={() => setAreaMenuOpen((open) => !open)} />
            </View>
            <AreaMenu
              open={areaMenuOpen}
              projects={projects}
              selected={activeArea?.id ?? null}
              onPick={(id) => {
                setAreaFilter(id ?? ALL);
                setAreaMenuOpen(false);
              }}
              onManage={() => {
                setAreaMenuOpen(false);
                setProjectsOpen(true);
              }}
            />
            </View>
          </>
        ) : (
          <>
            <View style={styles.controlsTop}>
              {viewSwitch}
              {settingsButton}
            </View>
            <View style={styles.greetingBlock}>
              {/* After some focus today, the screen greets you as someone
                  coming back to their work, not arriving at it. */}
              <Text style={styles.greeting}>{focusToday ? "Welcome back" : greeting(now)}</Text>
              {focusToday ? (
                <View style={styles.focusLine}>
                  <Timer size={16} color={colors.primary} />
                  <Text style={styles.subtitle}>{focusToday}</Text>
                </View>
              ) : (
                <Text style={styles.subtitle}>{formatLongDate(now)}</Text>
              )}
            </View>
          </>
        )}

        {loading ? (
          <View style={styles.section}>
            {[0, 1, 2].map((item) => (
              <Skeleton key={item} style={styles.skeleton} />
            ))}
          </View>
        ) : null}

        {query.isError ? (
          <View style={styles.empty}>
            <Text style={styles.emptyText}>We could not load your Life Center.</Text>
            <Button variant="secondary" onPress={() => void query.refetch()}>
              Try again
            </Button>
          </View>
        ) : null}

        {!loading && !query.isError && built.all ? (
          <View style={[styles.viewList, view !== "all" && styles.hidden]}>
            {groups.overdue.length > 0 ? (
              <Animated.View entering={allMotion.enter} exiting={allMotion.exit} layout={allMotion.layout} style={styles.slipped}>
                <View style={styles.slippedHead}>
                  <View style={[styles.dot, styles.slippedDot]} />
                  <Text style={styles.slippedTitle}>{slippedLabel(groups.overdue.length)}</Text>
                </View>
                <Text style={styles.slippedBody}>
                  No rush. Sort them one at a time: do it today, pick a new day, or let it go.
                </Text>
                <Pressable
                  style={({ pressed }) => [styles.reviewButton, pressed && styles.pressed]}
                  onPress={() => router.push("/catch-up")}
                  accessibilityRole="button"
                >
                  <Text style={styles.reviewText}>Review them</Text>
                  <ArrowRight size={18} color={colors.accentForeground} />
                </Pressable>
              </Animated.View>
            ) : null}

            {section("TODAY", groups.today)}
            {section("THIS WEEK", groups.thisWeek)}
            {section("LATER", groups.later)}
            {section("NO DATE", groups.noDate)}

            {!hasOpen && groups.overdue.length === 0 ? (
              <View style={styles.empty}>
                <Text style={styles.emptyTitle}>
                  {allTasks.length === 0 ? "Your Life Center is ready" : "Nothing open"}
                </Text>
                <Text style={styles.emptyText}>
                  {allTasks.length === 0
                    ? "Tasks you add here, or that are found in your notes, gather in one calm place."
                    : activeArea
                      ? `Nothing is waiting in ${activeArea.name}.`
                      : "Everything is done. Enjoy the quiet."}
                </Text>
              </View>
            ) : null}

            {groups.done.length > 0 ? (
              <Animated.View layout={allMotion.layout} entering={allMotion.enter} exiting={allMotion.exit} style={styles.section}>
                <View style={styles.doneHeader}>
                  <Pressable onPress={() => setShowDone((v) => !v)} style={styles.doneToggle}>
                    <Text style={styles.sectionLabel}>DONE {groups.done.length}</Text>
                    <RotatingChevron open={showDone} color={colors.mutedForeground} />
                  </Pressable>
                  {showDone ? (
                    <Animated.View entering={fadeInFast} exiting={allMotion.exit}>
                      <Button variant="ghost" size="sm" onPress={() => setConfirmClear(true)}>
                        Clear completed
                      </Button>
                    </Animated.View>
                  ) : null}
                </View>
                {showDone ? <View>{groups.done.map((task) => renderRow(task))}</View> : null}
              </Animated.View>
            ) : null}
          </View>
        ) : null}

        {!loading && !query.isError && built.today ? (
          <View style={[styles.viewList, view !== "today" && styles.hidden]}>
            {focus.today.length > 0 ? (
              <>
                <Animated.View layout={todayMotion.layout} style={styles.section}>
                  <View>{todayOpenTasks.map((task) => renderRow(task, "focus"))}</View>
                </Animated.View>
                {/* What got finished today settles here, in its fields. */}
                {todayDoneTasks.length > 0 ? (
                  <Animated.View
                    layout={todayMotion.layout}
                    entering={todayMotion.enter}
                    exiting={todayMotion.exit}
                    style={styles.section}
                  >
                    <Text style={styles.sectionLabel}>DONE</Text>
                    <View>{todayDoneTasks.map((task) => renderRow(task, "focus"))}</View>
                  </Animated.View>
                ) : null}
              </>
            ) : (
              <View style={styles.todayEmpty}>
                <Text style={styles.emptyText}>
                  Nothing planned for today. Add something below, or look at what is coming up.
                </Text>
              </View>
            )}

            {overdueAll > 0 ? (
              <Animated.View entering={todayMotion.enter} exiting={todayMotion.exit} layout={todayMotion.layout}>
              <Pressable
                style={({ pressed }) => [styles.slippedRow, pressed && styles.pressed]}
                onPress={() => router.push("/catch-up")}
                accessibilityRole="button"
              >
                <View style={[styles.dot, styles.slippedDot]} />
                <Text style={styles.slippedRowText}>
                  {slippedLabel(overdueAll, focus.today.length > 0)}
                </Text>
                <Text style={styles.slippedRowAction}>Review</Text>
              </Pressable>
              </Animated.View>
            ) : null}

            {focus.comingUp.length > 0 ? (
              <Animated.View layout={todayMotion.layout} entering={todayMotion.enter} exiting={todayMotion.exit} style={styles.section}>
                <Text style={styles.sectionLabel}>COMING UP</Text>
                {focus.comingUp.map((task) => (
                  <Animated.View key={task.id} entering={todayMotion.enter} exiting={todayMotion.exit} layout={todayMotion.layout}>
                  <Pressable
                    style={styles.comingRow}
                    onPress={() => router.push(`/task/${task.id}`)}
                    onLongPress={() => setMenuTask(task)}
                  >
                    <Text style={styles.comingText} numberOfLines={1}>
                      {task.text}
                    </Text>
                    <Text style={styles.comingWhen}>
                      {task.completeBy
                        ? dueState(task.completeBy) === "week"
                          ? formatWeekdayShort(task.completeBy)
                          : dateChipLabel(task.completeBy)
                        : ""}
                    </Text>
                  </Pressable>
                  </Animated.View>
                ))}
                <Pressable
                  onPress={() => switchView("all")}
                  style={styles.seeAll}
                >
                  <Text style={styles.seeAllText}>See all tasks</Text>
                </Pressable>
              </Animated.View>
            ) : null}
          </View>
        ) : null}
        </Animated.View>
      </ScrollView>

      <View style={styles.addBarWrap}>
        <Pressable
          style={({ pressed }) => [styles.addBar, pressed && styles.pressed]}
          onPress={() => setQuickAddOpen(true)}
          disabled={loading}
          accessibilityRole="button"
          accessibilityLabel={view === "today" ? "Add something for today" : "Add a task"}
        >
          <View style={styles.addCircle}>
            <Plus size={18} color={colors.primaryForeground} strokeWidth={2.5} />
          </View>
          <Text style={styles.addText}>
            {view === "today" ? "Add something for today…" : "Add a task…"}
          </Text>
        </Pressable>
      </View>

      <QuickAddTask
        open={quickAddOpen}
        onClose={() => setQuickAddOpen(false)}
        projects={projects}
        defaultProjectId={activeArea?.id ?? projects[0]?.id ?? null}
        defaultDate={view === "today" ? daysFromToday(0) : null}
        placeholder={view === "today" ? "e.g., Call Dr. Lee" : "e.g., Call Dr. Lee tomorrow"}
        onCreateProject={async (name) => (await createProject.mutateAsync({ name })).project}
        onSubmit={addTask}
      />

      <TaskQuickMenu task={menuTask} onClose={() => setMenuTask(null)} />

      <ProjectSheet
        open={projectsOpen}
        onClose={() => setProjectsOpen(false)}
        projects={projects}
        tasks={allTasks}
        onCreate={async (name) => (await createProject.mutateAsync({ name })).project}
        onRename={async (id, name) => {
          await renameProject.mutateAsync({ id, name });
        }}
        onDelete={async (id, moveTasksTo) => {
          await deleteProject.mutateAsync({ id, moveTasksTo });
          if (areaFilter === id) setAreaFilter(ALL);
        }}
      />

      <ConfirmModal
        open={confirmClear}
        title={
          activeArea ? `Clear completed tasks in ${activeArea.name}?` : "Clear all completed tasks?"
        }
        description={`${groups.done.length} finished ${groups.done.length === 1 ? "task" : "tasks"} will be removed from the board. Your notes are not affected.`}
        confirmLabel="Clear"
        destructive
        loading={clearDone.isPending}
        onClose={() => setConfirmClear(false)}
        onConfirm={() => {
          clearDone.mutate(activeArea ? { projectId: activeArea.id } : {}, {
            onSuccess: ({ cleared }) => {
              setConfirmClear(false);
              toast.show(`${cleared} ${cleared === 1 ? "task" : "tasks"} cleared`);
            },
            onError: () => toast.show("Those tasks could not be cleared. Please try again."),
          });
        }}
      />

      <TaskAddedOverlay visible={added !== null} projectName={added?.projectName ?? ""} />
    </SafeAreaView>
  );
}

function makeStyles(colors: Colors, scale: number) {
  return StyleSheet.create({
    page: { flex: 1, backgroundColor: colors.background },
    flex: { flex: 1 },
    content: { padding: spacing[4], paddingBottom: spacing[8] },
    viewBody: { gap: spacing[4] },
    viewList: { gap: spacing[4] },
    // The list not being looked at stays built but takes no room.
    hidden: { display: "none" },
    pressed: { opacity: 0.8 },
    titleRow: { flexDirection: "row", alignItems: "flex-start", gap: spacing[3] },
    title: { fontFamily: fonts.display, fontSize: textSize.display * scale, color: colors.foreground },
    subtitle: { fontFamily: fonts.base, fontSize: textSize.body * scale, color: colors.mutedForeground, marginTop: 2 },
    // Plain outline: a quiet circle, not a filled button competing with the tasks.
    iconButton: {
      width: 44,
      height: 44,
      borderRadius: 22,
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: "center",
      justifyContent: "center",
    },
    controls: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing[2] },
    controlsTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
    dot: { width: 8, height: 8, borderRadius: 4 },
    greetingBlock: { gap: 2 },
    focusLine: { flexDirection: "row", alignItems: "center", gap: spacing[1], marginTop: 2 },
    greeting: { fontFamily: fonts.display, fontSize: textSize.display * scale, color: colors.foreground },
    section: { gap: spacing[2] },
    sectionLabel: {
      fontFamily: fonts.baseSemi,
      fontSize: textSize.label * scale,
      letterSpacing: 1,
      color: colors.mutedForeground,
    },
    skeleton: { height: 72, borderRadius: radius.md },
    slipped: {
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.card,
      padding: spacing[4],
      gap: spacing[3],
    },
    slippedHead: { flexDirection: "row", alignItems: "center", gap: spacing[2] },
    slippedDot: { backgroundColor: colors.warning },
    slippedTitle: { flex: 1, fontFamily: fonts.baseSemi, fontSize: textSize.body * scale, color: colors.foreground },
    slippedBody: { fontFamily: fonts.base, fontSize: textSize.body * scale, lineHeight: 23 * scale, color: colors.mutedForeground },
    reviewButton: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: spacing[2],
      minHeight: 48,
      borderRadius: radius.md,
      backgroundColor: colors.accent,
    },
    reviewText: { fontFamily: fonts.baseSemi, fontSize: textSize.body * scale, color: colors.accentForeground },
    slippedRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing[2],
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      paddingHorizontal: spacing[4],
      paddingVertical: spacing[3],
    },
    slippedRowText: { flex: 1, fontFamily: fonts.base, fontSize: textSize.body * scale, color: colors.foreground },
    slippedRowAction: { fontFamily: fonts.baseSemi, fontSize: textSize.body * scale, color: colors.primary },
    comingRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: spacing[3],
      paddingVertical: spacing[2],
    },
    comingText: { flex: 1, fontFamily: fonts.base, fontSize: textSize.body * scale, color: colors.foreground },
    comingWhen: { fontFamily: fonts.base, fontSize: textSize.small * scale, color: colors.mutedForeground },
    seeAll: { paddingVertical: spacing[1] },
    seeAllText: { fontFamily: fonts.baseSemi, fontSize: textSize.small * scale, color: colors.primary },
    doneHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
    doneToggle: { flexDirection: "row", alignItems: "center", gap: spacing[1], paddingVertical: spacing[1] },
    chevronUp: { transform: [{ rotate: "180deg" }] },
    todayEmpty: { paddingVertical: spacing[4] },
    empty: { alignItems: "center", gap: spacing[3], paddingVertical: spacing[8] },
    emptyTitle: { fontFamily: fonts.display, fontSize: textSize.title * scale, color: colors.foreground },
    emptyText: { fontFamily: fonts.base, fontSize: textSize.body * scale, color: colors.mutedForeground, textAlign: "center" },
    // Pinned above the tab bar, the way the design puts adding at the bottom.
    addBarWrap: {
      paddingHorizontal: spacing[4],
      paddingTop: spacing[2],
      paddingBottom: spacing[3],
      backgroundColor: colors.background,
    },
    addBar: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing[3],
      minHeight: 54,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.card,
      paddingHorizontal: spacing[3],
    },
    addCircle: {
      width: 30,
      height: 30,
      borderRadius: 15,
      backgroundColor: colors.primary,
      alignItems: "center",
      justifyContent: "center",
    },
    addText: { fontFamily: fonts.base, fontSize: textSize.body * scale, color: colors.mutedForeground },
  });
}
