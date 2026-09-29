import DateTimePicker, {
  type DateTimePickerEvent,
} from "@react-native-community/datetimepicker";
import {
  Check,
  ChevronDown,
  FileText,
  Link2,
  Unlink,
  ChevronLeft,
  CalendarDays,
  CircleCheck,
  Pencil,
  Plus,
  RotateCcw,
  Trash2,
} from "lucide-react-native";
import React, { useEffect, useMemo, useState } from "react";
import { Platform, Pressable, StyleSheet, Text, TextInput, useWindowDimensions, View } from "react-native";
import Animated from "react-native-reanimated";
import { fadeInFast } from "./motion";
import { atNoon, dateChipLabel, dueDayOptions, isSameDay } from "../lib/dates";
import { hapticDone, hapticUndone } from "../lib/haptics";
import { areaTag } from "../lib/lifeCenter";
import { linkedNoteIds } from "../lib/taskLinks";
import { useAppTheme } from "../providers/AppThemeProvider";
import { fonts, radius, spacing, type Colors, textSize } from "../theme";
import {
  type ProjectRecord,
  type TaskRecord,
  type TaskStatus,
} from "../types";
import { Button } from "./Button";
import { Input } from "./Input";
import { PomodoroBadge } from "./PomodoroBadge";
import { Sheet } from "./Sheet";
import { TextArea } from "./TextArea";

export type TaskDraft = {
  text: string;
  /**
   * Only the edit form sends this. The quick actions (Mark done, Move) leave
   * it out, so they can never blank a description they did not show.
   */
  description?: string;
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
  startPanel?: "task" | "actions" | "move";
  /** Shows Start focus time on the action panel. */
  onStartFocus?: () => void;
  /** Called once Mark done has saved, so the screen can confirm it. */
  onMarkedDone?: (task: TaskRecord) => void;
  /** Shows "Notes" on the action panel: the task's linked notes and summary. */
  onNotes?: () => void;
  /** Shows "Link a note" on the action panel. */
  onLinkNote?: () => void;
  /** Shows "Remove from this note", when opened from a note's tasks. */
  onUnlink?: () => void;
  /** Once the sheet has fully gone; anything that presents next waits for it. */
  onExited?: () => void;
};

/**
 * Which face of the sheet is showing. Deliberately one sheet with faces
 * rather than sheets opened on top of each other: on iOS a second Modal
 * presented over a first is fragile, and the failure mode is a screen that
 * still looks right but answers no touches. That includes confirming a
 * delete, which once opened a dialog over the sheet and froze the screen
 * behind it after both closed.
 */
type Panel = "actions" | "move" | "task" | "chooseProject" | "project" | "date" | "confirmDelete";

