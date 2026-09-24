import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  type TextLayoutLine,
} from "react-native";
import Animated, {
  type SharedValue,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { useRouter } from "expo-router";
import { CalendarDays, Check, FileText, Play, Timer } from "lucide-react-native";
import { fonts, radius, spacing, type Colors } from "../theme";
import { useAppTheme } from "../providers/AppThemeProvider";
import { formatClockTime, formatPlannedDate } from "../lib/dates";
import { areaColor } from "../lib/lifeCenter";
import { focusMetaLabel } from "../lib/focus";
import { hapticDone, hapticUndone } from "../lib/haptics";
import { dueState, formatDue } from "../lib/taskDates";
import type { TaskFocusSummary, TaskRecord, TaskStatus } from "../types";

const TICK_SPRING = { damping: 13, stiffness: 240, mass: 0.6 };
const STRIKE_MS = 260;
// Long enough for the tick to land and the line to finish before the card
// moves to the done section.
const COMPLETE_DELAY_MS = 460;

/**
 * One line drawn across one line of text. Separate component because each
 * needs its own animated width, and hooks cannot be called from a map.
 */
function StrikeLine({
  progress,
  line,
  color,
}: {
  progress: SharedValue<number>;
  line: { x: number; y: number; width: number; height: number };
  color: string;
}) {
  const style = useAnimatedStyle(() => ({ width: progress.value * line.width }));
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        {
          position: "absolute",
          left: line.x,
          top: line.y + line.height / 2 - 1,
          height: 2,
          borderRadius: 1,
          backgroundColor: color,
        },
        style,
      ]}
    />
  );
}

type Props = {
  task: TaskRecord;
  showProject?: boolean;
  showNoteLink?: boolean;
  /** Change this value to make the card pulse twice — used to point at a task just added. */
  flashKey?: number;
  /**
   * "row" is the list card. "focus" is the larger card on Today: bigger text,
   * no due date (it is today), and a finished task shows when it was done.
   */
  variant?: "row" | "focus";
  /** The note's title, when the task came from one; falls back to "From your note". */
  noteTitle?: string;
  /** Where Catch up moved this task from, shown on the Today card. */
  movedFrom?: Date | null;
  /** Sessions, time, and where the person left off, for the Today card. */
  focusSummary?: TaskFocusSummary;
  onStatusChange: (status: TaskStatus) => void;
  /**
   * Tapping the card. Opens the task's action panel, which replaced the old
   * "…" menu: focus, done, move, edit, and delete from the edit form.
   */
  onOpen: () => void;
  /** Today card only: the small timer button, which opens focus setup. */
  onStartFocus?: () => void;
  /** Today card only: pick up from "where you left off". */
  onContinueFocus?: () => void;
};

