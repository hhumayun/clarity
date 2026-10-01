import DateTimePicker, {
  type DateTimePickerEvent,
} from "@react-native-community/datetimepicker";
import { ArrowUp, CalendarDays, Clock, Hash, Plus, Sparkles, X } from "lucide-react-native";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Keyboard,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import Animated, { useAnimatedStyle, useSharedValue } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useKeyboardSlot } from "../hooks/useKeyboardSlot";
import { usePresence } from "../hooks/usePresence";
import { useTaskLineParse } from "../hooks/useTaskLineParse";
import { atNoon, dateChipLabel, fromIsoDay, isSameDay } from "../lib/dates";
import { dueTimeLabel, minutesOf, timeOf, timeToday } from "../lib/reminderRules";
import { areaTag } from "../lib/lifeCenter";
import { useAppTheme } from "../providers/AppThemeProvider";
import { fonts, radius, spacing, type Colors, textSize } from "../theme";
import type { ProjectRecord } from "../types";
import { Button } from "./Button";
import { Input } from "./Input";
import { Collapse } from "./Collapse";

export type QuickAddDraft = {
  text: string;
  projectId: string;
  completeBy: Date | null;
  /** Its time on that day, "HH:MM"; always null without a day. */
  dueTime: string | null;
};

type Props = {
  open: boolean;
  onClose: () => void;
  projects: ProjectRecord[];
  defaultProjectId?: string | null;
  /**
   * A date the box opens with, e.g. today when adding from the Today screen.
   * A date typed into the line still wins over it.
   */
  defaultDate?: Date | null;
  placeholder?: string;
  onCreateProject: (name: string) => Promise<ProjectRecord>;
  /** Creates the task. The parent closes the box once this resolves. */
  onSubmit: (draft: QuickAddDraft) => Promise<void>;
};

/** Which row is unfolded under the text, if any. Never more than one. */
type Expander = "project" | "newProject" | "date" | null;
/**
 * Who set the date. The date read from the text follows it until the writer
 * chooses for themselves, after which it is left alone.
 */
type DateSource = "none" | "default" | "read" | "manual";

function addDays(days: number): Date {
  const now = new Date();
  return atNoon(now.getFullYear(), now.getMonth(), now.getDate() + days);
}

/** The day a time with no day goes on: today while it is still to come, else tomorrow. */
function dayForTime(time: string): Date {
  const now = new Date();
  return addDays((minutesOf(time) ?? 0) > now.getHours() * 60 + now.getMinutes() ? 0 : 1);
}

/** Where a new time starts: 9:00 on a later day, else the next whole hour. */
function startTime(date: Date | null): string {
  const now = new Date();
  if (date && !isSameDay(date, now) && date.getTime() > now.getTime()) return "09:00";
  return timeOf(Math.min(now.getHours() + 1, 23) * 60);
}

/**
 * One box above the keyboard: the task, a project chip, a date chip, send.
 * A due date typed into the line is read out on the phone and lands in the
 * date chip on its own. Everything unfolds inside this one box — there is no
 * second dialog, because a Modal presented over a Modal is how a screen ends
 * up drawn right but deaf to touch.
 */
