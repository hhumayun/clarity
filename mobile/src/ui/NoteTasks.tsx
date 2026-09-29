import { useRouter } from "expo-router";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { CalendarDays, Sparkles } from "lucide-react-native";
import { fonts, radius, spacing, type Colors, textSize } from "../theme";
import { useAppTheme } from "../providers/AppThemeProvider";
import Animated, { FadeInDown, FadeOutUp, LinearTransition } from "react-native-reanimated";
import { useToast } from "../providers/ToastProvider";
import { useAfterExit } from "../hooks/useAfterExit";
import { useTasks } from "../hooks/useTasks";
import { formatDue } from "../lib/taskDates";
import { areaTag } from "../lib/lifeCenter";
import { sortProjects, sortTasks } from "../lib/taskSort";
import type { SuggestedTask, TaskRecord, TaskStatus } from "../types";
import { Button } from "./Button";
import { Skeleton } from "./Skeleton";
import { TaskCard } from "./TaskCard";
import { QuickAddTask, type QuickAddDraft } from "./QuickAddTask";
import { TASK_ADDED_MS, TaskAddedOverlay } from "./TaskAddedOverlay";
import { TaskSheet, type TaskDraft } from "./TaskSheet";
import { LinkTaskSheet } from "./LinkTaskSheet";

function quietAiFailure(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code;
  return (
    code === "OUT_OF_CREDITS" ||
    /too many requests/i.test(error instanceof Error ? error.message : "")
  );
}

function commonProjectId(tasks: TaskRecord[]): string | null {
  const counts = new Map<string, number>();
  for (const task of tasks) counts.set(task.projectId, (counts.get(task.projectId) ?? 0) + 1);
  let best: string | null = null;
  let bestCount = 0;
  for (const [id, count] of counts) {
    if (count > bestCount) {
      best = id;
      bestCount = count;
    }
  }
  return best;
}

