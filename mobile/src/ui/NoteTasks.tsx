import React, { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { CalendarDays, Sparkles } from "lucide-react-native";
import { fonts, radius, spacing, type Colors } from "../theme";
import { useAppTheme } from "../providers/AppThemeProvider";
import { useToast } from "../providers/ToastProvider";
import { useTasks } from "../hooks/useTasks";
import { formatDue } from "../lib/taskDates";
import { sortProjects, sortTasks } from "../lib/taskSort";
import type { SuggestedTask, TaskRecord, TaskStatus } from "../types";
import { Button } from "./Button";
import { Skeleton } from "./Skeleton";
import { TaskCard } from "./TaskCard";
import { TaskSheet, type TaskDraft } from "./TaskSheet";

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

export function NoteTasks({ noteId, enabled }: { noteId: string | null; enabled: boolean }) {
  const toast = useToast();
  const { colors, scale } = useAppTheme();
  const styles = useMemo(() => makeStyles(colors, scale), [colors, scale]);
  const { query, extract, addSuggested, create, update, remove, createProject } = useTasks(
    noteId ?? undefined,
    enabled && Boolean(noteId),
  );
  const attemptedRef = useRef(false);
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

  const runExtract = () => {
    if (!noteId) return;
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
    extractRef.current(
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
    );
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
    if (taskDialog.task) {
      await update.mutateAsync({
        id: taskDialog.task.id,
        text: draft.text,
        projectId: draft.projectId,
        completeBy: draft.completeBy,
        status: draft.status,
      });
    } else {
      await create.mutateAsync({
        text: draft.text,
        projectId: draft.projectId,
        completeBy: draft.completeBy,
        status: draft.status,
        noteId,
      });
      toast.show("Task added");
    }
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
          onPress={runExtract}
          disabled={extract.isPending || loading || adding}
        >
          {extract.isPending ? "Looking…" : "Find tasks"}
        </Button>
        <Button size="sm" onPress={() => setTaskDialog({ open: true, task: null })} disabled={loading}>
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
                      <Text style={styles.chip}>{item.projectName}</Text>
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
            <TaskCard
              key={task.id}
              task={task}
              showNoteLink={false}
              onStatusChange={(next) => changeStatus(task, next)}
              onEdit={() => setTaskDialog({ open: true, task })}
              onDelete={async () => {
                await remove.mutateAsync({ id: task.id });
              }}
            />
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
              <View key={task.id} style={{ marginBottom: spacing[2] }}>
                <TaskCard
                  task={task}
                  showNoteLink={false}
                  onStatusChange={(next) => changeStatus(task, next)}
                  onEdit={() => setTaskDialog({ open: true, task })}
                  onDelete={async () => {
                    await remove.mutateAsync({ id: task.id });
                  }}
                />
              </View>
            ))}
        </View>
      ) : null}

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
      />
    </View>
  );
}

function makeStyles(colors: Colors, scale: number) {
  return StyleSheet.create({
    section: { gap: spacing[3], paddingBottom: spacing[8] },
    title: { fontFamily: fonts.display, fontSize: 22 * scale, color: colors.foreground },
    subtitle: { fontFamily: fonts.base, fontSize: 15 * scale, color: colors.mutedForeground },
    actions: { flexDirection: "row", flexWrap: "wrap", gap: spacing[2] },
    changed: { fontFamily: fonts.base, fontSize: 14 * scale, color: colors.warning },
    intro: { fontFamily: fonts.base, fontSize: 15 * scale, color: colors.foreground },
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
    suggestionText: { fontFamily: fonts.baseSemi, fontSize: 16 * scale, color: colors.foreground },
    meta: { flexDirection: "row", gap: spacing[2], marginTop: 4 },
    chip: { fontFamily: fonts.base, fontSize: 13 * scale, color: colors.mutedForeground },
    due: { flexDirection: "row", alignItems: "center", gap: 4 },
    list: { gap: spacing[2] },
    skeleton: { height: 72 },
    empty: { alignItems: "center", gap: spacing[3], paddingVertical: spacing[6] },
    emptyText: {
      fontFamily: fonts.base,
      fontSize: 16 * scale,
      color: colors.mutedForeground,
      textAlign: "center",
    },
    doneToggle: { paddingVertical: spacing[2] },
    doneLabel: { fontFamily: fonts.baseSemi, fontSize: 15 * scale, color: colors.mutedForeground },
  });
}