export function QuickAddTask({
  open,
  onClose,
  projects,
  defaultProjectId,
  defaultDate = null,
  placeholder = "e.g., Call Dr. Lee tomorrow",
  onCreateProject,
  onSubmit,
}: Props) {
  const insets = useSafeAreaInsets();
  const { colors, scale, dark } = useAppTheme();
  const styles = useMemo(() => makeStyles(colors, scale), [colors, scale]);

  const [text, setText] = useState("");
  const [projectId, setProjectId] = useState<string | null>(null);
  const [date, setDate] = useState<Date | null>(null);
  const [dateSource, setDateSource] = useState<DateSource>("none");
  // The task's time on that day, read from the line ("at 3pm") or chosen.
  const [dueTime, setDueTime] = useState<string | null>(null);
  const [timeSource, setTimeSource] = useState<DateSource>("none");
  // Android's clock is a dialog of its own.
  const [timePickerOpen, setTimePickerOpen] = useState(false);
  const [expander, setExpander] = useState<Expander>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [newProject, setNewProject] = useState("");
  const [creating, setCreating] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const inputRef = useRef<TextInput>(null);
  // On iOS the calendar takes the keyboard's place, below the box, like a
  // custom keyboard: the two trade places and the box stays where it is.
  const [calendar, setCalendar] = useState(false);
  const slot = useKeyboardSlot(() => {
    setCalendar(false);
    slot.reset();
  });
  // After a choice that took the keyboard away (the calendar needs its room,
  // a new project name has its own field), hand it back to the task line.
  const refocus = () => {
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const { parsed, settle } = useTaskLineParse(text, { enabled: open });

  // Reset on open only. Reading the defaults through a ref keeps a project
  // created mid-session from wiping the line the writer is typing.
  const defaultsRef = useRef({ defaultProjectId, projects, defaultDate });
  defaultsRef.current = { defaultProjectId, projects, defaultDate };
  useEffect(() => {
    if (!open) return;
    const defaults = defaultsRef.current;
    setText("");
    setProjectId(defaults.defaultProjectId ?? defaults.projects[0]?.id ?? null);
    setDate(defaults.defaultDate);
    setDateSource(defaults.defaultDate ? "default" : "none");
    setDueTime(null);
    setTimeSource("none");
    setExpander(null);
    setPickerOpen(false);
    setTimePickerOpen(false);
    setCalendar(false);
    slot.reset();
    setNewProject("");
    setError("");
    // slot.reset is stable; this runs on open only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Let a time read from the line ("at 3pm") drive the time until the writer
  // chooses one.
  useEffect(() => {
    if (timeSource === "manual" || parsed === null) return;
    if (parsed.dueTime) {
      if (parsed.dueTime !== dueTime || timeSource !== "read") {
        setDueTime(parsed.dueTime);
        setTimeSource("read");
      }
    } else if (timeSource === "read") {
      setDueTime(null);
      setTimeSource("none");
    }
  }, [parsed, timeSource, dueTime]);

  // Let the date read from the line drive the date chip until the writer
  // takes over. A time alone ("at 3pm") puts the task on a day too.
  useEffect(() => {
    if (dateSource === "manual" || parsed === null) return;
    const found = parsed.completeBy
      ? fromIsoDay(parsed.completeBy)
      : parsed.dueTime
        ? (defaultsRef.current.defaultDate ?? dayForTime(parsed.dueTime))
        : null;
    if (found) {
      if (!isSameDay(found, date)) {
        setDate(found);
        setDateSource("read");
      } else if (dateSource !== "read") {
        setDateSource("read");
      }
      return;
    }
    if (dateSource === "read") {
      // The date words were deleted: fall back to what the box opened with.
      const fallback = defaultsRef.current.defaultDate;
      setDate(fallback);
      setDateSource(fallback ? "default" : "none");
    }
  }, [parsed, dateSource, date]);

  const projectName = projects.find((project) => project.id === projectId)?.name ?? "Project";
  const canSend = text.trim().length > 0 && Boolean(projectId) && !submitting;

  const submit = async () => {
    if (!canSend || !projectId) return;
    const raw = text.trim().replace(/\s+/g, " ");
    setSubmitting(true);
    setError("");
    try {
      let finalText = raw;
      let completeBy = date;
      let time = dueTime;
      // Read the final text, in case it changed since the chips last did.
      const line = await settle(raw);
      const readDay = line.completeBy ? fromIsoDay(line.completeBy) : null;
      if (dateSource !== "manual") {
        completeBy = readDay ?? (line.dueTime ? (defaultsRef.current.defaultDate ?? dayForTime(line.dueTime)) : defaultsRef.current.defaultDate);
        if (timeSource !== "manual") time = line.dueTime;
        if ((readDay || line.dueTime) && line.text.trim()) finalText = line.text.trim();
      } else if (timeSource !== "manual" && line.dueTime && !readDay) {
        // A time alone, on the day chosen by hand.
        time = line.dueTime;
        if (line.text.trim()) finalText = line.text.trim();
      }
      Keyboard.dismiss();
      await onSubmit({ text: finalText, projectId, completeBy, dueTime: completeBy ? time : null });
    } catch (err) {
      setError(err instanceof Error ? err.message : "That task could not be added. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  /**
   * Put the calendar away and go back to typing: the calendar goes down as
   * the keyboard comes up, in step, and the box above them stays put.
   */
  const closeCalendar = () => {
    if (!calendar) return;
    slot.hide(true);
    inputRef.current?.focus();
  };

  const toggle = (next: Exclude<Expander, null>) => {
    closeCalendar();
    setExpander((current) => (current === next ? null : next));
    setPickerOpen(false);
  };

  // In the date panel a choice is made in place, so a time can follow it;
  // in Android's row of choices it returns to the line.
  const chooseDate = (value: Date | null) => {
    setDate(value);
    setDateSource("manual");
    if (!value) {
      setDueTime(null);
      setTimeSource("manual");
    }
    setPickerOpen(false);
    if (calendar) return;
    setExpander(null);
    refocus();
  };

  // A time chosen with no day puts the task on one.
  const chooseTime = (time: string | null) => {
    setDueTime(time);
    setTimeSource("manual");
    if (time && !date) {
      setDate(dayForTime(time));
      setDateSource("manual");
    }
  };

  const onPickedTime = (event: DateTimePickerEvent, picked?: Date) => {
    setTimePickerOpen(false);
    if (event.type === "dismissed" || !picked) return;
    chooseTime(timeOf(picked));
  };

  const openPicker = () => {
    if (Platform.OS === "ios") {
      // The calendar comes up as the keyboard goes down, in its place.
      setCalendar(true);
      slot.show();
      Keyboard.dismiss();
      return;
    }
    // Android's picker is a dialog of its own.
    Keyboard.dismiss();
    setPickerOpen(true);
  };

  const onPicked = (event: DateTimePickerEvent, picked?: Date) => {
    if (event.type === "dismissed") {
      setPickerOpen(false);
      if (!calendar) refocus();
      return;
    }
    if (picked) chooseDate(atNoon(picked.getFullYear(), picked.getMonth(), picked.getDate()));
  };

  const createProject = async () => {
    const name = newProject.trim().replace(/\s+/g, " ");
    if (!name) return;
    setCreating(true);
    setError("");
    try {
      const project = await onCreateProject(name);
      setProjectId(project.id);
      setNewProject("");
      setExpander(null);
      refocus();
    } catch (err) {
      setError(err instanceof Error ? err.message : "That project could not be added.");
    } finally {
      setCreating(false);
    }
  };

  // Mounted while open and while sliding away; see usePresence for why a
  // closed Modal must not stay in the tree.
  const { mounted, progress } = usePresence(open);
  const boxHeight = useSharedValue(400);
  const backdropStyle = useAnimatedStyle(() => ({ opacity: progress.value }));
  const boxStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: (1 - progress.value) * boxHeight.value }],
  }));
  // Drop the keyboard as the box leaves, not a beat after it has gone.
  useEffect(() => {
    if (!open) Keyboard.dismiss();
  }, [open]);

  if (!mounted) return null;

  const shortcuts: Array<{ label: string; value: Date | null }> = [
    { label: "No date", value: null },
    { label: "Today", value: addDays(0) },
    { label: "Tomorrow", value: addDays(1) },
    { label: "Next week", value: addDays(7) },
  ];
  const dayChoices = shortcuts.map((option) => {
    const active = option.value === null ? date === null : isSameDay(option.value, date);
    return (
      <Pressable
        key={option.label}
        onPress={() => chooseDate(option.value)}
        style={[styles.chip, active && styles.chipSet]}
        accessibilityRole="button"
        accessibilityState={{ selected: active }}
      >
        <Text style={[styles.chipText, active && styles.chipTextSet]}>{option.label}</Text>
      </Pressable>
    );
  });

  return (
    <Modal visible transparent animationType="none" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <Animated.View style={[styles.backdrop, backdropStyle]}>
          <Pressable style={styles.fill} onPress={onClose} accessibilityLabel="Close" />
        </Animated.View>
        <Animated.View
          style={boxStyle}
          onLayout={(event) => {
            boxHeight.value = event.nativeEvent.layout.height;
          }}
        >
        {/* No layout animation here: the rows below grow and shrink their own
            height, and the box simply follows them. */}
        <View style={[styles.box, { paddingBottom: Math.max(insets.bottom, spacing[3]) }]}>
          <TextInput
            ref={inputRef}
            value={text}
            onChangeText={setText}
            onFocus={() => {
              if (calendar) slot.hide(true);
            }}
            autoFocus
            placeholder={placeholder}
            placeholderTextColor={colors.mutedForeground}
            style={styles.input}
            maxLength={500}
            returnKeyType="send"
            onSubmitEditing={() => void submit()}
            accessibilityLabel="Task"
          />

          <Collapse open={expander === "project"}>
            <View style={[styles.chips, styles.unfold]}>
              {projects.map((project) => {
                const active = project.id === projectId;
                return (
                  <Pressable
                    key={project.id}
                    onPress={() => {
                      setProjectId(project.id);
                      setExpander(null);
                    }}
                    style={[styles.chip, active && styles.chipSet]}
                  >
                    <Text style={[styles.chipText, active && styles.chipTextSet]}>
                      {areaTag(project.name)}
                    </Text>
                  </Pressable>
                );
              })}
              <Pressable
                onPress={() => setExpander("newProject")}
                accessibilityLabel="Add a project"
                style={[styles.chip, styles.chipDashed]}
              >
                <Plus size={16} color={colors.mutedForeground} />
              </Pressable>
            </View>
          </Collapse>

          <Collapse open={expander === "newProject"}>
            <View style={[styles.row, styles.unfold]}>
              <Input
                style={styles.flex}
                value={newProject}
                onChangeText={setNewProject}
                placeholder="New project name"
                autoFocus
                maxLength={100}
                returnKeyType="done"
                onSubmitEditing={() => void createProject()}
              />
              <Button
                size="sm"
                loading={creating}
                disabled={!newProject.trim()}
                onPress={() => void createProject()}
              >
                Add
              </Button>
            </View>
          </Collapse>

          {/* Android: the day's choices unfold above the toolbar, and the
              calendar and clock are dialogs of their own. iOS has them all
              in one panel in the keyboard's place, below. */}
          {Platform.OS !== "ios" ? (
            <>
              <Collapse open={expander === "date"}>
                <View style={[styles.chips, styles.unfold]}>
                  {dayChoices}
                  <Pressable onPress={openPicker} style={styles.chip} accessibilityLabel="Pick a date">
                    <CalendarDays size={14} color={colors.mutedForeground} />
                    <Text style={styles.chipText}>Pick…</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => setTimePickerOpen(true)}
                    style={[styles.chip, dueTime && styles.chipSet]}
                    accessibilityLabel={dueTime ? `At ${dueTimeLabel(dueTime)}. Change time` : "Add a time"}
                  >
                    <Clock size={14} color={dueTime ? colors.accentForeground : colors.mutedForeground} />
                    <Text style={[styles.chipText, dueTime && styles.chipTextSet]}>
                      {dueTime ? dueTimeLabel(dueTime) : "Time"}
                    </Text>
                  </Pressable>
                </View>
              </Collapse>
              {pickerOpen ? (
                <DateTimePicker value={date ?? new Date()} mode="date" display="default" onChange={onPicked} />
              ) : null}
              {timePickerOpen ? (
                <DateTimePicker
                  value={timeToday(dueTime ?? startTime(date))}
                  mode="time"
                  display="default"
                  onChange={onPickedTime}
                />
              ) : null}
            </>
          ) : null}

          <View style={styles.toolbar}>
            <Pressable
              onPress={() => toggle("project")}
              style={[styles.chip, expander === "project" && styles.chipOpen]}
              accessibilityLabel={`Project: ${projectName}. Change project`}
            >
              <Hash size={14} color={colors.mutedForeground} />
              <Text style={styles.chipText} numberOfLines={1}>
                {projectName}
              </Text>
            </Pressable>
            <Pressable
              onPress={() => (Platform.OS === "ios" ? (calendar ? closeCalendar() : openPicker()) : toggle("date"))}
              style={[styles.chip, date && styles.chipSet, (expander === "date" || calendar) && styles.chipOpen]}
              accessibilityLabel={
                date
                  ? `Due ${dateChipLabel(date)}${dueTime ? ` at ${dueTimeLabel(dueTime)}` : ""}. Change date`
                  : "Set a due date"
              }
            >
              {dateSource === "read" || timeSource === "read" ? (
                <Sparkles size={14} color={colors.accentForeground} />
              ) : (
                <CalendarDays size={14} color={date ? colors.accentForeground : colors.mutedForeground} />
              )}
              <Text style={[styles.chipText, date && styles.chipTextSet]} numberOfLines={1}>
                {date ? `${dateChipLabel(date)}${dueTime ? `, ${dueTimeLabel(dueTime)}` : ""}` : "Date"}
              </Text>
            </Pressable>
            <View style={styles.flex} />
            <Pressable
              onPress={() => void submit()}
              disabled={!canSend}
              style={[styles.send, !canSend && styles.sendDisabled]}
              accessibilityLabel="Add task"
            >
              {submitting ? (
                <ActivityIndicator color={colors.primaryForeground} />
              ) : (
                <ArrowUp size={20} color={colors.primaryForeground} strokeWidth={2.5} />
              )}
            </Pressable>
          </View>

          {error ? <Text style={styles.error}>{error}</Text> : null}

          {/* The keyboard's place: the calendar sits here while the keyboard
              is down, as tall as the keyboard, so the two can trade places
              under a box that stays still. */}
          {Platform.OS === "ios" && calendar ? (
            <Animated.View style={[styles.clip, slot.slotStyle]}>
              <Animated.View
                style={[styles.slotContent, slot.contentStyle]}
                onLayout={(event) => {
                  slot.contentHeight.value = event.nativeEvent.layout.height;
                }}
              >
                {/* One panel for the day and its time: the quick choices, the
                    calendar under them, and the time. Choosing here stays
                    here; tapping the line (or the date chip) goes back to
                    typing. */}
                <View style={styles.chips}>{dayChoices}</View>
                <DateTimePicker
                  value={date ?? new Date()}
                  mode="date"
                  display="inline"
                  accentColor={colors.primary}
                  themeVariant={dark ? "dark" : "light"}
                  onChange={onPicked}
                />
                <View style={styles.timeRow}>
                  <Clock size={18} color={dueTime ? colors.foreground : colors.mutedForeground} />
                  {dueTime ? (
                    <>
                      <Text style={styles.timeLabel}>Time</Text>
                      <View style={styles.grow} />
                      <DateTimePicker
                        value={timeToday(dueTime)}
                        mode="time"
                        display="compact"
                        minuteInterval={5}
                        accentColor={colors.primary}
                        themeVariant={dark ? "dark" : "light"}
                        onChange={onPickedTime}
                      />
                      <Pressable
                        onPress={() => chooseTime(null)}
                        hitSlop={8}
                        style={({ pressed }) => [styles.timeClear, pressed && styles.pressedDim]}
                        accessibilityRole="button"
                        accessibilityLabel="Remove the time"
                      >
                        <X size={18} color={colors.mutedForeground} />
                      </Pressable>
                    </>
                  ) : (
                    <Pressable
                      onPress={() => chooseTime(startTime(date))}
                      style={({ pressed }) => [styles.addTime, pressed && styles.pressedDim]}
                      accessibilityRole="button"
                      accessibilityLabel="Add a time"
                    >
                      <Text style={styles.addTimeText}>Add a time</Text>
                    </Pressable>
                  )}
                </View>
              </Animated.View>
            </Animated.View>
          ) : null}
        </View>
        </Animated.View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function makeStyles(colors: Colors, scale: number) {
  return StyleSheet.create({
    flex: { flex: 1, justifyContent: "flex-end" },
    backdrop: {
      position: "absolute",
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: "rgba(28, 27, 25, 0.4)",
    },
    fill: { flex: 1 },
    box: {
      backgroundColor: colors.card,
      borderTopLeftRadius: radius.lg,
      borderTopRightRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.border,
      paddingHorizontal: spacing[4],
      paddingTop: spacing[4],
    },
    // Each unfolding row carries its own space above it, so it takes none
    // at all when folded away.
    unfold: { paddingTop: spacing[3] },
    clip: { overflow: "hidden" },
    pressedDim: { opacity: 0.6 },
    slotContent: { position: "absolute", top: 0, left: 0, right: 0, paddingTop: spacing[3], gap: spacing[2] },
    // The time, under the calendar, ruled off from it.
    timeRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing[2],
      minHeight: 48,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
      paddingTop: spacing[2],
    },
    timeLabel: { fontFamily: fonts.base, fontSize: textSize.body * scale, color: colors.foreground },
    grow: { flex: 1 },
    timeClear: { width: 32, height: 32, alignItems: "center", justifyContent: "center" },
    addTime: { paddingVertical: spacing[2] },
    addTimeText: { fontFamily: fonts.baseSemi, fontSize: textSize.body * scale, color: colors.primary },
    input: {
      fontFamily: fonts.base,
      fontSize: textSize.large * scale,
      color: colors.foreground,
      paddingVertical: spacing[2],
      minHeight: 44,
    },
    row: { flexDirection: "row", alignItems: "center", gap: spacing[2] },
    chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing[2] },
    toolbar: { flexDirection: "row", alignItems: "center", gap: spacing[2], marginTop: spacing[3] },
    chip: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing[1],
      borderRadius: radius.full,
      borderWidth: 1,
      borderColor: colors.border,
      paddingHorizontal: spacing[3],
      paddingVertical: spacing[2],
      backgroundColor: colors.surface,
      maxWidth: 180,
    },
    chipSet: { backgroundColor: colors.accent, borderColor: colors.primary },
    chipOpen: { borderColor: colors.primary },
    chipDashed: { borderStyle: "dashed" },
    chipText: {
      fontFamily: fonts.baseSemi,
      fontSize: textSize.small * scale,
      color: colors.foreground,
    },
    chipTextSet: { color: colors.accentForeground },
    send: {
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: colors.primary,
      alignItems: "center",
      justifyContent: "center",
    },
    sendDisabled: { opacity: 0.4 },
    error: {
      marginTop: spacing[2],
      fontFamily: fonts.base,
      fontSize: textSize.small * scale,
      color: colors.error,
    },
  });
}
