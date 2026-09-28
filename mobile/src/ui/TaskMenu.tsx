import { BlurView } from "expo-blur";
import { CalendarDays, FileText, Timer } from "lucide-react-native";
import React, { useMemo } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import Animated, { useAnimatedStyle } from "react-native-reanimated";
import { useHeldWhileOpen, usePresence } from "../hooks/usePresence";
import { useAppTheme } from "../providers/AppThemeProvider";
import { fonts, spacing, type Colors } from "../theme";
import type { TaskRecord } from "../types";
import { MOTION } from "./motion";

type Props = {
  task: TaskRecord | null;
  /** The due day as shown in the Date row, e.g. "Today" or "Sep 30". */
  dueLabel: string;
  onClose: () => void;
  onDate: (task: TaskRecord) => void;
  onFocus: (task: TaskRecord) => void;
  /** Only offered when the task came from, or is linked to, a note. */
  onViewNote: (task: TaskRecord) => void;
};

/**
 * A task's menu, opened by pressing and holding it: the screen blurs, the task
 * is lifted above it, and a short menu sits under it. Tap anywhere else to put
 * it away.
 *
 * Like the other dialogs, the Modal is unmounted once its exit has played: a
 * hidden Modal left mounted keeps eating touches under the new renderer.
 */
export function TaskMenu({ task, dueLabel, onClose, onDate, onFocus, onViewNote }: Props) {
  const { colors, scale, dark } = useAppTheme();
  const styles = useMemo(() => makeStyles(colors, scale), [colors, scale]);
  const open = task !== null;
  const { mounted, progress } = usePresence(open, { enterMs: MOTION.base, exitMs: MOTION.fast });
  const shown = useHeldWhileOpen(open, { task, dueLabel });
  const fade = useAnimatedStyle(() => ({ opacity: progress.value }));
  const lift = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ scale: 0.97 + 0.03 * progress.value }],
  }));

  if (!mounted || !shown.task) return null;
  const current = shown.task;

  return (
    <Modal visible transparent animationType="none" onRequestClose={onClose}>
      <Animated.View style={[StyleSheet.absoluteFill, fade]}>
        <BlurView intensity={18} tint={dark ? "dark" : "light"} style={StyleSheet.absoluteFill} />
        <View style={[StyleSheet.absoluteFill, styles.dim]} />
      </Animated.View>
      <Pressable style={styles.stage} onPress={onClose} accessibilityLabel="Close the menu">
        <Animated.View style={[styles.column, lift]}>
          {/* The task, lifted above the blur. */}
          <View style={styles.taskCard}>
            <View style={styles.check} />
            <View style={styles.flex}>
              <Text style={styles.taskTitle}>{current.text}</Text>
              <Text style={styles.taskArea}>{current.projectName}</Text>
            </View>
          </View>
          {/* Shadow outside, clipping inside: a clipped view drops its own shadow. */}
          <View style={styles.menuShadow}>
          <View style={styles.menu}>
            <Pressable
              onPress={() => onDate(current)}
              style={({ pressed }) => [styles.item, pressed && styles.itemPressed]}
              accessibilityRole="button"
              accessibilityLabel={`Date: ${shown.dueLabel}. Move to another day`}
            >
              <CalendarDays size={19} color={colors.mutedForeground} />
              <Text style={styles.itemText}>Date</Text>
              <Text style={styles.itemValue}>{shown.dueLabel}</Text>
            </Pressable>
            <Pressable
              onPress={() => onFocus(current)}
              style={({ pressed }) => [styles.item, styles.divider, pressed && styles.itemPressed]}
              accessibilityRole="button"
              accessibilityLabel="Start focus time"
            >
              <Timer size={19} color={colors.mutedForeground} />
              <Text style={styles.itemText}>Focus</Text>
            </Pressable>
            {current.noteId ? (
              <Pressable
                onPress={() => onViewNote(current)}
                style={({ pressed }) => [styles.item, styles.divider, pressed && styles.itemPressed]}
                accessibilityRole="button"
                accessibilityLabel="View the note this task came from"
              >
                <FileText size={19} color={colors.mutedForeground} />
                <Text style={styles.itemText}>View note</Text>
              </Pressable>
            ) : null}
          </View>
          </View>
        </Animated.View>
      </Pressable>
    </Modal>
  );
}

function makeStyles(colors: Colors, scale: number) {
  return StyleSheet.create({
    flex: { flex: 1 },
    dim: { backgroundColor: "rgba(12, 12, 11, 0.45)" },
    stage: { flex: 1, justifyContent: "center", paddingHorizontal: 20 },
    column: { gap: 10 },
    taskCard: {
      flexDirection: "row",
      alignItems: "flex-start",
      gap: spacing[3],
      backgroundColor: colors.card,
      borderRadius: 12,
      paddingVertical: 14,
      paddingHorizontal: spacing[4],
      shadowColor: "#000",
      shadowOpacity: 0.35,
      shadowRadius: 16,
      shadowOffset: { width: 0, height: 12 },
    },
    check: {
      width: 22,
      height: 22,
      borderRadius: 11,
      borderWidth: 1.5,
      borderColor: colors.primary,
      marginTop: 1,
    },
    taskTitle: { fontFamily: fonts.base, fontSize: 15 * scale, lineHeight: 20 * scale, color: colors.foreground },
    taskArea: { fontFamily: fonts.base, fontSize: 13 * scale, color: colors.mutedForeground, marginTop: 3 },
    menuShadow: {
      alignSelf: "flex-end",
      width: 230,
      borderRadius: 12,
      shadowColor: "#000",
      shadowOpacity: 0.35,
      shadowRadius: 16,
      shadowOffset: { width: 0, height: 12 },
    },
    menu: { backgroundColor: colors.card, borderRadius: 12, overflow: "hidden" },
    item: { flexDirection: "row", alignItems: "center", gap: spacing[3], minHeight: 48, paddingHorizontal: spacing[4] },
    itemPressed: { backgroundColor: colors.muted },
    divider: { borderTopWidth: 1, borderTopColor: colors.border },
    itemText: { flex: 1, fontFamily: fonts.base, fontSize: 16 * scale, color: colors.foreground },
    itemValue: { fontFamily: fonts.base, fontSize: 14 * scale, color: colors.mutedForeground },
  });
}
