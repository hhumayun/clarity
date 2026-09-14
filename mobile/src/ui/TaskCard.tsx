import React, { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import {
  CalendarDays,
  Check,
  MoreHorizontal,
  NotebookPen,
} from "lucide-react-native";
import { fonts, radius, spacing, type Colors } from "../theme";
import { useAppTheme } from "../providers/AppThemeProvider";
import { useToast } from "../providers/ToastProvider";
import { dueState, formatDue } from "../lib/taskDates";
import {
  TASK_STATUS_LABELS,
  TASK_STATUS_VALUES,
  type TaskRecord,
  type TaskStatus,
} from "../types";
import { ConfirmModal } from "./ConfirmModal";

type Props = {
  task: TaskRecord;
  showProject?: boolean;
  showNoteLink?: boolean;
  onStatusChange: (status: TaskStatus) => void;
  onEdit: () => void;
  onDelete: () => Promise<void>;
};

export function TaskCard({
  task,
  showProject = true,
  showNoteLink = true,
  onStatusChange,
  onEdit,
  onDelete,
}: Props) {
  const router = useRouter();
  const toast = useToast();
  const { colors, scale } = useAppTheme();
  const styles = makeStyles(colors, scale);
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const done = task.status === "done";
  const due = task.completeBy ? dueState(task.completeBy) : null;

  return (
    <View style={[styles.card, done && styles.done]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={done ? "Mark as not done" : "Mark as done"}
        onPress={() => onStatusChange(done ? "todo" : "done")}
        style={[styles.check, done && styles.checkDone]}
      >
        {done ? <Check size={18} color={colors.primaryForeground} /> : null}
      </Pressable>

      <View style={styles.body}>
        <Pressable onPress={onEdit}>
          <Text style={[styles.text, done && styles.textDone]}>{task.text}</Text>
        </Pressable>
        <View style={styles.meta}>
          {showProject ? <Text style={styles.chip}>{task.projectName}</Text> : null}
          {task.completeBy && due ? (
            <View style={[styles.chipWrap, due === "overdue" && !done && styles.overdue]}>
              <CalendarDays size={14} color={due === "overdue" && !done ? colors.error : colors.mutedForeground} />
              <Text style={[styles.chip, due === "overdue" && !done && styles.overdueText]}>
                {due === "overdue" && !done ? "Overdue · " : ""}
                {formatDue(task.completeBy)}
              </Text>
            </View>
          ) : null}
          {showNoteLink && task.noteId ? (
            <Pressable
              style={styles.chipWrap}
              onPress={() => router.push(`/note/${task.noteId}`)}
            >
              <NotebookPen size={14} color={colors.mutedForeground} />
              <Text style={styles.chip}>From your note</Text>
            </Pressable>
          ) : null}
        </View>
        {menuOpen ? (
          <View style={styles.menu}>
            {TASK_STATUS_VALUES.filter((status) => status !== task.status).map((status) => (
              <Pressable
                key={status}
                style={styles.menuItem}
                onPress={() => {
                  setMenuOpen(false);
                  onStatusChange(status);
                }}
              >
                <Text style={styles.menuText}>Move to {TASK_STATUS_LABELS[status]}</Text>
              </Pressable>
            ))}
            <Pressable
              style={styles.menuItem}
              onPress={() => {
                setMenuOpen(false);
                onEdit();
              }}
            >
              <Text style={styles.menuText}>Edit…</Text>
            </Pressable>
            {showNoteLink && task.noteId ? (
              <Pressable
                style={styles.menuItem}
                onPress={() => {
                  setMenuOpen(false);
                  router.push(`/note/${task.noteId}`);
                }}
              >
                <Text style={styles.menuText}>Open the note</Text>
              </Pressable>
            ) : null}
            <Pressable
              style={styles.menuItem}
              onPress={() => {
                setMenuOpen(false);
                setConfirmingDelete(true);
              }}
            >
              <Text style={[styles.menuText, styles.danger]}>Delete</Text>
            </Pressable>
          </View>
        ) : null}
      </View>

      <Pressable
        accessibilityLabel="More actions"
        onPress={() => setMenuOpen((open) => !open)}
        style={styles.more}
      >
        <MoreHorizontal size={22} color={colors.mutedForeground} />
      </Pressable>

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
          void onDelete()
            .then(() => setConfirmingDelete(false))
            .catch(() => toast.show("That task could not be deleted. Please try again."))
            .finally(() => setDeleting(false));
        }}
      />
    </View>
  );
}

function makeStyles(colors: Colors, scale: number) {
  return StyleSheet.create({
    card: {
      flexDirection: "row",
      alignItems: "flex-start",
      gap: spacing[3],
      backgroundColor: colors.card,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      padding: spacing[3],
    },
    done: { opacity: 0.72 },
    check: {
      width: 28,
      height: 28,
      borderRadius: 14,
      borderWidth: 2,
      borderColor: colors.primary,
      alignItems: "center",
      justifyContent: "center",
      marginTop: 2,
    },
    checkDone: { backgroundColor: colors.primary },
    body: { flex: 1, gap: spacing[2] },
    text: {
      fontFamily: fonts.baseSemi,
      fontSize: 16 * scale,
      color: colors.foreground,
    },
    textDone: { textDecorationLine: "line-through", color: colors.mutedForeground },
    meta: { flexDirection: "row", flexWrap: "wrap", gap: spacing[2] },
    chipWrap: { flexDirection: "row", alignItems: "center", gap: 4 },
    chip: {
      fontFamily: fonts.base,
      fontSize: 13 * scale,
      color: colors.mutedForeground,
    },
    overdue: {},
    overdueText: { color: colors.error },
    more: { padding: spacing[1] },
    menu: {
      backgroundColor: colors.surface,
      borderRadius: radius.sm,
      borderWidth: 1,
      borderColor: colors.border,
      overflow: "hidden",
    },
    menuItem: { paddingHorizontal: spacing[3], paddingVertical: spacing[3] },
    menuText: {
      fontFamily: fonts.base,
      fontSize: 15 * scale,
      color: colors.foreground,
    },
    danger: { color: colors.error },
  });
}
