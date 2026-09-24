import React, { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { radius, spacing, type Colors, type Fonts } from "../theme";
import { useAppTheme } from "../providers/AppThemeProvider";
import { useToast } from "../providers/ToastProvider";
import { sortProjects } from "../lib/taskSort";
import type { ProjectRecord, TaskRecord } from "../types";
import { Button } from "./Button";
import { Input } from "./Input";
import { Sheet } from "./Sheet";

type Props = {
  open: boolean;
  onClose: () => void;
  projects: ProjectRecord[];
  tasks: TaskRecord[];
  onCreate: (name: string) => Promise<ProjectRecord>;
  onRename: (id: string, name: string) => Promise<void>;
  onDelete: (id: string, moveTasksTo?: string) => Promise<void>;
};

export function ProjectSheet({
  open,
  onClose,
  projects,
  tasks,
  onCreate,
  onRename,
  onDelete,
}: Props) {
  const toast = useToast();
  const { colors, fonts, scale } = useAppTheme();
  const styles = useMemo(() => makeStyles(colors, scale, fonts), [colors, scale, fonts]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [deleting, setDeleting] = useState<ProjectRecord | null>(null);
  const [moveTo, setMoveTo] = useState("");

  const sorted = sortProjects(projects);
  const counts = new Map<string, { open: number; done: number }>();
  for (const task of tasks) {
    const entry = counts.get(task.projectId) ?? { open: 0, done: 0 };
    if (task.status === "done") entry.done += 1;
    else entry.open += 1;
    counts.set(task.projectId, entry);
  }

  const commitRename = async () => {
    if (!editingId) return;
    const clean = editName.trim().replace(/\s+/g, " ");
    const current = projects.find((project) => project.id === editingId);
    if (!clean || !current || clean === current.name) {
      setEditingId(null);
      return;
    }
    setBusy(true);
    setError("");
    try {
      await onRename(editingId, clean);
      setEditingId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "That project could not be renamed.");
    } finally {
      setBusy(false);
    }
  };

  const deletingCount = deleting ? counts.get(deleting.id) : undefined;
  const deletingTaskTotal = deletingCount ? deletingCount.open + deletingCount.done : 0;
  const otherProjects = deleting ? sorted.filter((project) => project.id !== deleting.id) : [];

  return (
    <Sheet
      open={open}
      title={deleting ? `Remove ${deleting.name}?` : "Your projects"}
      description={
        deleting
          ? deletingTaskTotal > 0 && otherProjects.length > 0
            ? `${deletingTaskTotal} tasks need a new project.`
            : deletingTaskTotal > 0
              ? "Tasks in this project will be removed from the board. Your notes are not affected."
              : "This project will be removed."
          : "Projects are the areas of your life that tasks belong to."
      }
      onClose={() => {
        if (deleting) {
          setDeleting(null);
          return;
        }
        onClose();
      }}
    >
      {deleting ? (
        <>
          {deletingTaskTotal > 0 && otherProjects.length > 0 ? (
            <View style={styles.chips}>
              {otherProjects.map((project) => {
                const active = moveTo === project.id;
                return (
                  <Pressable
                    key={project.id}
                    onPress={() => setMoveTo(project.id)}
                    style={[styles.chip, active && styles.chipActive]}
                  >
                    <Text style={[styles.chipText, active && styles.chipTextActive]}>
                      {project.name}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          ) : null}
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <Button
            variant="destructive"
            loading={busy}
            disabled={deletingTaskTotal > 0 && otherProjects.length > 0 && !moveTo}
            onPress={async () => {
              setBusy(true);
              setError("");
              try {
                await onDelete(
                  deleting.id,
                  deletingTaskTotal > 0 && otherProjects.length > 0 ? moveTo : undefined,
                );
                toast.show(`“${deleting.name}” removed`);
                setDeleting(null);
                setMoveTo("");
              } catch (err) {
                setError(err instanceof Error ? err.message : "That project could not be removed.");
              } finally {
                setBusy(false);
              }
            }}
          >
            Remove
          </Button>
          <Button variant="ghost" onPress={() => setDeleting(null)}>
            Keep project
          </Button>
        </>
      ) : (
        <>
          {sorted.map((project) => {
            const count = counts.get(project.id);
            const editing = editingId === project.id;
            return (
              <View key={project.id} style={styles.row}>
                {editing ? (
                  <Input
                    value={editName}
                    onChangeText={setEditName}
                    onSubmitEditing={() => void commitRename()}
                    style={styles.flex}
                  />
                ) : (
                  <View style={styles.flex}>
                    <Text style={styles.name}>{project.name}</Text>
                    <Text style={styles.meta}>
                      {(count?.open ?? 0) + (count?.done ?? 0)} tasks
                    </Text>
                  </View>
                )}
                {editing ? (
                  <Button size="sm" onPress={() => void commitRename()} loading={busy}>
                    Save
                  </Button>
                ) : (
                  <>
                    <Button
                      size="sm"
                      variant="ghost"
                      onPress={() => {
                        setEditingId(project.id);
                        setEditName(project.name);
                      }}
                    >
                      Rename
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onPress={() => {
                        setDeleting(project);
                        setMoveTo(sorted.find((item) => item.id !== project.id)?.id ?? "");
                      }}
                    >
                      Delete
                    </Button>
                  </>
                )}
              </View>
            );
          })}

          <View style={styles.addRow}>
            <Input
              value={newName}
              onChangeText={setNewName}
              placeholder="New project"
              style={styles.flex}
            />
            <Button
              size="sm"
              loading={busy}
              disabled={!newName.trim()}
              onPress={async () => {
                const clean = newName.trim().replace(/\s+/g, " ");
                if (!clean) return;
                setBusy(true);
                setError("");
                try {
                  await onCreate(clean);
                  setNewName("");
                } catch (err) {
                  setError(err instanceof Error ? err.message : "That project could not be added.");
                } finally {
                  setBusy(false);
                }
              }}
            >
              Add
            </Button>
          </View>
          {error ? <Text style={styles.error}>{error}</Text> : null}
        </>
      )}
    </Sheet>
  );
}

function makeStyles(colors: Colors, scale: number, fonts: Fonts) {
  return StyleSheet.create({
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing[2],
      paddingVertical: spacing[2],
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    flex: { flex: 1 },
    name: {
      fontFamily: fonts.baseSemi,
      fontSize: 16 * scale,
      color: colors.foreground,
    },
    meta: {
      fontFamily: fonts.base,
      fontSize: 13 * scale,
      color: colors.mutedForeground,
    },
    addRow: { flexDirection: "row", gap: spacing[2], alignItems: "center" },
    error: { fontFamily: fonts.base, fontSize: 14 * scale, color: colors.error },
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
  });
}