export function NoteTasks({
  noteId,
  enabled,
  ensureSaved,
}: {
  noteId: string | null;
  enabled: boolean;
  /**
   * The note's latest words reaching the server. Find tasks reads the saved
   * note, so it waits for this first.
   */
  ensureSaved?: () => Promise<unknown>;
}) {
  const toast = useToast();
  const router = useRouter();
  const { colors, scale } = useAppTheme();
  const styles = useMemo(() => makeStyles(colors, scale), [colors, scale]);
  const { query, extract, addSuggested, create, update, link, remove, createProject } = useTasks(
    noteId ?? undefined,
    enabled && Boolean(noteId),
  );
  const attemptedRef = useRef(false);
  const ensureSavedRef = useRef(ensureSaved);
  ensureSavedRef.current = ensureSaved;
  const extractRef = useRef(extract.mutate);
  extractRef.current = extract.mutate;
  const [taskDialog, setTaskDialog] = useState<{ open: boolean; task: TaskRecord | null }>({
    open: false,
    task: null,
  });
  const [suggestions, setSuggestions] = useState<SuggestedTask[] | null>(null);
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const [adding, setAdding] = useState(false);
  const [showDone, setShowDone] = useState(false);
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  // The task sheet's Notes and Link a note open once the sheet has gone.
  const afterSheet = useAfterExit();
  const [linkOpen, setLinkOpen] = useState(false);
  // After an add: the confirmation, then which card to flash.
  const [added, setAdded] = useState<TaskRecord | null>(null);
  const [finished, setFinished] = useState<TaskRecord | null>(null);
  const finishedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [flash, setFlash] = useState<{ id: string; key: number } | null>(null);
  const revealTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (revealTimer.current) clearTimeout(revealTimer.current);
      if (finishedTimer.current) clearTimeout(finishedTimer.current);
    },
    [],
  );

  const showFinished = (task: TaskRecord) => {
    setAdded(null);
    setFinished(task);
    if (finishedTimer.current) clearTimeout(finishedTimer.current);
    finishedTimer.current = setTimeout(() => {
      finishedTimer.current = null;
      setFinished(null);
    }, TASK_ADDED_MS);
  };

  const runExtract = async () => {
    if (!noteId) return;
    await ensureSavedRef.current?.().catch(() => {});
    extract.mutate(
      { noteId },
      {
        onSuccess: ({ suggested, unchanged }) => {
          setSuggestions(suggested);
          setChecked(new Set(suggested.map((_, index) => index)));
          if (unchanged) toast.show("Nothing new — the note has not changed since the last look.");
          else if (suggested.length === 0) toast.show("No new tasks found in this note.");
        },
        onError: (error) => {
          if (!quietAiFailure(error)) {
            toast.show("Tasks could not be found right now. You can try again.");
          }
        },
      },
    );
  };

  useEffect(() => {
    if (!enabled || !noteId || !query.data?.extraction) return;
    if (query.data.extraction.hasExtracted || attemptedRef.current) return;
    attemptedRef.current = true;
    void (ensureSavedRef.current?.() ?? Promise.resolve()).catch(() => {}).then(() => extractRef.current(
      { noteId },
      {
        onSuccess: ({ suggested }) => {
          setSuggestions(suggested);
          setChecked(new Set(suggested.map((_, index) => index)));
        },
        onError: (error) => {
          if (!quietAiFailure(error)) {
            toast.show("Tasks could not be found right now. You can try again.");
          }
        },
      },
    ));
  }, [enabled, noteId, query.data?.extraction, toast]);

  const projects = useMemo(() => sortProjects(query.data?.projects ?? []), [query.data?.projects]);
  const tasks = useMemo(() => sortTasks(query.data?.tasks ?? []), [query.data?.tasks]);
  const loading = query.isFetching && !query.data;

  if (!noteId) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyText}>
          Start writing your note first. Tasks will be available after it saves.
        </Text>
      </View>
    );
  }

  const toggleSuggestion = (index: number) => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  const addSelected = async () => {
    if (!suggestions || checked.size === 0) return;
    setAdding(true);
    try {
      const chosen = suggestions.filter((_, index) => checked.has(index));
      const { added } = await addSuggested.mutateAsync({ noteId, tasks: chosen });
      setSuggestions(null);
      setChecked(new Set());
      toast.show(
        added > 0
          ? `${added} ${added === 1 ? "task" : "tasks"} added`
          : "Those tasks were already in your list",
      );
    } catch {
      toast.show("Those tasks could not be added. Please try again.");
    } finally {
      setAdding(false);
    }
  };

  const changeStatus = (task: TaskRecord, status: TaskStatus) => {
    update.mutate(
      { id: task.id, status },
      { onError: () => toast.show("That change could not be saved. Please try again.") },
    );
  };

  const saveTask = async (draft: TaskDraft) => {
    if (!draft.projectId) throw new Error("Choose a project for this task.");
    if (!taskDialog.task) return;
    await update.mutateAsync({
      id: taskDialog.task.id,
      text: draft.text,
      ...(draft.description !== undefined ? { description: draft.description } : {}),
      projectId: draft.projectId,
      completeBy: draft.completeBy,
      status: draft.status,
    });
  };

  const handleAdded = (task: TaskRecord) => {
    setQuickAddOpen(false);
    setAdded(task);
    if (revealTimer.current) clearTimeout(revealTimer.current);
    revealTimer.current = setTimeout(() => {
      revealTimer.current = null;
      setAdded(null);
      setFlash({ id: task.id, key: Date.now() });
    }, TASK_ADDED_MS);
  };

  // Link one of the writer's existing tasks to this note too (it keeps any
  // other notes it is linked to), then point at its row.
  const linkTask = async (task: TaskRecord) => {
    if (!noteId) return;
    try {
      await link.mutateAsync({ taskId: task.id, noteId, linked: true });
      setLinkOpen(false);
      toast.show("Linked to this note");
      setFlash({ id: task.id, key: Date.now() });
    } catch {
      toast.show("That task could not be linked. Please try again.");
    }
  };

  const addTask = async (draft: QuickAddDraft) => {
    const { task } = await create.mutateAsync({ ...draft, status: "todo", noteId });
    handleAdded(task);
  };

  const openTasks = tasks.filter((task) => task.status !== "done");
  const doneTasks = tasks.filter((task) => task.status === "done");
  const selectedCount = checked.size;

  return (
    <View style={styles.section}>
      <Text style={styles.title}>Tasks from this note</Text>
      <Text style={styles.subtitle}>Anything you want to remember or complete, in one place.</Text>
      <View style={styles.actions}>
        <Button
          variant="secondary"
          size="sm"
          onPress={() => void runExtract()}
          disabled={extract.isPending || loading || adding}
        >
          {extract.isPending ? "Looking…" : "Find tasks"}
        </Button>
        <Button variant="secondary" size="sm" onPress={() => setLinkOpen(true)} disabled={loading}>
          Link a task
        </Button>
        <Button size="sm" onPress={() => setQuickAddOpen(true)} disabled={loading}>
          Add a task
        </Button>
      </View>

      {query.data?.extraction?.needsRefresh && !extract.isPending && suggestions === null ? (
        <Text style={styles.changed}>
          This note changed. Find tasks again when you are ready to look for new ones.
        </Text>
      ) : null}

      {extract.isPending ? (
        <Text style={styles.intro}>Looking for clear actions in your note…</Text>
      ) : null}

      {suggestions !== null && !extract.isPending ? (
        <View style={styles.box}>
          {suggestions.length === 0 ? (
            <>
              <Text style={styles.intro}>No new tasks found in this note.</Text>
              <Button variant="ghost" size="sm" onPress={() => setSuggestions(null)}>
                Close
              </Button>
            </>
          ) : (
            <>
              <Text style={styles.intro}>
                Found {suggestions.length} possible {suggestions.length === 1 ? "task" : "tasks"}.
                Tick the ones you want — nothing is added until you say so.
              </Text>
              {suggestions.map((item, index) => (
                <Pressable
                  key={`${item.text}-${index}`}
                  onPress={() => toggleSuggestion(index)}
                  style={styles.suggestion}
                >
                  <View style={[styles.check, checked.has(index) && styles.checkOn]} />
                  <View style={styles.flex}>
                    <Text style={styles.suggestionText}>{item.text}</Text>
                    <View style={styles.meta}>
                      <Text style={styles.chip}>{areaTag(item.projectName)}</Text>
                      {item.completeBy ? (
                        <View style={styles.due}>
                          <CalendarDays size={12} color={colors.mutedForeground} />
                          <Text style={styles.chip}>{formatDue(item.completeBy)}</Text>
                        </View>
                      ) : null}
                    </View>
                  </View>
                </Pressable>
              ))}
              <View style={styles.actions}>
                <Button
                  variant="ghost"
                  size="sm"
                  onPress={() => {
                    setSuggestions(null);
                    setChecked(new Set());
                  }}
                  disabled={adding}
                >
                  Dismiss
                </Button>
                <Button size="sm" onPress={() => void addSelected()} disabled={adding || selectedCount === 0}>
                  {adding
                    ? "Adding…"
                    : selectedCount === suggestions.length
                      ? `Add ${selectedCount === 1 ? "task" : `all ${selectedCount} tasks`}`
                      : `Add ${selectedCount} ${selectedCount === 1 ? "task" : "tasks"}`}
                </Button>
              </View>
            </>
          )}
        </View>
      ) : null}

      {loading ? (
        <View style={styles.list}>
          <Skeleton style={styles.skeleton} />
          <Skeleton style={styles.skeleton} />
        </View>
      ) : null}

      {query.isError ? (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>We could not load these tasks.</Text>
          <Button variant="secondary" onPress={() => void query.refetch()}>
            Try again
          </Button>
        </View>
      ) : null}

      {!loading && !query.isError && tasks.length === 0 && suggestions === null && !extract.isPending ? (
        <View style={styles.empty}>
          <Sparkles size={28} color={colors.mutedForeground} />
          <Text style={styles.emptyText}>
            No tasks yet. Add one yourself, or use Find tasks to look for actions in your note.
          </Text>
        </View>
      ) : null}

      {openTasks.length > 0 ? (
        <View style={styles.list}>
          {openTasks.map((task) => (
            <Animated.View
              key={task.id}
              layout={LinearTransition.duration(220)}
              entering={FadeInDown.duration(180)}
              exiting={FadeOutUp.duration(140)}
            >
            <TaskCard
              task={task}
              showNoteLink={false}
              flashKey={flash?.id === task.id ? flash.key : undefined}
              onStatusChange={(next) => changeStatus(task, next)}
              onOpen={() => setTaskDialog({ open: true, task })}
            />
            </Animated.View>
          ))}
        </View>
      ) : null}

      {doneTasks.length > 0 ? (
        <View>
          <Pressable onPress={() => setShowDone((value) => !value)} style={styles.doneToggle}>
            <Text style={styles.doneLabel}>
              Done {doneTasks.length}
            </Text>
          </Pressable>
          {(showDone || openTasks.length === 0) &&
            doneTasks.map((task) => (
              <Animated.View
                key={task.id}
                layout={LinearTransition.duration(220)}
                entering={FadeInDown.duration(180)}
                exiting={FadeOutUp.duration(140)}
              >
                <TaskCard
                  task={task}
                  showNoteLink={false}
                  onStatusChange={(next) => changeStatus(task, next)}
                  onOpen={() => setTaskDialog({ open: true, task })}
                />
              </Animated.View>
            ))}
        </View>
      ) : null}

      {noteId ? (
        <LinkTaskSheet
          open={linkOpen}
          noteId={noteId}
          excludeIds={tasks.map((task) => task.id)}
          onClose={() => setLinkOpen(false)}
          onLink={linkTask}
        />
      ) : null}

      <QuickAddTask
        open={quickAddOpen}
        onClose={() => setQuickAddOpen(false)}
        projects={projects}
        defaultProjectId={commonProjectId(tasks) ?? projects[0]?.id ?? null}
        onCreateProject={async (name) => (await createProject.mutateAsync({ name })).project}
        onSubmit={addTask}
      />

      <TaskSheet
        open={taskDialog.open}
        onClose={() => setTaskDialog((state) => ({ ...state, open: false }))}
        task={taskDialog.task}
        projects={projects}
        defaultProjectId={commonProjectId(tasks)}
        onSave={saveTask}
        onDelete={
          taskDialog.task
            ? async () => {
                await remove.mutateAsync({ id: taskDialog.task!.id });
              }
            : undefined
        }
        onCreateProject={async (name) => (await createProject.mutateAsync({ name })).project}
        startPanel="actions"
        onMarkedDone={showFinished}
        onStartFocus={
          taskDialog.task
            ? () => {
                const id = taskDialog.task!.id;
                setTaskDialog((state) => ({ ...state, open: false }));
                router.push(`/focus/${id}`);
              }
            : undefined
        }
        onNotes={
          taskDialog.task
            ? () => {
                const id = taskDialog.task!.id;
                setTaskDialog((state) => ({ ...state, open: false }));
                afterSheet.later(() => router.push(`/task/${id}`));
              }
            : undefined
        }
        onLinkNote={
          taskDialog.task
            ? () => {
                const id = taskDialog.task!.id;
                setTaskDialog((state) => ({ ...state, open: false }));
                afterSheet.later(() => router.push(`/task/${id}?link=1`));
              }
            : undefined
        }
        onUnlink={
          taskDialog.task && noteId
            ? () => {
                const id = taskDialog.task!.id;
                setTaskDialog((state) => ({ ...state, open: false }));
                link.mutate(
                  { taskId: id, noteId, linked: false },
                  {
                    onSuccess: () => toast.show("Removed from this note. It is still in Life Center."),
                    onError: () => toast.show("That task could not be removed. Please try again."),
                  },
                );
              }
            : undefined
        }
        onExited={afterSheet.run}
      />

      {/* Sits near the top of the section, where the add button is, rather
          than centred in a section that may run well past the screen. */}
      <TaskAddedOverlay
        visible={added !== null}
        projectName={added?.projectName ?? ""}
        style={styles.addedOverlay}
      />
      <TaskAddedOverlay
        visible={finished !== null}
        kind="done"
        taskText={finished?.text ?? ""}
        style={styles.addedOverlay}
      />
    </View>
  );
}

