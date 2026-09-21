import { CalendarDays, Plus } from "lucide-react-native";
import React, { useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { fonts, radius, spacing, type Colors } from "../theme";
import { useAppTheme } from "../providers/AppThemeProvider";
import {
  type ProjectRecord,
  type TaskRecord,
  type TaskStatus,
} from "../types";
import { Button } from "./Button";
import { ConfirmModal } from "./ConfirmModal";
import { formatShortDate, isSameDay } from "../lib/dates";
import { DatePickerSheet } from "./DatePickerSheet";
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
};

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
}: Props) {
  const { colors, scale } = useAppTheme();
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
  const [addingProject, setAddingProject] = useState(false);
  const [pickingDate, setPickingDate] = useState(false);
  const editing = Boolean(task);

  useEffect(() => {
    if (open) {
      setDraft(draftFrom(task, defaultProjectId, projects));
      setError("");
      setNewProject("");
    }
  }, [open, task?.id, defaultProjectId, projects]);

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

  return (
    <>
      <Sheet
        open={open}
        title={editing ? "Edit task" : "Add a task"}
        description="Keep it short. You can always change it later."
        onClose={onClose}
      >
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
                <Text style={[styles.chipText, active && styles.chipTextActive]}>{project.name}</Text>
              </Pressable>
            );
          })}
          <Pressable
            onPress={() => {
              setNewProject("");
              setAddingProject(true);
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
                : draft.completeBy?.toDateString() === option.value.toDateString();
            return (
              <Pressable
                key={option.label}
                onPress={() => setDraft((current) => ({ ...current, completeBy: option.value }))}
                style={[styles.chip, active && styles.chipActive]}
              >
                <Text style={[styles.chipText, active && styles.chipTextActive]}>{option.label}</Text>
              </Pressable>
            );
          })}
          {/* Shows the chosen day once it is one the shortcuts cannot express,
              so a custom date is never invisible behind a generic label. */}
          <Pressable
            onPress={() => setPickingDate(true)}
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
      </Sheet>

      <Sheet
        open={addingProject}
        title="Add a project"
        description="A short name is easiest to recognise later."
        onClose={() => setAddingProject(false)}
      >
        <Input
          value={newProject}
          onChangeText={setNewProject}
          placeholder="For example, Health"
          autoFocus
          maxLength={100}
          returnKeyType="done"
        />
        <Button
          size="lg"
          loading={creatingProject}
          disabled={!newProject.trim()}
          onPress={async () => {
            const name = newProject.trim().replace(/\s+/g, " ");
            if (!name) return;
            setCreatingProject(true);
            try {
              const project = await onCreateProject(name);
              setDraft((current) => ({ ...current, projectId: project.id }));
              setNewProject("");
              setAddingProject(false);
            } catch (err) {
              setError(
                err instanceof Error ? err.message : "That project could not be added.",
              );
              setAddingProject(false);
            } finally {
              setCreatingProject(false);
            }
          }}
        >
          Add project
        </Button>
      </Sheet>

      <DatePickerSheet
        open={pickingDate}
        value={draft.completeBy}
        onClose={() => setPickingDate(false)}
        onSelect={(date) => setDraft((current) => ({ ...current, completeBy: date }))}
      />

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
    error: {
      fontFamily: fonts.base,
      fontSize: 14 * scale,
      color: colors.error,
    },
  });
}