function draftFrom(
  task: TaskRecord | null | undefined,
  defaultProjectId: string | null | undefined,
  projects: ProjectRecord[],
): TaskDraft {
  if (task) {
    return {
      text: task.text,
      description: task.description ?? "",
      projectId: task.projectId,
      completeBy: task.completeBy,
      status: task.status,
    };
  }
  return {
    text: "",
    description: "",
    projectId: defaultProjectId ?? projects[0]?.id ?? null,
    completeBy: null,
    status: "todo",
  };
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
  onNotes,
  onLinkNote,
  onUnlink,
  onExited,
}: Props) {
  const { colors, scale, dark } = useAppTheme();
  const styles = useMemo(() => makeStyles(colors, scale), [colors, scale]);
  const { height: windowHeight } = useWindowDimensions();
  const [draft, setDraft] = useState<TaskDraft>(() =>
    draftFrom(task, defaultProjectId, projects),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [newProject, setNewProject] = useState("");
  const [creatingProject, setCreatingProject] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [panel, setPanel] = useState<Panel>("task");
  const [movePickerOpen, setMovePickerOpen] = useState(false);
  // Android's calendar is a dialog of its own, opened from the date page.
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  const editing = Boolean(task);
  const noteCount = task ? linkedNoteIds(task).length : 0;
  // Where "back" goes from a sub-face: the panel the sheet opened on.
  // "move" opens straight on Move to another day (e.g. from a task's menu).
  const home: Panel = task && (startPanel === "actions" || startPanel === "move") ? startPanel : "task";

  useEffect(() => {
    if (open) {
      setDraft(draftFrom(task, defaultProjectId, projects));
      setError("");
      setNewProject("");
      setPanel(task && (startPanel === "actions" || startPanel === "move") ? startPanel : "task");
      setMovePickerOpen(false);
      setDatePickerOpen(false);
    }
  }, [open, task?.id, defaultProjectId, projects, startPanel]);

  const projectName =
    projects.find((project) => project.id === draft.projectId)?.name ??
    (task && task.projectId === draft.projectId ? task.projectName : null);

  const canSave = draft.text.trim().length > 0 && Boolean(draft.projectId) && !saving;

  const save = async () => {
    if (!canSave) return;
    setSaving(true);
    setError("");
    try {
      await onSave({
        ...draft,
        text: draft.text.trim().replace(/\s+/g, " "),
        description: (draft.description ?? "").trim(),
      });
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
      setPanel("chooseProject");
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
      // Everything but the description, which this path never showed.
      const { description: _unshown, ...current } = draftFrom(task, defaultProjectId, projects);
      await onSave({ ...current, ...change });
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

  // A day chosen on the date page goes straight back to the task.
  const chooseDate = (date: Date | null) => {
    setDate(date);
    setPanel("task");
  };

  const handlePicked = (event: DateTimePickerEvent, date?: Date) => {
    setDatePickerOpen(false);
    if (event.type === "dismissed" || !date) return;
    // Midday, matching the quick options, so a stored day cannot slide
    // backwards across a timezone.
    chooseDate(atNoon(date.getFullYear(), date.getMonth(), date.getDate()));
  };

  const titles: Record<Panel, { title: string; description?: string }> = {
    actions: { title: task?.text ?? "" },
    move: { title: "Move to another day" },
    // Drawn as the task's own text, editable, in the title's place.
    task: { title: draft.text || (editing ? "Edit task" : "Add a task") },
    chooseProject: { title: "Project" },
    project: {
      title: "New project",
      description: "A short name is easiest to recognise later.",
    },
    date: { title: "Due date" },
    confirmDelete: {
      title: "Delete this task?",
      description: "It will stay hidden even if you refresh tasks from the note it came from.",
    },
  };

  return (
    <>
      <Sheet
        open={open}
        title={titles[panel].title}
        titleInput={
          panel === "task" ? (
            <TextInput
              value={draft.text}
              // One line of task: a return finishes it rather than breaking it.
              onChangeText={(text) => setDraft((current) => ({ ...current, text: text.replace(/\n/g, " ") }))}
              placeholder="New task"
              placeholderTextColor={colors.mutedForeground}
              multiline
              scrollEnabled={false}
              submitBehavior="blurAndSubmit"
              returnKeyType="done"
              maxLength={500}
              style={styles.titleInput}
              accessibilityLabel="Task"
            />
          ) : undefined
        }
        description={titles[panel].description}
        // The ×, a drag down or a tap outside closes the whole sheet. Android's
        // back button steps back a page: to the actions from Move or Edit,
        // and to the form from a project, a date or the delete confirmation.
        onClose={onClose}
        onBack={
          panel === home
            ? onClose
            : () =>
                setPanel(
                  panel === "move" || panel === "task"
                    ? "actions"
                    : panel === "project"
                      ? "chooseProject"
                      : panel === "confirmDelete"
                        ? "actions"
                        : "task",
                )
        }
        // The edit page gives its title, the task, the whole width.
        showClose={panel !== "task"}
        onExited={onExited}
      >
        {/* Each face fades in as it replaces the last, while the sheet's
            height glides between them. */}
        <Animated.View key={panel} entering={fadeInFast} style={styles.face}>
        {panel === "actions" && task ? (
          <>
            {onStartFocus && task.status !== "done" ? (
              <Pressable
                style={({ pressed }) => [styles.focusButton, pressed && styles.focusPressed]}
                onPress={onStartFocus}
                accessibilityRole="button"
                accessibilityLabel="Start focus time. Set aside a few minutes for just this"
              >
                {/* Grows with the text size, so it stays in proportion. */}
                <PomodoroBadge size={Math.round(44 * scale)} />
                <View style={styles.flexShrink}>
                  <Text style={styles.focusTitle} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.85}>
                    Start focus time
                  </Text>
                  <Text style={styles.focusHint} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75}>
                    Set aside a few minutes for just this
                  </Text>
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
              {onNotes ? (
                <Pressable
                  style={[styles.actionRow, styles.actionDivider]}
                  onPress={onNotes}
                  accessibilityRole="button"
                  accessibilityLabel={`Notes, ${noteCount}. See this task's notes and how it is going`}
                >
                  <FileText size={20} color={colors.foreground} />
                  <Text style={[styles.actionText, styles.flexShrink]}>Notes</Text>
                  <View style={styles.flexFill} />
                  <Text style={styles.actionCount}>{noteCount}</Text>
                </Pressable>
              ) : null}
              {onLinkNote ? (
                <Pressable
                  style={[styles.actionRow, styles.actionDivider]}
                  onPress={onLinkNote}
                  accessibilityRole="button"
                >
                  <Link2 size={20} color={colors.foreground} />
                  <Text style={styles.actionText}>Link a note</Text>
                </Pressable>
              ) : null}
              {onUnlink ? (
                <Pressable
                  style={[styles.actionRow, styles.actionDivider]}
                  onPress={onUnlink}
                  accessibilityRole="button"
                  accessibilityHint="The task stays in Life Center and in any other notes"
                >
                  <Unlink size={20} color={colors.foreground} />
                  <Text style={styles.actionText}>Remove from this note</Text>
                </Pressable>
              ) : null}
              {onDelete ? (
                // Last, away from the rest, and it still asks first.
                <Pressable
                  style={[styles.actionRow, styles.actionDivider]}
                  onPress={() => {
                    setError("");
                    setPanel("confirmDelete");
                  }}
                  accessibilityRole="button"
                >
                  <Trash2 size={20} color={colors.error} />
                  <Text style={[styles.actionText, styles.deleteText]}>Delete task</Text>
                </Pressable>
              ) : null}
            </View>
            {error ? <Text style={styles.error}>{error}</Text> : null}
          </>
        ) : panel === "move" && task ? (
          <>
            <View style={styles.chips}>
              {dueDayOptions().map((option) => {
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
            {/* One line to start, growing as it is written in; past a third
                of the screen it scrolls inside itself. */}
            <TextArea
              value={draft.description ?? ""}
              onChangeText={(description) => setDraft((current) => ({ ...current, description }))}
              placeholder="Add a description"
              maxLength={5000}
              style={[styles.description, { maxHeight: Math.round(windowHeight / 3) }]}
              accessibilityLabel="Description"
            />

            {/* Just what is chosen; each opens its own page of choices. */}
            <View style={styles.chips}>
              <Pressable
                onPress={() => setPanel("chooseProject")}
                style={({ pressed }) => [styles.pick, pressed && styles.pickPressed]}
                accessibilityRole="button"
                accessibilityLabel={projectName ? `Project: ${projectName}. Change project` : "Choose a project"}
              >
                <Text style={styles.pickText} numberOfLines={1}>
                  {projectName ? areaTag(projectName) : "Choose a project"}
                </Text>
                <ChevronDown size={15} color={colors.mutedForeground} />
              </Pressable>
              <Pressable
                onPress={() => setPanel("date")}
                style={({ pressed }) => [styles.pick, pressed && styles.pickPressed]}
                accessibilityRole="button"
                accessibilityLabel={
                  draft.completeBy ? `Due ${dateChipLabel(draft.completeBy)}. Change date` : "No date. Set a date"
                }
              >
                <CalendarDays size={15} color={draft.completeBy ? colors.foreground : colors.mutedForeground} />
                <Text style={[styles.pickText, !draft.completeBy && styles.pickTextEmpty]}>
                  {draft.completeBy ? dateChipLabel(draft.completeBy) : "No date"}
                </Text>
                <ChevronDown size={15} color={colors.mutedForeground} />
              </Pressable>
            </View>

            {error ? <Text style={styles.error}>{error}</Text> : null}

            <Button size="lg" loading={saving} disabled={!canSave} onPress={() => void save()}>
              {editing ? "Save changes" : "Add task"}
            </Button>
          </>
        ) : panel === "chooseProject" ? (
          <>
            <View>
              {projects.map((project, index) => {
                const active = draft.projectId === project.id;
                return (
                  <Pressable
                    key={project.id}
                    onPress={() => {
                      setDraft((current) => ({ ...current, projectId: project.id }));
                      setPanel("task");
                    }}
                    style={({ pressed }) => [
                      styles.optionRow,
                      index > 0 && styles.actionDivider,
                      pressed && styles.pickPressed,
                    ]}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                    accessibilityLabel={project.name}
                  >
                    <Text style={[styles.optionText, active && styles.optionTextActive]} numberOfLines={1}>
                      {areaTag(project.name)}
                    </Text>
                    {active ? <Check size={20} color={colors.primary} /> : null}
                  </Pressable>
                );
              })}
              <Pressable
                onPress={() => {
                  setNewProject("");
                  setPanel("project");
                }}
                style={({ pressed }) => [
                  styles.optionRow,
                  projects.length > 0 && styles.actionDivider,
                  pressed && styles.pickPressed,
                ]}
                accessibilityRole="button"
                accessibilityLabel="Add a new project"
              >
                <Plus size={20} color={colors.mutedForeground} />
                <Text style={[styles.optionText, styles.optionTextMuted]}>New project</Text>
              </Pressable>
            </View>
            {error ? <Text style={styles.error}>{error}</Text> : null}
          </>
        ) : panel === "confirmDelete" ? (
          <>
            {error ? <Text style={styles.error}>{error}</Text> : null}
            <Button
              variant="destructive"
              size="lg"
              loading={deleting}
              onPress={() => {
                if (!onDelete || deleting) return;
                setDeleting(true);
                setError("");
                onDelete()
                  .then(() => onClose())
                  .catch(() => setError("That task could not be deleted. Please try again."))
                  .finally(() => setDeleting(false));
              }}
            >
              Delete
            </Button>
            <Button variant="ghost" onPress={() => setPanel("actions")} disabled={deleting}>
              Cancel
            </Button>
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
            <Button variant="ghost" onPress={() => setPanel("chooseProject")}>
              <ChevronLeft size={18} color={colors.foreground} />
              <Text style={styles.backText}>Back</Text>
            </Button>
          </>
        ) : (
          <>
            <View style={styles.chips}>
              {dueDayOptions().map((option) => {
                const active =
                  option.value === null
                    ? draft.completeBy === null
                    : isSameDay(option.value, draft.completeBy);
                return (
                  <Pressable
                    key={option.label}
                    onPress={() => chooseDate(option.value)}
                    style={[styles.chip, active && styles.chipActive]}
                  >
                    <Text style={[styles.chipText, active && styles.chipTextActive]}>
                      {option.label}
                    </Text>
                  </Pressable>
                );
              })}
              {Platform.OS === "ios" ? null : (
                <Pressable
                  onPress={() => setDatePickerOpen(true)}
                  style={[styles.chip, styles.chipWithIcon]}
                  accessibilityLabel="Pick a date"
                >
                  <CalendarDays size={14} color={colors.mutedForeground} />
                  <Text style={styles.chipText}>Pick a date</Text>
                </Pressable>
              )}
            </View>
            {/* iOS shows the calendar in the page: tapping a day chooses it.
                Android's is a dialog of its own, opened from the chip. */}
            {Platform.OS === "ios" || datePickerOpen ? (
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
            ) : null}
          </>
        )}
        </Animated.View>
      </Sheet>
    </>
  );
}

function makeStyles(colors: Colors, scale: number) {
  return StyleSheet.create({
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
      fontSize: textSize.small * scale,
      color: colors.mutedForeground,
    },
    chipTextActive: { color: colors.accentForeground, fontFamily: fonts.baseSemi },
    chipWithIcon: { flexDirection: "row", alignItems: "center", gap: spacing[1] },
    // The task's text, editable where the sheet's title would be.
    titleInput: {
      fontFamily: fonts.display,
      fontSize: textSize.title * scale,
      lineHeight: 28 * scale,
      color: colors.foreground,
      padding: 0,
      paddingTop: 0,
      paddingBottom: 0,
      margin: 0,
    },
    // The chosen project and day, each opening its page of choices.
    pick: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing[1],
      maxWidth: "100%",
      borderRadius: radius.full,
      borderWidth: 1,
      borderColor: colors.border,
      paddingLeft: spacing[3],
      paddingRight: spacing[2],
      paddingVertical: spacing[2],
      backgroundColor: colors.surface,
    },
    pickPressed: { opacity: 0.7 },
    pickText: { flexShrink: 1, fontFamily: fonts.baseSemi, fontSize: textSize.small * scale, color: colors.foreground },
    pickTextEmpty: { color: colors.mutedForeground, fontFamily: fonts.base },
    optionRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing[3],
      minHeight: 52,
    },
    optionText: { flex: 1, fontFamily: fonts.base, fontSize: textSize.body * scale, color: colors.foreground },
    optionTextActive: { fontFamily: fonts.baseSemi },
    optionTextMuted: { color: colors.mutedForeground },
    // The inline calendar draws its own padding; this just keeps it off the
    // sheet's edges on narrow screens.
    picker: { marginHorizontal: -spacing[2] },
    face: { gap: spacing[4] },
    deleteText: { color: colors.error },
    // Plain text under the title: no box, the task's own words above it.
    description: {
      minHeight: 0,
      borderWidth: 0,
      borderRadius: 0,
      backgroundColor: "transparent",
      paddingHorizontal: 0,
      paddingTop: 0,
      paddingBottom: 0,
      fontSize: textSize.body * scale,
      lineHeight: 23 * scale,
    },
    flexShrink: { flexShrink: 1 },
    focusButton: {
      flexDirection: "row",
      alignItems: "center",
      gap: 14,
      borderRadius: 19,
      backgroundColor: colors.primary,
      paddingTop: 18,
      paddingBottom: 18,
      paddingLeft: 16,
      paddingRight: 20,
    },
    focusPressed: { transform: [{ scale: 0.98 }] },
    focusTitle: {
      fontFamily: fonts.baseBold,
      fontSize: textSize.large * scale,
      lineHeight: 23 * scale,
      color: colors.primaryForeground,
    },
    focusHint: {
      fontFamily: fonts.base,
      fontSize: textSize.small * scale,
      lineHeight: 19 * scale,
      marginTop: 2,
      color: colors.primaryForeground,
      opacity: 0.85,
    },
    actionRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing[3],
      paddingVertical: spacing[4],
    },
    actionDivider: { borderTopWidth: 1, borderTopColor: colors.border },
    actionText: { fontFamily: fonts.base, fontSize: textSize.body * scale, color: colors.foreground },
    actionCount: { fontFamily: fonts.base, fontSize: textSize.body * scale, color: colors.mutedForeground },
    flexFill: { flex: 1 },
    backText: {
      fontFamily: fonts.baseSemi,
      fontSize: textSize.body * scale,
      color: colors.foreground,
    },
    error: {
      fontFamily: fonts.base,
      fontSize: textSize.small * scale,
      color: colors.error,
    },
  });
}