function makeStyles(colors: Colors, scale: number) {
  return StyleSheet.create({
    section: { gap: spacing[3], paddingBottom: spacing[8] },
    addedOverlay: { justifyContent: "flex-start", paddingTop: spacing[12] },
    title: { fontFamily: fonts.display, fontSize: textSize.title * scale, color: colors.foreground },
    subtitle: { fontFamily: fonts.base, fontSize: textSize.body * scale, color: colors.mutedForeground },
    actions: { flexDirection: "row", flexWrap: "wrap", gap: spacing[2] },
    changed: { fontFamily: fonts.base, fontSize: textSize.small * scale, color: colors.warning },
    intro: { fontFamily: fonts.base, fontSize: textSize.body * scale, color: colors.foreground },
    box: {
      backgroundColor: colors.surface,
      borderRadius: radius.md,
      padding: spacing[4],
      gap: spacing[3],
    },
    suggestion: { flexDirection: "row", gap: spacing[3], alignItems: "flex-start" },
    check: {
      width: 22,
      height: 22,
      borderRadius: 6,
      borderWidth: 2,
      borderColor: colors.primary,
      marginTop: 2,
    },
    checkOn: { backgroundColor: colors.primary },
    flex: { flex: 1 },
    suggestionText: { fontFamily: fonts.baseSemi, fontSize: textSize.body * scale, color: colors.foreground },
    meta: { flexDirection: "row", gap: spacing[2], marginTop: 4 },
    chip: { fontFamily: fonts.base, fontSize: textSize.small * scale, color: colors.mutedForeground },
    due: { flexDirection: "row", alignItems: "center", gap: 4 },
    // Rows share hairlines, so no gap between them.
    list: {},
    skeleton: { height: 72 },
    empty: { alignItems: "center", gap: spacing[3], paddingVertical: spacing[6] },
    emptyText: {
      fontFamily: fonts.base,
      fontSize: textSize.body * scale,
      color: colors.mutedForeground,
      textAlign: "center",
    },
    doneToggle: { paddingVertical: spacing[2] },
    doneLabel: { fontFamily: fonts.baseSemi, fontSize: textSize.body * scale, color: colors.mutedForeground },
  });
}
