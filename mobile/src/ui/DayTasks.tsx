import { Plus } from "lucide-react-native";
import React, { useMemo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useAppTheme } from "../providers/AppThemeProvider";
import { fonts, spacing, textSize, type Colors } from "../theme";
import type { TaskRecord, TaskStatus } from "../types";
import { sortTasks } from "../lib/taskSort";
import { TaskCard } from "./TaskCard";

type Props = {
  /** The tasks due on the day, done ones included. */
  tasks: TaskRecord[];
  onStatusChange: (task: TaskRecord, status: TaskStatus) => void;
  /** Tapping a task opens its menu. */
  onOpenMenu: (task: TaskRecord) => void;
  /** Add a task due on this day. */
  onAdd: () => void;
  /** What an empty day says; a day still to come is not "was". */
  emptyText?: string;
};

/**
 * The day's tasks, under its notes, as settled rows: open ones as bare lines,
 * then the done ones settled into their fields under DONE. Swipe a row right
 * to mark it done.
 */
export function DayTasks({ tasks, onStatusChange, onOpenMenu, onAdd, emptyText = "Nothing was scheduled." }: Props) {
  const { colors, scale } = useAppTheme();
  const styles = useMemo(() => makeStyles(colors, scale), [colors, scale]);

  // Open ones with a time first, in time order.
  const open = sortTasks(tasks.filter((task) => task.status !== "done"));
  const done = tasks.filter((task) => task.status === "done");

  const row = (task: TaskRecord) => (
    <TaskCard
      key={task.id}
      task={task}
      showDue={false}
      showNoteLink={false}
      onStatusChange={(status) => onStatusChange(task, status)}
      onOpen={() => onOpenMenu(task)}
    />
  );

  return (
    <View>
      <View style={styles.header}>
        <Text style={styles.heading}>Tasks</Text>
        <Pressable
          onPress={onAdd}
          hitSlop={10}
          style={({ pressed }) => [styles.add, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel="Add a task for this day"
        >
          <Plus size={18} color={colors.primary} strokeWidth={2.2} />
        </Pressable>
      </View>
      {tasks.length === 0 ? <Text style={styles.empty}>{emptyText}</Text> : null}
      {open.map(row)}
      {done.length > 0 ? (
        <>
          <Text style={styles.label}>DONE</Text>
          {done.map(row)}
        </>
      ) : null}
    </View>
  );
}

function makeStyles(colors: Colors, scale: number) {
  return StyleSheet.create({
    header: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      paddingTop: 22,
      paddingBottom: 2,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    heading: { fontFamily: fonts.baseSemi, fontSize: textSize.small * scale, color: colors.foreground },
    add: { width: 30, height: 30, alignItems: "center", justifyContent: "center", marginRight: -6 },
    pressed: { opacity: 0.7 },
    empty: {
      fontFamily: fonts.base,
      fontSize: textSize.small * scale,
      color: colors.mutedForeground,
      paddingVertical: spacing[3],
    },
    label: {
      fontFamily: fonts.baseSemi,
      fontSize: textSize.label * scale,
      letterSpacing: 1.2,
      color: colors.mutedForeground,
      paddingTop: 18,
      paddingBottom: 8,
    },
  });
}
