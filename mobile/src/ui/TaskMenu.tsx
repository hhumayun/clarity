import DateTimePicker, { type DateTimePickerEvent } from "@react-native-community/datetimepicker";
import { BlurView } from "expo-blur";
import { CalendarDays, FileText, Link2, Timer } from "lucide-react-native";
import React, { useEffect, useMemo, useState } from "react";
import { Modal, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import Animated, { useAnimatedStyle } from "react-native-reanimated";
import { useHeldWhileOpen, usePresence } from "../hooks/usePresence";
import { atNoon, dueDayOptions, isSameDay } from "../lib/dates";
import { areaTag } from "../lib/lifeCenter";
import { linkedNoteIds } from "../lib/taskLinks";
import { useAppTheme } from "../providers/AppThemeProvider";
import { fonts, radius, spacing, type Colors, textSize } from "../theme";
import type { TaskRecord } from "../types";
import { fadeInFast, MOTION } from "./motion";

type Props = {
  task: TaskRecord | null;
  /** The due day as shown in the Date row, e.g. "Today" or "Sep 30". */
  dueLabel: string;
  onClose: () => void;
  /** A new day chosen from the Date page, or null for no date. */
  onMove: (task: TaskRecord, date: Date | null) => void;
  onFocus: (task: TaskRecord) => void;
  /** The task's linked notes and how it is going. */
  onNotes: (task: TaskRecord) => void;
  onLinkNote: (task: TaskRecord) => void;
  /** Once the menu has fully gone; anything that presents next waits for it. */
  onExited?: () => void;
};

/**
 * A task's menu, opened by pressing and holding it: the screen blurs, the task
 * is lifted above it, and a short menu sits under it. Tap anywhere else to put
 * it away.
 *
 * Date turns the menu into the day choices in place rather than opening a
 * sheet: a second Modal presented while this one is still going away is
 * refused by iOS, and the screen is left drawn but deaf to touch.
 *
 * Like the other dialogs, the Modal is unmounted once its exit has played: a
 * hidden Modal left mounted keeps eating touches under the new renderer.
 */
export function TaskMenu({ task, dueLabel, onClose, onMove, onFocus, onNotes, onLinkNote, onExited }: Props) {
  const { colors, scale, dark } = useAppTheme();
  const styles = useMemo(() => makeStyles(colors, scale), [colors, scale]);
  const open = task !== null;
  const { mounted, progress } = usePresence(open, { enterMs: MOTION.base, exitMs: MOTION.fast, onExited });
  const shown = useHeldWhileOpen(open, { task, dueLabel });
  const [page, setPage] = useState<"menu" | "date">("menu");
  // Android's calendar is a dialog of its own, opened from a chip.
  const [pickerOpen, setPickerOpen] = useState(false);
  const fade = useAnimatedStyle(() => ({ opacity: progress.value }));
  const lift = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ scale: 0.97 + 0.03 * progress.value }],
  }));

  useEffect(() => {
    if (open) {
      setPage("menu");
      setPickerOpen(false);
    }
  }, [open, task?.id]);

  if (!mounted || !shown.task) return null;
  const current = shown.task;

  const handlePicked = (event: DateTimePickerEvent, date?: Date) => {
    setPickerOpen(false);
    if (event.type === "dismissed" || !date) return;
    // Midday, so the stored day cannot slide backwards across a timezone.
    onMove(current, atNoon(date.getFullYear(), date.getMonth(), date.getDate()));
  };

  return (
    <Modal
      visible
      transparent
      animationType="none"
      onRequestClose={page === "date" ? () => setPage("menu") : onClose}
    >
      <Animated.View style={[StyleSheet.absoluteFill, fade]}>
        <BlurView intensity={18} tint={dark ? "dark" : "light"} style={StyleSheet.absoluteFill} />
        <View style={[StyleSheet.absoluteFill, styles.dim]} />
      </Animated.View>
      {/* Behind the task and its menu rather than around them, so a touch on
          the calendar never reaches it. */}
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close the menu" />
      <View style={styles.stage} pointerEvents="box-none">
        <Animated.View style={[styles.column, lift]} pointerEvents="box-none">
          {/* The task, lifted above the blur. */}
          <View style={styles.taskCard}>
            {current.status !== "done" ? <View style={styles.ring} /> : null}
            <View style={styles.flex}>
              <Text style={styles.taskTitle}>{current.text}</Text>
              <Text style={styles.taskArea}>{areaTag(current.projectName)}</Text>
            </View>
          </View>
          {page === "menu" ? (
            // Shadow outside, clipping inside: a clipped view drops its own shadow.
            <View style={styles.menuShadow}>
              <View style={styles.menu}>
                <Pressable
                  onPress={() => setPage("date")}
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
                <Pressable
                  onPress={() => onNotes(current)}
                  style={({ pressed }) => [styles.item, styles.divider, pressed && styles.itemPressed]}
                  accessibilityRole="button"
                  accessibilityLabel={`Notes, ${linkedNoteIds(current).length}. See this task's notes and how it is going`}
                >
                  <FileText size={19} color={colors.mutedForeground} />
                  <Text style={styles.itemText}>Notes</Text>
                  <Text style={styles.itemValue}>{linkedNoteIds(current).length}</Text>
                </Pressable>
                <Pressable
                  onPress={() => onLinkNote(current)}
                  style={({ pressed }) => [styles.item, styles.divider, pressed && styles.itemPressed]}
                  accessibilityRole="button"
                >
                  <Link2 size={19} color={colors.mutedForeground} />
                  <Text style={styles.itemText}>Link a note</Text>
                </Pressable>
              </View>
            </View>
          ) : (
            <Animated.View entering={fadeInFast} style={styles.dateShadow}>
              <View style={styles.datePanel}>
                <View style={styles.chips}>
                  {dueDayOptions().map((option) => {
                    const active =
                      option.value === null
                        ? current.completeBy === null
                        : isSameDay(option.value, current.completeBy);
                    return (
                      <Pressable
                        key={option.label}
                        onPress={() => onMove(current, option.value)}
                        style={[styles.chip, active && styles.chipActive]}
                        accessibilityRole="button"
                        accessibilityState={{ selected: active }}
                      >
                        <Text style={[styles.chipText, active && styles.chipTextActive]}>{option.label}</Text>
                      </Pressable>
                    );
                  })}
                  {Platform.OS === "ios" ? null : (
                    <Pressable
                      onPress={() => setPickerOpen(true)}
                      style={[styles.chip, styles.chipWithIcon]}
                      accessibilityRole="button"
                      accessibilityLabel="Pick a date"
                    >
                      <CalendarDays size={14} color={colors.mutedForeground} />
                      <Text style={styles.chipText}>Pick a date</Text>
                    </Pressable>
                  )}
                </View>
                {/* iOS shows the calendar here: tapping a day chooses it.
                    Android's is a dialog of its own, opened from the chip. */}
                {Platform.OS === "ios" || pickerOpen ? (
                  <View style={styles.picker}>
                    <DateTimePicker
                      value={current.completeBy ?? new Date()}
                      mode="date"
                      display={Platform.OS === "ios" ? "inline" : "default"}
                      accentColor={colors.primary}
                      themeVariant={dark ? "dark" : "light"}
                      onChange={handlePicked}
                    />
                  </View>
                ) : null}
              </View>
            </Animated.View>
          )}
        </Animated.View>
      </View>
    </Modal>
  );
}

