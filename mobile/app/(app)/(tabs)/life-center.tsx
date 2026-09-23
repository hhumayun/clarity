import { useRouter } from "expo-router";
import { ArrowRight, Check, ChevronDown, Plus, SlidersHorizontal, Timer } from "lucide-react-native";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import Animated, { FadeInDown, FadeOutUp, LinearTransition } from "react-native-reanimated";
import { useFocusedMotion } from "../../../src/hooks/useFocusedMotion";
import { FadeSwitch } from "../../../src/ui/FadeSwitch";
import { fadeInFast, fadeOut } from "../../../src/ui/motion";
import { RotatingChevron } from "../../../src/ui/RotatingChevron";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusSummary } from "../../../src/hooks/useFocus";
import { useNotes } from "../../../src/hooks/useNotes";
import { useTasks } from "../../../src/hooks/useTasks";
import {
  daysFromToday,
  dateChipLabel,
  formatLongDate,
  formatWeekdayShort,
  isSameDay,
} from "../../../src/lib/dates";
import {
  areaColor,
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
import { fonts, radius, spacing, type Colors } from "../../../src/theme";
import type { ProjectRecord, TaskRecord, TaskStatus } from "../../../src/types";
import { Button } from "../../../src/ui/Button";
import { ConfirmModal } from "../../../src/ui/ConfirmModal";
import { ProjectSheet } from "../../../src/ui/ProjectSheet";
import { QuickAddTask, type QuickAddDraft } from "../../../src/ui/QuickAddTask";
import { Segmented } from "../../../src/ui/Segmented";
import { SegmentBar } from "../../../src/ui/SegmentBar";
import { Skeleton } from "../../../src/ui/Skeleton";
import { TASK_ADDED_MS, TaskAddedOverlay } from "../../../src/ui/TaskAddedOverlay";
import { TaskCard } from "../../../src/ui/TaskCard";
import { TaskSheet, type TaskDraft } from "../../../src/ui/TaskSheet";

type View_ = "today" | "all";
const ALL = "__all__";

export default function LifeCenterScreen() {
  const router = useRouter();
  const toast = useToast();
  const { colors, scale } = useAppTheme();
  const styles = useMemo(() => makeStyles(colors, scale), [colors, scale]);
  const { query, create, update, remove, clearDone, createProject, renameProject, deleteProject } =
    useTasks();
  const notes = useNotes({});
  const movedFrom = useMovedFrom();
  const focusSummary = useFocusSummary();
  const motion = useFocusedMotion();

  // Today is the calm place to start; All tasks is one tap away.
  const [view, setView] = useState<View_>("today");
  const [areaFilter, setAreaFilter] = useState<string>(ALL);
  const [areaMenuOpen, setAreaMenuOpen] = useState(false);
  const [showDone, setShowDone] = useState(false);
  const [editing, setEditing] = useState<TaskRecord | null>(null);
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
  const todayOpen = groupAllTasks(allTasks).today.length;
  const overdueAll = focus.overdueCount;

  const changeStatus = (task: TaskRecord, status: TaskStatus) => {
    update.mutate(
      { id: task.id, status },
      { onError: () => toast.show("That change could not be saved. Please try again.") },
    );
  };

  const saveTask = async (draft: TaskDraft) => {
    if (!draft.projectId) throw new Error("Choose an area for this task.");
    if (!editing) return;
    await update.mutateAsync({
      id: editing.id,
      text: draft.text,
      projectId: draft.projectId,
      completeBy: draft.completeBy,
      status: draft.status,
    });
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
    if (view === "today" && !dueToday) setView("all");
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

  const renderRow = (task: TaskRecord, variant: "row" | "focus" = "row") => (
    <Animated.View key={task.id} layout={motion.rowLayout} entering={motion.rowEnter} exiting={motion.rowExit}>
      <View collapsable={false} ref={cardRef(task.id)}>
        <TaskCard
          task={task}
          variant={variant}
          showProject={variant === "focus" || !activeArea}
          noteTitle={task.noteId ? noteTitles.get(task.noteId) : undefined}
          movedFrom={variant === "focus" ? movedFrom(task.id) : null}
          focusSummary={variant === "focus" ? focusByTask.get(task.id) : undefined}
          flashKey={flash?.id === task.id ? flash.key : undefined}
          onStatusChange={(next) => changeStatus(task, next)}
          onOpen={() => setEditing(task)}
          onStartFocus={variant === "focus" ? () => router.push(`/focus/${task.id}`) : undefined}
          onContinueFocus={
            variant === "focus" ? () => router.push(`/focus/${task.id}?continue=1`) : undefined
          }
        />
      </View>
    </Animated.View>
  );

  const section = (label: string, tasks: TaskRecord[]) =>
    tasks.length > 0 ? (
      <Animated.View
        key={label}
        style={styles.section}
        entering={motion.enter}
        exiting={motion.exit}
        layout={motion.layout}
      >
        <Text style={styles.sectionLabel}>{label}</Text>
        {tasks.map((task) => renderRow(task))}
      </Animated.View>
    ) : null;

  const viewSwitch = (
    <Segmented
      size="sm"
      accessibilityLabel="Which tasks to show"
      value={view}
      onChange={(next) => {
        scrollRef.current?.scrollTo({ y: 0, animated: false });
        setView(next);
        setAreaMenuOpen(false);
      }}
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
      <ScrollView
        ref={scrollRef}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        onScroll={(event) => {
          scrollOffset.current = event.nativeEvent.contentOffset.y;
        }}
        scrollEventThrottle={16}
      >
        <FadeSwitch switchKey={view} style={styles.viewBody}>
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
            <View style={styles.controls}>
              {viewSwitch}
              <Pressable
                onPress={() => setAreaMenuOpen((open) => !open)}
                style={[styles.areaPill, areaMenuOpen && styles.areaPillOpen]}
                accessibilityLabel={`Area: ${activeArea?.name ?? "All areas"}. Change area`}
              >
                {activeArea ? (
                  <View style={[styles.dot, { backgroundColor: areaColor(activeArea.id) }]} />
                ) : null}
                <Text style={styles.areaPillText} numberOfLines={1}>
                  {activeArea?.name ?? "All areas"}
                </Text>
                <ChevronDown size={16} color={colors.mutedForeground} />
              </Pressable>
            </View>
            {areaMenuOpen ? (
              <Animated.View entering={FadeInDown.duration(180)} exiting={motion.exit} style={styles.areaMenu}>
                {[{ id: ALL, name: "All areas" }, ...projects].map((area) => {
                  const active = area.id === areaFilter;
                  return (
                    <Pressable
                      key={area.id}
                      style={styles.areaItem}
                      onPress={() => {
                        setAreaFilter(area.id);
                        setAreaMenuOpen(false);
                      }}
                    >
                      {area.id !== ALL ? (
                        <View style={[styles.dot, { backgroundColor: areaColor(area.id) }]} />
                      ) : null}
                      <Text style={[styles.areaItemText, active && styles.areaItemActive]}>
                        {area.name}
                      </Text>
                      {active ? <Check size={16} color={colors.primary} /> : null}
                    </Pressable>
                  );
                })}
                <Pressable
                  style={[styles.areaItem, styles.areaManage]}
                  onPress={() => {
                    setAreaMenuOpen(false);
                    setProjectsOpen(true);
                  }}
                >
                  <Text style={styles.areaManageText}>Manage areas…</Text>
                </Pressable>
              </Animated.View>
            ) : null}
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
            {focus.today.length > 0 ? (
              <View style={styles.progress}>
                <SegmentBar
                  total={focus.today.length}
                  filled={focus.doneCount}
                  accessibilityLabel={`${focus.doneCount} of ${focus.today.length} done today`}
                />
                <Text style={styles.progressText}>
                  {focus.doneCount} of {focus.today.length} done today
                </Text>
              </View>
            ) : null}
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

        {!loading && !query.isError && view === "all" ? (
          <>
            {groups.overdue.length > 0 ? (
              <Animated.View entering={motion.enter} exiting={motion.exit} layout={motion.layout} style={styles.slipped}>
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
              <Animated.View layout={motion.layout} entering={motion.enter} exiting={motion.exit} style={styles.section}>
                <View style={styles.doneHeader}>
                  <Pressable onPress={() => setShowDone((v) => !v)} style={styles.doneToggle}>
                    <Text style={styles.sectionLabel}>DONE {groups.done.length}</Text>
                    <RotatingChevron open={showDone} color={colors.mutedForeground} />
                  </Pressable>
                  {showDone ? (
                    <Animated.View entering={fadeInFast} exiting={motion.exit}>
                      <Button variant="ghost" size="sm" onPress={() => setConfirmClear(true)}>
                        Clear completed
                      </Button>
                    </Animated.View>
                  ) : null}
                </View>
                {showDone ? groups.done.map((task) => renderRow(task)) : null}
              </Animated.View>
            ) : null}
          </>
        ) : null}

        {!loading && !query.isError && view === "today" ? (
          <>
            {focus.today.length > 0 ? (
              <Animated.View layout={motion.layout} style={styles.section}>
                {focus.today.map((task) => renderRow(task, "focus"))}
              </Animated.View>
            ) : (
              <View style={styles.todayEmpty}>
                <Text style={styles.emptyText}>
                  Nothing planned for today. Add something below, or look at what is coming up.
                </Text>
              </View>
            )}

            {overdueAll > 0 ? (
              <Animated.View entering={motion.enter} exiting={motion.exit} layout={motion.layout}>
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
              <Animated.View layout={motion.layout} entering={motion.enter} exiting={motion.exit} style={styles.section}>
                <Text style={styles.sectionLabel}>COMING UP</Text>
                {focus.comingUp.map((task) => (
                  <Animated.View key={task.id} entering={motion.enter} exiting={motion.exit} layout={motion.layout}>
                  <Pressable style={styles.comingRow} onPress={() => setEditing(task)}>
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
                  onPress={() => {
                    scrollRef.current?.scrollTo({ y: 0, animated: false });
                    setView("all");
                  }}
                  style={styles.seeAll}
                >
                  <Text style={styles.seeAllText}>See all tasks</Text>
                </Pressable>
              </Animated.View>
            ) : null}
          </>
        ) : null}
        </FadeSwitch>
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

      <TaskSheet
        open={editing !== null}
        onClose={() => setEditing(null)}
        task={editing}
        projects={projects}
        onSave={saveTask}
        onDelete={
          editing
            ? async () => {
                await remove.mutateAsync({ id: editing.id });
              }
            : undefined
        }
        onCreateProject={async (name) => (await createProject.mutateAsync({ name })).project}
        startPanel="actions"
        onStartFocus={
          editing
            ? () => {
                const id = editing.id;
                setEditing(null);
                router.push(`/focus/${id}`);
              }
            : undefined
        }
      />

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
    pressed: { opacity: 0.8 },
    titleRow: { flexDirection: "row", alignItems: "flex-start", gap: spacing[3] },
    title: { fontFamily: fonts.display, fontSize: 32 * scale, color: colors.foreground },
    subtitle: { fontFamily: fonts.base, fontSize: 15 * scale, color: colors.mutedForeground, marginTop: 2 },
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
    areaPill: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing[1],
      maxWidth: 170,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      paddingHorizontal: spacing[3],
      paddingVertical: spacing[2],
    },
    areaPillOpen: { borderColor: colors.primary },
    areaPillText: { flexShrink: 1, fontFamily: fonts.baseSemi, fontSize: 14 * scale, color: colors.foreground },
    areaMenu: {
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.card,
      overflow: "hidden",
    },
    areaItem: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing[2],
      paddingHorizontal: spacing[4],
      paddingVertical: spacing[3],
    },
    areaItemText: { flex: 1, fontFamily: fonts.base, fontSize: 15 * scale, color: colors.foreground },
    areaItemActive: { fontFamily: fonts.baseSemi },
    areaManage: { borderTopWidth: 1, borderTopColor: colors.border },
    areaManageText: { fontFamily: fonts.baseSemi, fontSize: 15 * scale, color: colors.primary },
    dot: { width: 8, height: 8, borderRadius: 4 },
    greetingBlock: { gap: 2 },
    focusLine: { flexDirection: "row", alignItems: "center", gap: spacing[1], marginTop: 2 },
    greeting: { fontFamily: fonts.display, fontSize: 36 * scale, color: colors.foreground },
    progress: { gap: spacing[2] },
    progressText: { fontFamily: fonts.base, fontSize: 13 * scale, color: colors.mutedForeground },
    section: { gap: spacing[2] },
    sectionLabel: {
      fontFamily: fonts.baseSemi,
      fontSize: 12 * scale,
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
    slippedTitle: { flex: 1, fontFamily: fonts.baseSemi, fontSize: 16 * scale, color: colors.foreground },
    slippedBody: { fontFamily: fonts.base, fontSize: 15 * scale, lineHeight: 22 * scale, color: colors.mutedForeground },
    reviewButton: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: spacing[2],
      minHeight: 48,
      borderRadius: radius.md,
      backgroundColor: colors.accent,
    },
    reviewText: { fontFamily: fonts.baseSemi, fontSize: 16 * scale, color: colors.accentForeground },
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
    slippedRowText: { flex: 1, fontFamily: fonts.base, fontSize: 15 * scale, color: colors.foreground },
    slippedRowAction: { fontFamily: fonts.baseSemi, fontSize: 15 * scale, color: colors.primary },
    comingRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: spacing[3],
      paddingVertical: spacing[2],
    },
    comingText: { flex: 1, fontFamily: fonts.base, fontSize: 16 * scale, color: colors.foreground },
    comingWhen: { fontFamily: fonts.base, fontSize: 14 * scale, color: colors.mutedForeground },
    seeAll: { paddingVertical: spacing[1] },
    seeAllText: { fontFamily: fonts.baseSemi, fontSize: 14 * scale, color: colors.primary },
    doneHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
    doneToggle: { flexDirection: "row", alignItems: "center", gap: spacing[1], paddingVertical: spacing[1] },
    chevronUp: { transform: [{ rotate: "180deg" }] },
    todayEmpty: { paddingVertical: spacing[4] },
    empty: { alignItems: "center", gap: spacing[3], paddingVertical: spacing[8] },
    emptyTitle: { fontFamily: fonts.display, fontSize: 24 * scale, color: colors.foreground },
    emptyText: { fontFamily: fonts.base, fontSize: 16 * scale, color: colors.mutedForeground, textAlign: "center" },
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
    addText: { fontFamily: fonts.base, fontSize: 16 * scale, color: colors.mutedForeground },
  });
}
