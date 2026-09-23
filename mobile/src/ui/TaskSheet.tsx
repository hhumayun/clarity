import DateTimePicker, {
  type DateTimePickerEvent,
} from "@react-native-community/datetimepicker";
import {
  CalendarDays,
  ChevronLeft,
  CircleCheck,
  Pencil,
  Plus,
  RotateCcw,
  Timer,
} from "lucide-react-native";
import React, { useEffect, useMemo, useState } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import Animated from "react-native-reanimated";
import { fadeInFast } from "./motion";
import { atNoon, daysFromToday, formatShortDate, isSameDay, nextWeekend } from "../lib/dates";
import { hapticDone, hapticUndone } from "../lib/haptics";
import { areaColor } from "../lib/lifeCenter";
import { formatDue } from "../lib/taskDates";
import { useAppTheme } from "../providers/AppThemeProvider";
import { fonts, radius, spacing, type Colors } from "../theme";
import {
  type ProjectRecord,
  type TaskRecord,
  type TaskStatus,
} from "../types";
import { Button } from "./Button";
import { ConfirmModal } from "./ConfirmModal";
import { Input } from "./Input";
import { Sheet } from "./Sheet";
import { TextArea } from "./TextArea";

export type TaskDraft = {
  text: string;
  projectId: string | null;
  completeBy: Date | null;
  status: TaskStatus;
};

type Props = {
  open: boolean;
  onClose: () => void;
  task?: TaskRecord | null;
  projects: ProjectRecord[];
  defaultProjectId?: string | null;
  onSave: (draft: TaskDraft) => Promise<void>;
  onDelete?: () => Promise<void>;
  onCreateProject: (name: string) => Promise<ProjectRecord>;
  /**
   * "actions" opens an existing task on its action panel (Start focus time,
   * Mark done, Move to another day, Edit task), which replaces the old "…"
   * menu. "task" opens straight on the edit form.
   */
  startPanel?: "task" | "actions";
  /** Shows Start focus time on the action panel. */
  onStartFocus?: () => void;
  /** Called once Mark done has saved, so the screen can confirm it. */
  onMarkedDone?: (task: TaskRecord) => void;
};

/**
 * Which face of the sheet is showing. Deliberately one sheet with three
 * faces rather than sheets opened on top of each other: on iOS a second
 * Modal presented over a first is fragile, and the failure mode is a screen
 * that still looks right but answers no touches.
 */
type Panel = "actions" | "move" | "task" | "project" | "date";

function draftFrom(
  task: TaskRecord | null | undefined,
  defaultProjectId: string | null | undefined,
  projects: ProjectRecord[],
): TaskDraft {
  if (task) {
    return {
      text: task.text,
      projectId: task.projectId,
      completeBy: task.completeBy,
      status: task.status,
    };
  }
  return {
    text: "",
    projectId: defaultProjectId ?? projects[0]?.id ?? null,
    completeBy: null,
    status: "todo",
  };
}

function addDays(days: number): Date {
  const date = new Date();
  date.setDate(date.getDate() + days);
  date.setHours(12, 0, 0, 0);
  return date;
}

