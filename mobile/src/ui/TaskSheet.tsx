import React, { useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { fonts, radius, spacing, type Colors } from "../theme";
import { useAppTheme } from "../providers/AppThemeProvider";
import {
  TASK_STATUS_LABELS,
  TASK_STATUS_VALUES,
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
  const editing = Boolean(task);

  useEffect(() => {
    if (open) {
      setDraft(draftFrom(task, defaultProjectId, projects));
      setError("");
      setNewProject("");
    }
  }, [open, task?.id, defaultProjectId, projects]);

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
        </View>
        <View style={styles.addProject}>
          <Input
            value={newProject}
            onChangeText={setNewProject}
            placeholder="New project name"
            style={styles.addInput}
          />
          <Button
            size="sm"
            variant="secondary"
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
              } catch (err) {
                setError(err instanceof Error ? err.message : "That project could not be added.");
              } finally {
                setCreatingProject(false);
              }
            }}
          >
            Add
          </Button>
        </View>

        <Text style={styles.label}>Complete by</Text>
        <View style={styles.chips}>
          {[
            { label: "No date", value: null as Date | null },
            { label: "Today", value: addDays(0) },
            { label: "Tomorrow", value: addDays(1) },
            { label: "Next week", value: addDays(7) },
          ].map((option) => {
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
        </View>

        <Text style={styles.label}>Where is it?</Text>
        <View style={styles.chips}>
          {TASK_STATUS_VALUES.map((status) => {
            const active = draft.status === status;
            return (
              <Pressable
                key={status}
                onPress={() => setDraft((current) => ({ ...current, status }))}
                style={[styles.chip, active && styles.chipActive]}
              >
                <Text style={[styles.chipText, active && styles.chipTextActive]}>
                  {TASK_STATUS_LABELS[status]}
                </Text>
              </Pressable>
            );
          })}
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
    addProject: { flexDirection: "row", gap: spacing[2], alignItems: "center" },
    addInput: { flex: 1 },
    error: {
      fontFamily: fonts.base,
      fontSize: 14 * scale,
      color: colors.error,
    },
  });
}