function makeStyles(colors: Colors, scale: number) {
  const shadow = {
    shadowColor: "#000",
    shadowOpacity: 0.35,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 12 },
  };
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
      ...shadow,
    },
    // The same quiet ring as the task's row.
    ring: {
      width: 18 * scale,
      height: 18 * scale,
      borderRadius: 9 * scale,
      backgroundColor: colors.muted,
      marginTop: (21 * scale - 18 * scale) / 2,
    },
    taskTitle: { fontFamily: fonts.base, fontSize: textSize.body * scale, lineHeight: 21 * scale, color: colors.foreground },
    taskArea: { fontFamily: fonts.base, fontSize: textSize.small * scale, color: colors.mutedForeground, marginTop: 3 },
    menuShadow: { alignSelf: "flex-end", width: 230, borderRadius: 12, ...shadow },
    menu: { backgroundColor: colors.card, borderRadius: 12, overflow: "hidden" },
    item: { flexDirection: "row", alignItems: "center", gap: spacing[3], minHeight: 48, paddingHorizontal: spacing[4] },
    itemPressed: { backgroundColor: colors.muted },
    divider: { borderTopWidth: 1, borderTopColor: colors.border },
    itemText: { flex: 1, fontFamily: fonts.base, fontSize: textSize.body * scale, color: colors.foreground },
    itemValue: { fontFamily: fonts.base, fontSize: textSize.small * scale, color: colors.mutedForeground },
    // The day choices take the menu's place, as wide as the task above them.
    dateShadow: { borderRadius: 12, ...shadow },
    datePanel: {
      backgroundColor: colors.card,
      borderRadius: 12,
      overflow: "hidden",
      padding: spacing[4],
      gap: spacing[3],
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
    chipWithIcon: { flexDirection: "row", alignItems: "center", gap: spacing[1] },
    chipText: { fontFamily: fonts.base, fontSize: textSize.small * scale, color: colors.mutedForeground },
    chipTextActive: { color: colors.accentForeground, fontFamily: fonts.baseSemi },
    // The inline calendar draws its own padding.
    picker: { marginHorizontal: -spacing[2] },
  });
}
