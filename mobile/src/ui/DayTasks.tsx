import * as Haptics from "expo-haptics";
import { Check, Plus } from "lucide-react-native";
import React, { useMemo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { areaTag } from "../lib/lifeCenter";
import { useAppTheme } from "../providers/AppThemeProvider";
import { fonts, spacing, type Colors } from "../theme";
import type { TaskRecord } from "../types";

type Props = {
  /** The tasks due on the day, done ones included. */
  tasks: TaskRecord[];
  onToggle: (task: TaskRecord) => void;
  /** Tap or press and hold a task for its menu. */
  onOpenMenu: (task: TaskRecord) => void;
  /** Add a task due on this day. */
  onAdd: () => void;
};

/**
 * The day's tasks, under its notes: open ones first, finished ones struck
 * through below them, as rows on hairlines rather than cards.
 */
export function DayTasks({ tasks, onToggle, onOpenMenu, onAdd }: Props) {
  const { colors, scale } = useAppTheme();
  const styles = useMemo(() => makeStyles(colors, scale), [colors, scale]);

  const sorted = useMemo(
    () => [...tasks].sort((a, b) => Number(a.status === "done") - Number(b.status === "done")),
    [tasks],
  );

  const openMenu = (task: TaskRecord) => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    onOpenMenu(task);
  };

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
      {sorted.length === 0 ? (
        <Text style={styles.empty}>Nothing was scheduled.</Text>
      ) : (
        sorted.map((task) => {
          const done = task.status === "done";
          return (
            <Pressable
              key={task.id}
              onPress={() => onOpenMenu(task)}
              onLongPress={() => openMenu(task)}
              delayLongPress={400}
              style={({ pressed }) => [styles.row, pressed && styles.pressed]}
              accessibilityRole="button"
              accessibilityLabel={`${task.text}, ${task.projectName}${done ? ", done" : ""}`}
              accessibilityHint="Opens the task's menu"
            >
              <Pressable
                onPress={() => onToggle(task)}
                hitSlop={10}
                style={[styles.check, done && styles.checkDone]}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: done }}
                accessibilityLabel={done ? "Mark not done" : "Mark done"}
              >
                {done ? <Check size={12} color={colors.primaryForeground} strokeWidth={3} /> : null}
              </Pressable>
              <View style={styles.flex}>
                <Text style={[styles.title, done && styles.titleDone]}>{task.text}</Text>
                <Text style={styles.area}>{areaTag(task.projectName)}</Text>
              </View>
            </Pressable>
          );
        })
      )}
    </View>
  );
}

function makeStyles(colors: Colors, scale: number) {
  return StyleSheet.create({
    flex: { flex: 1 },
    header: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      paddingTop: 22,
      paddingBottom: 2,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    heading: { fontFamily: fonts.baseSemi, fontSize: 13 * scale, color: colors.foreground },
    add: { width: 30, height: 30, alignItems: "center", justifyContent: "center", marginRight: -6 },
    empty: {
      fontFamily: fonts.base,
      fontSize: 14 * scale,
      color: colors.mutedForeground,
      paddingVertical: spacing[3],
    },
    row: {
      flexDirection: "row",
      alignItems: "flex-start",
      gap: spacing[3],
      paddingVertical: 13,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    pressed: { opacity: 0.7 },
    check: {
      width: 22,
      height: 22,
      borderRadius: 11,
      borderWidth: 1.5,
      borderColor: colors.primary,
      alignItems: "center",
      justifyContent: "center",
      marginTop: 1,
    },
    checkDone: { backgroundColor: colors.primary },
    title: { fontFamily: fonts.base, fontSize: 15 * scale, lineHeight: 20 * scale, color: colors.foreground },
    titleDone: { color: colors.mutedForeground, textDecorationLine: "line-through" },
    area: { fontFamily: fonts.base, fontSize: 13 * scale, color: colors.mutedForeground, marginTop: 3 },
  });
}