export function TaskCard({
  task,
  showProject = true,
  showNoteLink = true,
  flashKey,
  variant = "row",
  noteTitle,
  movedFrom,
  focusSummary,
  onStatusChange,
  onOpen,
  onStartFocus,
  onContinueFocus,
}: Props) {
  const router = useRouter();
  const { colors, scale, dark } = useAppTheme();
  const styles = useMemo(() => makeStyles(colors, scale), [colors, scale]);
  const done = task.status === "done";
  const focus = variant === "focus";
  const due = task.completeBy ? dueState(task.completeBy) : null;

  // Both lists group cards by status, so changing the status moves the card
  // under a different parent and React mounts a fresh one there — which would
  // arrive already done and never animate. So the animation runs here first,
  // on the card as it sits, and the status change follows once it has played.
  const [pendingDone, setPendingDone] = useState<boolean | null>(null);
  const shownDone = pendingDone ?? done;
  const completeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (pendingDone !== null && pendingDone === done) setPendingDone(null);
  }, [done, pendingDone]);
  useEffect(
    () => () => {
      if (completeTimer.current) clearTimeout(completeTimer.current);
    },
    [],
  );
  // Any move into or out of done plays here first — the circle, the tick and
  // the line run in reverse on the way out — then the status is sent and the
  // card changes section. Moves between the open columns are immediate.
  const changeStatus = (next: TaskStatus) => {
    const entering = next === "done" && !done;
    const leaving = next !== "done" && done;
    if (!entering && !leaving) {
      onStatusChange(next);
      return;
    }
    if (pendingDone !== null) return;
    if (entering) hapticDone();
    else hapticUndone();
    setPendingDone(entering);
    if (completeTimer.current) clearTimeout(completeTimer.current);
    completeTimer.current = setTimeout(() => onStatusChange(next), COMPLETE_DELAY_MS);
  };
  const toggleDone = () => changeStatus(done ? "todo" : "done");

  const [textLines, setTextLines] = useState<
    { x: number; y: number; width: number; height: number }[]
  >([]);

  // Settled state on first render, animated only on a real change — otherwise
  // every finished task on the board would tick itself off on load.
  const tick = useSharedValue(shownDone ? 1 : 0);
  const strike = useSharedValue(shownDone ? 1 : 0);
  const settled = useRef(false);
  useEffect(() => {
    if (!settled.current) {
      settled.current = true;
      return;
    }
    tick.value = withSpring(shownDone ? 1 : 0, TICK_SPRING);
    strike.value = withTiming(shownDone ? 1 : 0, { duration: STRIKE_MS });
  }, [shownDone, tick, strike]);

  const fillStyle = useAnimatedStyle(() => ({
    opacity: tick.value,
    transform: [{ scale: 0.4 + 0.6 * tick.value }],
  }));

  // Two soft pulses of the accent over the card, then gone. Only runs when the
  // key changes, so a card mounting with a key does not flash on its own.
  const flash = useSharedValue(0);
  const lastFlashKey = useRef(flashKey);
  useEffect(() => {
    if (flashKey === undefined || flashKey === lastFlashKey.current) return;
    lastFlashKey.current = flashKey;
    flash.value = withSequence(
      withTiming(1, { duration: 180 }),
      withTiming(0, { duration: 320 }),
      withTiming(1, { duration: 180 }),
      withTiming(0, { duration: 460 }),
    );
  }, [flashKey, flash]);
  const flashStyle = useAnimatedStyle(() => ({ opacity: flash.value * 0.35 }));
  const tickStyle = useAnimatedStyle(() => ({
    opacity: tick.value,
    transform: [{ scale: tick.value }],
  }));

  const focusMeta = focus && focusSummary ? focusMetaLabel(focusSummary) : null;
  const leftOff =
    focus && !shownDone && focusSummary?.lastLeftOff.trim() && focusSummary.lastOutcome !== "finished"
      ? focusSummary.lastLeftOff.trim()
      : null;
  const continueMinutes = focusSummary?.lastPlannedMinutes ?? 15;
  const showTimerButton = focus && !shownDone && !leftOff && Boolean(onStartFocus);

  return (
    <View
      style={[
        styles.card,
        focus && styles.cardFocus,
        leftOff && styles.cardContinue,
        shownDone && (focus ? styles.doneFocus : styles.done),
      ]}
    >
      <Animated.View pointerEvents="none" style={[styles.flash, flashStyle]} />
      <View style={[styles.row, focus && styles.rowFocus]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={shownDone ? "Mark as not done" : "Mark as done"}
          onPress={toggleDone}
          style={styles.check}
        >
          <Animated.View style={[styles.checkFill, fillStyle]} />
          <Animated.View style={tickStyle}>
            <Check size={18} color={colors.primaryForeground} />
          </Animated.View>
        </Pressable>

        <Pressable
          style={styles.body}
          onPress={onOpen}
          accessibilityRole="button"
          accessibilityLabel={`${task.text}. Open task`}
        >
          <View>
            <Text
              style={[styles.text, focus && styles.textFocus, shownDone && styles.textDone]}
              onTextLayout={(event) =>
                setTextLines(
                  event.nativeEvent.lines.map((line: TextLayoutLine) => ({
                    x: line.x,
                    y: line.y,
                    width: line.width,
                    height: line.height,
                  })),
                )
              }
            >
              {task.text}
            </Text>
            {textLines.map((line, index) => (
              <StrikeLine
                key={index}
                progress={strike}
                line={line}
                color={colors.mutedForeground}
              />
            ))}
          </View>
          <View style={styles.meta}>
            {showProject ? (
              <View style={styles.metaItem}>
                <View style={[styles.dot, { backgroundColor: areaColor(task.projectId, dark) }]} />
                <Text style={styles.chip}>{task.projectName}</Text>
              </View>
            ) : null}
            {focus && shownDone ? (
              <>
                {showProject ? <Text style={styles.sep}>·</Text> : null}
                <Text style={styles.chip}>Done at {formatClockTime(task.updatedAt)}</Text>
              </>
            ) : null}
            {focus && !shownDone && focusMeta ? (
              <>
                {showProject ? <Text style={styles.sep}>·</Text> : null}
                <Text style={styles.chip}>{focusMeta}</Text>
              </>
            ) : null}
            {focus && !shownDone && !focusMeta && movedFrom ? (
              <>
                {showProject ? <Text style={styles.sep}>·</Text> : null}
                <Text style={styles.chip}>Moved here from {formatPlannedDate(movedFrom)}</Text>
              </>
            ) : null}
            {!focus && task.completeBy && due ? (
              <>
                {showProject ? <Text style={styles.sep}>·</Text> : null}
                <View style={styles.metaItem}>
                  {due === "overdue" && !done ? (
                    <CalendarDays size={13} color={colors.warning} />
                  ) : null}
                  <Text style={[styles.chip, due === "overdue" && !done && styles.overdueText]}>
                    {formatDue(task.completeBy)}
                  </Text>
                </View>
              </>
            ) : null}
            {showNoteLink && task.noteId && !(focus && (shownDone || focusMeta)) ? (
              <>
                <Text style={styles.sep}>·</Text>
                <Pressable
                  style={styles.metaItem}
                  onPress={() => router.push(`/note/${task.noteId}`)}
                  accessibilityLabel={`Open the note${noteTitle ? `: ${noteTitle}` : ""}`}
                >
                  <FileText size={13} color={colors.primary} />
                  <Text style={[styles.chip, styles.noteLink]} numberOfLines={1}>
                    {noteTitle?.trim() ? noteTitle.trim() : "From your note"}
                  </Text>
                </Pressable>
              </>
            ) : null}
          </View>
        </Pressable>

        {showTimerButton ? (
          <Pressable
            onPress={onStartFocus}
            style={styles.timerButton}
            accessibilityRole="button"
            accessibilityLabel={`Start focus time on ${task.text}`}
          >
            <Timer size={20} color={colors.mutedForeground} />
          </Pressable>
        ) : null}
      </View>

      {leftOff ? (
        <View style={styles.continueBlock}>
          <View style={styles.leftOffBox}>
            <Text style={styles.leftOffLabel}>WHERE YOU LEFT OFF</Text>
            <Text style={styles.leftOffText}>{leftOff}</Text>
          </View>
          {onContinueFocus ? (
            <Pressable
              style={({ pressed }) => [styles.continueButton, pressed && styles.pressed]}
              onPress={onContinueFocus}
              accessibilityRole="button"
              accessibilityLabel={`Continue focus time, ${continueMinutes} minutes`}
            >
              <Play size={16} color={colors.primaryForeground} fill={colors.primaryForeground} />
              <Text style={styles.continueText}>Continue · {continueMinutes} min</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

function makeStyles(colors: Colors, scale: number) {
  return StyleSheet.create({
    card: {
      gap: spacing[3],
      backgroundColor: colors.card,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      padding: spacing[3],
    },
    row: { flexDirection: "row", alignItems: "flex-start", gap: spacing[3] },
    rowFocus: { alignItems: "center" },
    cardContinue: { borderColor: colors.primary },
    cardFocus: {
      paddingVertical: spacing[4],
      paddingHorizontal: spacing[4],
      borderRadius: radius.lg,
    },
    done: { opacity: 0.72 },
    // Finished on Today: dashed and set back, so it reads as put down, not gone.
    doneFocus: { borderStyle: "dashed", backgroundColor: "transparent" },
    flash: {
      position: "absolute",
      top: -1,
      left: -1,
      right: -1,
      bottom: -1,
      borderRadius: radius.md,
      backgroundColor: colors.primary,
    },
    check: {
      overflow: "visible",
      width: 28,
      height: 28,
      borderRadius: 14,
      borderWidth: 2,
      borderColor: colors.primary,
      alignItems: "center",
      justifyContent: "center",
      marginTop: 2,
    },
    checkFill: {
      position: "absolute",
      top: -2,
      left: -2,
      right: -2,
      bottom: -2,
      borderRadius: 14,
      backgroundColor: colors.primary,
    },
    body: { flex: 1, gap: spacing[2] },
    pressed: { opacity: 0.85 },
    timerButton: {
      width: 44,
      height: 44,
      borderRadius: 22,
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: "center",
      justifyContent: "center",
    },
    continueBlock: { gap: spacing[3] },
    leftOffBox: {
      borderRadius: radius.sm,
      backgroundColor: colors.surface,
      padding: spacing[3],
      gap: 4,
    },
    leftOffLabel: {
      fontFamily: fonts.baseSemi,
      fontSize: 11 * scale,
      letterSpacing: 1,
      color: colors.mutedForeground,
    },
    leftOffText: { fontFamily: fonts.base, fontSize: 15 * scale, lineHeight: 21 * scale, color: colors.foreground },
    continueButton: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: spacing[2],
      minHeight: 48,
      borderRadius: radius.sm,
      backgroundColor: colors.primary,
    },
    continueText: { fontFamily: fonts.baseBold, fontSize: 16 * scale, color: colors.primaryForeground },
    text: {
      fontFamily: fonts.baseSemi,
      fontSize: 16 * scale,
      color: colors.foreground,
    },
    textFocus: { fontSize: 18 * scale },
    textDone: { color: colors.mutedForeground },
    meta: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", columnGap: spacing[2], rowGap: 2 },
    metaItem: { flexDirection: "row", alignItems: "center", gap: 5, flexShrink: 1 },
    dot: { width: 7, height: 7, borderRadius: 4 },
    sep: { fontFamily: fonts.base, fontSize: 13 * scale, color: colors.mutedForeground },
    noteLink: { color: colors.primary },
    chipWrap: { flexDirection: "row", alignItems: "center", gap: 4 },
    chip: {
      fontFamily: fonts.base,
      fontSize: 13 * scale,
      color: colors.mutedForeground,
    },
    overdue: {},
    overdueText: { color: colors.warning },
  });
}