export function TaskSheet({
  open,
  onClose,
  task,
  projects,
  defaultProjectId,
  onSave,
  onDelete,
  onCreateProject,
  startPanel = "task",
  onStartFocus,
  onMarkedDone,
}: Props) {
  const { colors, scale, dark } = useAppTheme();
  const styles = useMemo(() => makeStyles(colors, scale), [colors, scale]);
  const [draft, setDraft] = useState<TaskDraft>(() =>
    draftFrom(task, defaultProjectId, projects),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [newProject, setNewProject] = useState("");
  const [creatingProject, setCreatingProject] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [panel, setPanel] = useState<Panel>("task");
  const [movePickerOpen, setMovePickerOpen] = useState(false);
  const editing = Boolean(task);
  // Where "back" goes from a sub-face: the panel the sheet opened on.
  const home: Panel = task && startPanel === "actions" ? "actions" : "task";

  useEffect(() => {
    if (open) {
      setDraft(draftFrom(task, defaultProjectId, projects));
      setError("");
      setNewProject("");
      setPanel(task && startPanel === "actions" ? "actions" : "task");
      setMovePickerOpen(false);
    }
  }, [open, task?.id, defaultProjectId, projects, startPanel]);

  // The quick options, and whether completeBy is a day none of them covers.
  const shortcuts = [
    { label: "No date", value: null as Date | null },
    { label: "Today", value: addDays(0) },
    { label: "Tomorrow", value: addDays(1) },
    { label: "Next week", value: addDays(7) },
  ];
  const customDate =
    draft.completeBy &&
    !shortcuts.some((option) => isSameDay(option.value, draft.completeBy))
      ? draft.completeBy
      : null;

  const canSave = draft.text.trim().length > 0 && Boolean(draft.projectId) && !saving;

  const save = async () => {
    if (!canSave) return;
    setSaving(true);
    setError("");
    try {
      await onSave({ ...draft, text: draft.text.trim().replace(/\s+/g, " ") });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "That task could not be saved. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const addProject = async () => {
    const name = newProject.trim().replace(/\s+/g, " ");
    if (!name) return;
    setCreatingProject(true);
    try {
      const project = await onCreateProject(name);
      setDraft((current) => ({ ...current, projectId: project.id }));
      setNewProject("");
      setPanel("task");
    } catch (err) {
      setError(err instanceof Error ? err.message : "That project could not be added.");
      setPanel("task");
    } finally {
      setCreatingProject(false);
    }
  };

  const setDate = (date: Date | null) => setDraft((current) => ({ ...current, completeBy: date }));

  // Save one change straight from the action panel, without the edit form.
  const commit = async (change: Partial<TaskDraft>) => {
    if (!task || saving) return;
    setSaving(true);
    setError("");
    try {
      await onSave({ ...draftFrom(task, defaultProjectId, projects), ...change });
      onClose();
      if (change.status === "done" && task.status !== "done") {
        hapticDone();
        onMarkedDone?.(task);
      } else if (change.status && change.status !== "done" && task.status === "done") {
        hapticUndone();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "That change could not be saved. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const handleMovePicked = (event: DateTimePickerEvent, date?: Date) => {
    setMovePickerOpen(false);
    if (event.type === "dismissed" || !date) return;
    void commit({ completeBy: atNoon(date.getFullYear(), date.getMonth(), date.getDate()) });
  };

  const handlePicked = (event: DateTimePickerEvent, date?: Date) => {
    if (event.type === "dismissed") {
      setPanel("task");
      return;
    }
    // Midday, matching the quick options, so a stored day cannot slide
    // backwards across a timezone.
    if (date) setDate(atNoon(date.getFullYear(), date.getMonth(), date.getDate()));
    // Android's picker is a dialog of its own and closes itself; iOS shows a
    // calendar inline, so it stays until Done.
    if (Platform.OS !== "ios") setPanel("task");
  };

  const titles: Record<Panel, { title: string; description?: string }> = {
    actions: { title: task?.text ?? "" },
    move: { title: "Move to another day" },
    task: {
      title: editing ? "Edit task" : "Add a task",
      description: "Keep it short. You can always change it later.",
    },
    project: {
      title: "Add a project",
      description: "A short name is easiest to recognise later.",
    },
    date: { title: "Pick a date" },
  };

  return (
    <>
      <Sheet
        open={open}
        title={titles[panel].title}
        description={titles[panel].description}
        eyebrow={
          panel === "actions" && task ? (
            <View style={styles.eyebrowRow}>
              <View style={[styles.dot, { backgroundColor: areaColor(task.projectId) }]} />
              <Text style={styles.eyebrowText}>
                {task.projectName}
                {task.completeBy ? ` · ${formatDue(task.completeBy)}` : ""}
              </Text>
            </View>
          ) : undefined
        }
        onClose={panel === home ? onClose : () => setPanel(panel === "move" ? "actions" : "task")}
      >
        {/* Each face fades in as it replaces the last, while the sheet's
            height glides between them. */}
        <Animated.View key={panel} entering={fadeInFast} style={styles.face}>
        {panel === "actions" && task ? (
          <>
            {onStartFocus && task.status !== "done" ? (
              <Pressable
                style={({ pressed }) => [styles.focusButton, pressed && styles.pressed]}
                onPress={onStartFocus}
                accessibilityRole="button"
                accessibilityLabel="Start focus time. Set aside a few minutes for just this"
              >
                <View style={styles.focusIcon}>
                  <Timer size={22} color={colors.primaryForeground} />
                </View>
                <View style={styles.flexShrink}>
                  <Text style={styles.focusTitle}>Start focus time</Text>
                  <Text style={styles.focusHint}>Set aside a few minutes for just this</Text>
                </View>
              </Pressable>
            ) : null}
            <View>
              <Pressable
                style={styles.actionRow}
                onPress={() => void commit({ status: task.status === "done" ? "todo" : "done" })}
                disabled={saving}
                accessibilityRole="button"
              >
                {task.status === "done" ? (
                  <RotateCcw size={20} color={colors.foreground} />
                ) : (
                  <CircleCheck size={20} color={colors.foreground} />
                )}
                <Text style={styles.actionText}>
                  {task.status === "done" ? "Mark not done" : "Mark done"}
                </Text>
              </Pressable>
              <Pressable
                style={[styles.actionRow, styles.actionDivider]}
                onPress={() => setPanel("move")}
                accessibilityRole="button"
              >
                <CalendarDays size={20} color={colors.foreground} />
                <Text style={styles.actionText}>Move to another day</Text>
              </Pressable>
              <Pressable
                style={[styles.actionRow, styles.actionDivider]}
                onPress={() => setPanel("task")}
                accessibilityRole="button"
              >
                <Pencil size={20} color={colors.foreground} />
                <Text style={styles.actionText}>Edit task</Text>
              </Pressable>
            </View>
            {error ? <Text style={styles.error}>{error}</Text> : null}
          </>
        ) : panel === "move" && task ? (
          <>
            <View style={styles.chips}>
              {[
                { label: "Today", value: daysFromToday(0) as Date | null },
                { label: "Tomorrow", value: daysFromToday(1) },
                { label: "Weekend", value: nextWeekend() },
                { label: "Next week", value: daysFromToday(7) },
                { label: "No date", value: null },
              ].map((option) => {
                const active =
                  option.value === null
                    ? task.completeBy === null
                    : isSameDay(option.value, task.completeBy);
                return (
                  <Pressable
                    key={option.label}
                    onPress={() => void commit({ completeBy: option.value })}
                    disabled={saving}
                    style={[styles.chip, active && styles.chipActive]}
                  >
                    <Text style={[styles.chipText, active && styles.chipTextActive]}>
                      {option.label}
                    </Text>
                  </Pressable>
                );
              })}
              <Pressable
                onPress={() => setMovePickerOpen(true)}
                style={[styles.chip, styles.chipWithIcon]}
                accessibilityLabel="Pick a date"
              >
                <CalendarDays size={14} color={colors.mutedForeground} />
                <Text style={styles.chipText}>Pick a date</Text>
              </Pressable>
            </View>
            {movePickerOpen ? (
              <View style={styles.picker}>
                <DateTimePicker
                  value={task.completeBy ?? new Date()}
                  mode="date"
                  display={Platform.OS === "ios" ? "inline" : "default"}
                  accentColor={colors.primary}
                  themeVariant={dark ? "dark" : "light"}
                  onChange={handleMovePicked}
                />
              </View>
            ) : null}
            {error ? <Text style={styles.error}>{error}</Text> : null}
            <Button variant="ghost" onPress={() => setPanel("actions")}>
              <ChevronLeft size={18} color={colors.foreground} />
              <Text style={styles.backText}>Back</Text>
            </Button>
          </>
        ) : panel === "task" ? (
          <>
            <Text style={styles.label}>What needs doing?</Text>
            <TextArea
              value={draft.text}
              onChangeText={(text) => setDraft((current) => ({ ...current, text }))}
              placeholder="For example, call Dr. Lee to book a check-up"
              maxLength={500}
            />

            <Text style={styles.label}>Project</Text>
            <View style={styles.chips}>
              {projects.map((project) => {
                const active = draft.projectId === project.id;
                return (
                  <Pressable
                    key={project.id}
                    onPress={() => setDraft((current) => ({ ...current, projectId: project.id }))}
                    style={[styles.chip, active && styles.chipActive]}
                  >
                    <Text style={[styles.chipText, active && styles.chipTextActive]}>
                      {project.name}
                    </Text>
                  </Pressable>
                );
              })}
              <Pressable
                onPress={() => {
                  setNewProject("");
                  setPanel("project");
                }}
                accessibilityLabel="Add a project"
                style={[styles.chip, styles.chipAdd]}
              >
                <Plus size={16} color={colors.mutedForeground} />
              </Pressable>
            </View>

            <Text style={styles.label}>Complete by</Text>
            <View style={styles.chips}>
              {shortcuts.map((option) => {
                const active =
                  option.value === null
                    ? draft.completeBy === null
                    : isSameDay(option.value, draft.completeBy);
                return (
                  <Pressable
                    key={option.label}
                    onPress={() => setDate(option.value)}
                    style={[styles.chip, active && styles.chipActive]}
                  >
                    <Text style={[styles.chipText, active && styles.chipTextActive]}>
                      {option.label}
                    </Text>
                  </Pressable>
                );
              })}
              {/* Shows the chosen day once it is one the shortcuts cannot
                  express, so a custom date is never invisible behind a
                  generic label. */}
              <Pressable
                onPress={() => setPanel("date")}
                accessibilityLabel={
                  customDate ? `Change date: ${formatShortDate(customDate)}` : "Pick a date"
                }
                style={[styles.chip, styles.chipWithIcon, customDate && styles.chipActive]}
              >
                <CalendarDays
                  size={14}
                  color={customDate ? colors.accentForeground : colors.mutedForeground}
                />
                <Text style={[styles.chipText, customDate && styles.chipTextActive]}>
                  {customDate ? formatShortDate(customDate) : "Pick a date"}
                </Text>
              </Pressable>
            </View>

            {error ? <Text style={styles.error}>{error}</Text> : null}

            <Button size="lg" loading={saving} disabled={!canSave} onPress={() => void save()}>
              {editing ? "Save changes" : "Add task"}
            </Button>
            {onDelete ? (
              <Button variant="ghost" onPress={() => setConfirmingDelete(true)}>
                Delete task
              </Button>
            ) : null}
          </>
        ) : panel === "project" ? (
          <>
            <Input
              value={newProject}
              onChangeText={setNewProject}
              placeholder="For example, Health"
              autoFocus
              maxLength={100}
              returnKeyType="done"
              onSubmitEditing={() => void addProject()}
            />
            <Button
              size="lg"
              loading={creatingProject}
              disabled={!newProject.trim()}
              onPress={() => void addProject()}
            >
              Add project
            </Button>
            <Button variant="ghost" onPress={() => setPanel("task")}>
              <ChevronLeft size={18} color={colors.foreground} />
              <Text style={styles.backText}>Back to the task</Text>
            </Button>
          </>
        ) : (
          <>
            {/* On Android this renders its own dialog rather than anything
                inline, so the panel behind it stays empty for a moment. */}
            <View style={styles.picker}>
              <DateTimePicker
                value={draft.completeBy ?? new Date()}
                mode="date"
                display={Platform.OS === "ios" ? "inline" : "default"}
                accentColor={colors.primary}
                themeVariant={dark ? "dark" : "light"}
                onChange={handlePicked}
              />
            </View>
            {Platform.OS === "ios" ? (
              <>
                <Button size="lg" onPress={() => setPanel("task")}>
                  Done
                </Button>
                <Button
                  variant="secondary"
                  onPress={() => {
                    setDate(null);
                    setPanel("task");
                  }}
                >
                  Clear date
                </Button>
              </>
            ) : null}
          </>
        )}
        </Animated.View>
      </Sheet>

      <ConfirmModal
        open={confirmingDelete}
        title="Delete this task?"
        description="It will stay hidden even if you refresh tasks from the note it came from."
        confirmLabel="Delete"
        destructive
        loading={deleting}
        onClose={() => setConfirmingDelete(false)}
        onConfirm={() => {
          setDeleting(true);
          void onDelete?.()
            .then(() => {
              setConfirmingDelete(false);
              onClose();
            })
            .finally(() => setDeleting(false));
        }}
      />
    </>
  );
}

function makeStyles(colors: Colors, scale: number) {
  return StyleSheet.create({
    label: {
      fontFamily: fonts.baseSemi,
      fontSize: 15 * scale,
      color: colors.foreground,
    },
    chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing[2] },
    chip: {
      borderRadius: radius.full,
      borderWidth: 1,
      borderColor: colors.border,
      paddingHorizontal: spacing[3],
      paddingVertical: spacing[2],
      backgroundColor: colors.surface,
    },
    chipActive: { backgroundColor: colors.accent, borderColor: colors.primary },
    chipText: {
      fontFamily: fonts.base,
      fontSize: 14 * scale,
      color: colors.mutedForeground,
    },
    chipTextActive: { color: colors.accentForeground, fontFamily: fonts.baseSemi },
    chipWithIcon: { flexDirection: "row", alignItems: "center", gap: spacing[1] },
    chipAdd: { paddingHorizontal: spacing[3], borderStyle: "dashed" },
    // The inline calendar draws its own padding; this just keeps it off the
    // sheet's edges on narrow screens.
    picker: { marginHorizontal: -spacing[2] },
    face: { gap: spacing[4] },
    eyebrowRow: { flexDirection: "row", alignItems: "center", gap: spacing[2] },
    eyebrowText: { fontFamily: fonts.base, fontSize: 14 * scale, color: colors.mutedForeground },
    dot: { width: 8, height: 8, borderRadius: 4 },
    pressed: { opacity: 0.85 },
    flexShrink: { flexShrink: 1 },
    focusButton: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing[3],
      borderRadius: radius.md,
      backgroundColor: colors.primary,
      paddingHorizontal: spacing[4],
      paddingVertical: spacing[4],
    },
    focusIcon: {
      width: 44,
      height: 44,
      borderRadius: 22,
      backgroundColor: "rgba(0,0,0,0.12)",
      alignItems: "center",
      justifyContent: "center",
    },
    focusTitle: { fontFamily: fonts.baseBold, fontSize: 18 * scale, color: colors.primaryForeground },
    focusHint: { fontFamily: fonts.base, fontSize: 14 * scale, color: colors.primaryForeground, opacity: 0.85 },
    actionRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing[3],
      paddingVertical: spacing[4],
    },
    actionDivider: { borderTopWidth: 1, borderTopColor: colors.border },
    actionText: { fontFamily: fonts.base, fontSize: 17 * scale, color: colors.foreground },
    backText: {
      fontFamily: fonts.baseSemi,
      fontSize: 15 * scale,
      color: colors.foreground,
    },
    error: {
      fontFamily: fonts.base,
      fontSize: 14 * scale,
      color: colors.error,
    },
  });
}
