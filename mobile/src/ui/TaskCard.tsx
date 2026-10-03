import React, { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import Animated, {
  interpolateColor,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";
import { useRouter } from "expo-router";
import { Bell, CalendarDays, Check, FileText, Repeat, Timer } from "lucide-react-native";
import { fonts, spacing, type Colors, textSize } from "../theme";
import { useAppTheme } from "../providers/AppThemeProvider";
import { formatPlannedDate } from "../lib/dates";
import { areaTag } from "../lib/lifeCenter";
import { linkedNoteIds } from "../lib/taskLinks";
import { focusMetaLabel } from "../lib/focus";
import { hapticDone, hapticTick, hapticUndone } from "../lib/haptics";
import { dueState, formatDue } from "../lib/taskDates";
import { dueTimeLabel, reminderLabel } from "../lib/reminderRules";
import type { TaskFocusSummary, TaskRecord, TaskStatus } from "../types";
import { SwipeToComplete } from "./SwipeToComplete";
import { UnsyncedMark } from "./UnsyncedMark";
import { useOnline } from "../sync/network";
import { useIsPending } from "../sync/SyncProvider";

// How long a row takes to settle into, or lift out of, its done field.
const SETTLE_MS = 280;
// Long enough to see the row settle before it moves to the done section.
const COMPLETE_DELAY_MS = 460;
// Done rows are soft fields with rounded corners; open rows are bare lines.
const FIELD_RADIUS = 12;
// The ring's diameter and stroke (design 2b: a neutral hairline, with
// colour kept for done), before the reader's text size.
const RING_SIZE = 22;
const RING_STROKE = 1.5;
const RING_GAP = 16;
// Rows reach this far past the text column on each side, so a done field
// frames its words and the text of open and done rows lines up.
const ROW_BLEED = 12;

type Props = {
  task: TaskRecord;
  showProject?: boolean;
  showNoteLink?: boolean;
  /** Off where every row shares the day, like a day's own task list. */
  showDue?: boolean;
  /** Change this value to make the row pulse twice — used to point at a task just added. */
  flashKey?: number;
  /**
   * "row" is the list row. "focus" is a row on Today: no due date (it is
   * today), its focus sessions, the timer, and where the person left off.
   */
  variant?: "row" | "focus";
  /** The title of the task's first linked note; falls back to "From your note". */
  noteTitle?: string;
  /** Where Catch up moved this task from, shown on Today. */
  movedFrom?: Date | null;
  /** Sessions, time, and where the person left off, for Today. */
  focusSummary?: TaskFocusSummary;
  onStatusChange: (status: TaskStatus) => void;
  /** Tapping the row: the task's own screen. */
  onOpen: () => void;
  /** Pressing and holding the row: its quick menu. */
  onLongPress?: () => void;
  /** Today only: the small timer button, which opens focus setup. */
  onStartFocus?: () => void;
};

/**
 * A task as a "settled row" (design 3f). Open tasks are bare text on a
 * hairline, with their area and day beneath; there is no checkbox. Done tasks
 * settle into a soft teal field with a check at the end.
 *
 * Tapping opens the task; pressing and holding opens its quick menu; pulling
 * the row to the right marks it done (or, when done, not done) straight away.
 */
/**
 * Rows only redraw when what they show changes, not every time their list
 * does: the parents' callbacks are recreated each render but do the same
 * thing (they act on this task), so they are left out of the comparison.
 * The row's sync mark and theme still update through their own hooks.
 */
function sameRow(a: Props, b: Props): boolean {
  return (
    a.task === b.task &&
    a.showProject === b.showProject &&
    a.showNoteLink === b.showNoteLink &&
    a.showDue === b.showDue &&
    a.flashKey === b.flashKey &&
    a.variant === b.variant &&
    a.noteTitle === b.noteTitle &&
    (a.movedFrom?.getTime() ?? null) === (b.movedFrom?.getTime() ?? null) &&
    a.focusSummary === b.focusSummary &&
    Boolean(a.onStartFocus) === Boolean(b.onStartFocus) &&
    Boolean(a.onLongPress) === Boolean(b.onLongPress)
  );
}

export const TaskCard = React.memo(TaskCardRow, sameRow);

function TaskCardRow({
  task,
  showProject = true,
  showNoteLink = true,
  showDue = true,
  flashKey,
  variant = "row",
  noteTitle,
  movedFrom,
  focusSummary,
  onStatusChange,
  onOpen,
  onLongPress,
  onStartFocus,
}: Props) {
  const router = useRouter();
  const online = useOnline();
  const { colors, scale } = useAppTheme();
  const styles = stylesFor(colors, scale);
  const done = task.status === "done";
  const focus = variant === "focus";
  const due = task.completeBy ? dueState(task.completeBy) : null;

  // The lists group rows by status, so changing the status moves the row
  // under a different parent and React mounts a fresh one there, already
  // settled. So the row settles here first, where it sits, and the status
  // change follows once that has played.
  const [pendingDone, setPendingDone] = useState<boolean | null>(null);
  const shownDone = pendingDone ?? done;
  const completeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (pendingDone !== null && pendingDone === done) setPendingDone(null);
  }, [done, pendingDone]);
  // A repeating task ticked off is not finished: it moves on to its next day
  // and stays open. Once it has, the row lifts out of its done field again.
  const repeatDay = task.remindRepeat ? task.completeBy?.getTime() : undefined;
  const lastRepeatDay = useRef(repeatDay);
  useEffect(() => {
    if (repeatDay === lastRepeatDay.current) return;
    lastRepeatDay.current = repeatDay;
    if (pendingDone === true && !done) setPendingDone(null);
  }, [repeatDay, pendingDone, done]);
  useEffect(
    () => () => {
      if (completeTimer.current) clearTimeout(completeTimer.current);
    },
    [],
  );
  // Any move into or out of done plays here first, then the status is sent
  // and the row changes section. Moves between the open states are immediate.
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

  // 0 is an open row, 1 a settled done field. Settled on first render and
  // animated only on a real change, so finished tasks do not settle on load.
  const settle = useSharedValue(shownDone ? 1 : 0);
  const settledOnce = useRef(false);
  useEffect(() => {
    if (!settledOnce.current) {
      settledOnce.current = true;
      return;
    }
    settle.value = withTiming(shownDone ? 1 : 0, { duration: SETTLE_MS });
  }, [shownDone, settle]);

  const fieldStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(settle.value, [0, 1], [colors.background, colors.accent]),
    borderRadius: FIELD_RADIUS * settle.value,
  }));
  const hairlineStyle = useAnimatedStyle(() => ({ opacity: 1 - settle.value }));
  const textStyle = useAnimatedStyle(() => ({
    color: interpolateColor(settle.value, [0, 1], [colors.foreground, colors.accentForeground]),
  }));
  // The ring's room: full while open, none once settled, so the words glide
  // to the field's edge rather than jump.
  const ringSlotStyle = useAnimatedStyle(() => ({
    width: (RING_SIZE * scale + RING_GAP) * (1 - settle.value),
    opacity: 1 - settle.value,
  }));

  // Two soft pulses of the accent over the row, then gone. Only when the key
  // changes, so a row mounting with a key does not flash on its own; the
  // pulse exists only while it plays.
  const [pulse, setPulse] = useState<number | null>(null);
  const lastFlashKey = useRef(flashKey);
  useEffect(() => {
    if (flashKey === undefined || flashKey === lastFlashKey.current) return;
    lastFlashKey.current = flashKey;
    setPulse(flashKey);
  }, [flashKey]);
  const endPulse = useCallback(() => setPulse(null), []);

  const focusMeta = focus && focusSummary ? focusMetaLabel(focusSummary) : null;
  const leftOff =
    focus && !shownDone && focusSummary?.lastLeftOff.trim() && focusSummary.lastOutcome !== "finished"
      ? focusSummary.lastLeftOff.trim()
      : null;
  const showTimerButton = focus && !shownDone && Boolean(onStartFocus);

  // What sits under an open task's words: its area, then its day, its focus
  // time or where it was moved from, then the note it came from.
  // Changed while offline: say it is still only on this phone.
  const waitingOffline = useIsPending(`task:${task.id}`) && !online;
  const metaParts: React.ReactNode[] = [];
  if (showProject) {
    metaParts.push(
      <Text key="area" style={styles.meta}>
        {areaTag(task.projectName)}
      </Text>,
    );
  }
  if (focus && focusMeta) {
    metaParts.push(
      <Text key="focus" style={styles.meta}>
        {focusMeta}
      </Text>,
    );
  } else if (focus && movedFrom) {
    metaParts.push(
      <Text key="moved" style={styles.meta}>
        Moved here from {formatPlannedDate(movedFrom)}
      </Text>,
    );
  } else if (!focus && showDue && task.completeBy && due) {
    metaParts.push(
      <View key="due" style={styles.metaItem}>
        {due === "overdue" ? <CalendarDays size={13} color={colors.warning} /> : null}
        <Text style={[styles.meta, due === "overdue" && styles.overdueText]}>
          {formatDue(task.completeBy)}
          {task.dueTime ? `, ${dueTimeLabel(task.dueTime)}` : ""}
        </Text>
      </View>,
    );
  }
  // Where the day goes without saying (a day's own list, Today), its time.
  if (task.completeBy && task.dueTime && (focus || !showDue)) {
    metaParts.push(
      <Text key="time" style={styles.meta}>
        {dueTimeLabel(task.dueTime)}
      </Text>,
    );
  }
  // Its reminder, counted back from its time, and whether it repeats.
  if (task.completeBy && (task.remindBefore != null || task.remindRepeat)) {
    metaParts.push(
      <View key="reminder" style={styles.metaItem}>
        {task.remindBefore != null ? (
          <>
            <Bell size={13} color={colors.mutedForeground} />
            <Text style={styles.meta}>{reminderLabel(task.remindBefore, Boolean(task.dueTime))}</Text>
          </>
        ) : null}
        {task.remindRepeat ? <Repeat size={12} color={colors.mutedForeground} /> : null}
      </View>,
    );
  }
  if (waitingOffline) metaParts.push(<UnsyncedMark key="unsynced" subject={`task:${task.id}`} />);
  // One linked note is named and opens; several are counted and open the
  // task's notes, with their summary.
  const noteIds = linkedNoteIds(task);
  if (showNoteLink && noteIds.length > 0 && !(focus && focusMeta)) {
    const single = noteIds.length === 1;
    const label = single ? (noteTitle?.trim() ? noteTitle.trim() : "From your note") : `${noteIds.length} notes`;
    metaParts.push(
      <Pressable
        key="note"
        style={styles.metaItem}
        onPress={() => router.push(single ? `/note/${noteIds[0]}` : `/task/${task.id}`)}
        accessibilityLabel={single ? `Open the note: ${label}` : `See this task's ${noteIds.length} notes`}
      >
        <FileText size={13} color={colors.primary} />
        <Text style={[styles.meta, styles.noteLink]} numberOfLines={1}>
          {label}
        </Text>
      </Pressable>,
    );
  }

  return (
    <SwipeToComplete
      done={shownDone}
      onSwipe={toggleDone}
      enabled={pendingDone === null}
      radius={shownDone ? FIELD_RADIUS : 0}
      style={[styles.bleed, shownDone && styles.doneSpacing]}
    >
      <Animated.View style={[styles.row, shownDone ? styles.rowDone : styles.rowOpen, fieldStyle]}>
        {pulse !== null ? <FlashPulse key={pulse} style={styles.flash} onDone={endPulse} /> : null}
        <View style={styles.line}>
          {/* The ring (2b): a thin grey outline, so colour means done.
              Tapping it marks the task done; it shrinks away as the row
              settles into its teal done field. */}
          <Animated.View style={[styles.ringSlot, ringSlotStyle]}>
            <Pressable
              onPress={toggleDone}
              disabled={shownDone}
              hitSlop={{ top: 11, bottom: 11, left: 11, right: 8 }}
              style={({ pressed }) => [styles.ring, pressed && styles.ringPressed]}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: shownDone }}
              accessibilityLabel="Mark done"
              accessibilityElementsHidden={shownDone}
              importantForAccessibility={shownDone ? "no-hide-descendants" : "auto"}
            />
          </Animated.View>
          <Pressable
            style={({ pressed }) => [styles.body, pressed && styles.pressed]}
            onPress={onOpen}
            onLongPress={
              onLongPress
                ? () => {
                    hapticTick();
                    onLongPress();
                  }
                : undefined
            }
            accessibilityRole="button"
            accessibilityLabel={`${task.text}${shownDone ? ", done" : ""}`}
            accessibilityHint="Opens the task. Swipe right to mark it done."
            accessibilityActions={[{ name: "toggle", label: shownDone ? "Mark not done" : "Mark done" }]}
            onAccessibilityAction={(event) => {
              if (event.nativeEvent.actionName === "toggle") toggleDone();
            }}
          >
            <Animated.Text style={[styles.text, textStyle]}>{task.text}</Animated.Text>
            {!shownDone && metaParts.length > 0 ? (
              <View style={styles.metaRow}>
                {metaParts.map((part, index) => (
                  <React.Fragment key={index}>
                    {index > 0 ? <Text style={styles.sep}>·</Text> : null}
                    {part}
                  </React.Fragment>
                ))}
              </View>
            ) : null}
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
          {shownDone ? <DoneCheck settle={settle} style={styles.check} color={colors.primary} /> : null}
        </View>

        {leftOff ? (
          <View style={styles.leftOffBox}>
            <Text style={styles.leftOffLabel}>WHERE YOU LEFT OFF</Text>
            <Text style={styles.leftOffText}>{leftOff}</Text>
          </View>
        ) : null}
        {/* The open row's hairline, which fades as the row settles. */}
        <Animated.View pointerEvents="none" style={[styles.hairline, hairlineStyle]} />
      </Animated.View>
    </SwipeToComplete>
  );
}

/** The trailing check of a done field, growing in as the row settles. */
function DoneCheck({
  settle,
  style,
  color,
}: {
  settle: SharedValue<number>;
  style: StyleProp<ViewStyle>;
  color: string;
}) {
  const checkStyle = useAnimatedStyle(() => ({
    opacity: settle.value,
    transform: [{ scale: 0.6 + 0.4 * settle.value }],
  }));
  return (
    <Animated.View style={[style, checkStyle]} pointerEvents="none">
      <Check size={18} color={color} strokeWidth={2.4} />
    </Animated.View>
  );
}

/** Two soft pulses of the accent over a row, to point at it. */
function FlashPulse({ style, onDone }: { style: StyleProp<ViewStyle>; onDone: () => void }) {
  const flash = useSharedValue(0);
  useEffect(() => {
    flash.value = withSequence(
      withTiming(1, { duration: 180 }),
      withTiming(0, { duration: 320 }),
      withTiming(1, { duration: 180 }),
      withTiming(0, { duration: 460 }, (finished) => {
        if (finished) runOnJS(onDone)();
      }),
    );
    // Plays once, on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const flashStyle = useAnimatedStyle(() => ({ opacity: flash.value * 0.3 }));
  return <Animated.View pointerEvents="none" style={[style, flashStyle]} />;
}

// One set of styles per theme and text size, shared by every row rather than
// built again for each.
const styleCache = new WeakMap<Colors, Map<number, ReturnType<typeof makeStyles>>>();
function stylesFor(colors: Colors, scale: number) {
  let byScale = styleCache.get(colors);
  if (!byScale) {
    byScale = new Map();
    styleCache.set(colors, byScale);
  }
  let styles = byScale.get(scale);
  if (!styles) {
    styles = makeStyles(colors, scale);
    byScale.set(scale, styles);
  }
  return styles;
}

function makeStyles(colors: Colors, scale: number) {
  return StyleSheet.create({
    bleed: { marginHorizontal: -ROW_BLEED },
    // Done fields sit a little apart from each other; open rows share hairlines.
    doneSpacing: { marginBottom: 6 },
    row: { paddingHorizontal: ROW_BLEED, gap: spacing[3], overflow: "hidden" },
    rowOpen: { paddingVertical: 14 },
    rowDone: { paddingVertical: 12 },
    line: { flexDirection: "row", alignItems: "flex-start" },
    ringSlot: { overflow: "hidden" },
    ring: {
      width: RING_SIZE * scale,
      height: RING_SIZE * scale,
      borderRadius: (RING_SIZE * scale) / 2,
      borderWidth: RING_STROKE,
      borderColor: colors.ring,
      // Centred on the first line of text.
      marginTop: (22 * scale - RING_SIZE * scale) / 2,
    },
    ringPressed: { backgroundColor: colors.accent },
    body: { flex: 1, gap: 5 },
    pressed: { opacity: 0.7 },
    text: {
      fontFamily: fonts.base,
      fontSize: textSize.body * scale,
      lineHeight: 22 * scale,
      color: colors.foreground,
    },
    metaRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", columnGap: spacing[2], rowGap: 2 },
    metaItem: { flexDirection: "row", alignItems: "center", gap: 5, flexShrink: 1 },
    meta: { fontFamily: fonts.base, fontSize: textSize.small * scale, color: colors.mutedForeground },
    sep: { fontFamily: fonts.base, fontSize: textSize.small * scale, color: colors.mutedForeground },
    noteLink: { color: colors.primary },
    overdueText: { color: colors.warning },
    // The trailing check of a done field.
    check: { marginTop: 2 * scale, marginLeft: spacing[3] },
    timerButton: {
      marginLeft: spacing[3],
      width: 40,
      height: 40,
      borderRadius: 20,
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: "center",
      justifyContent: "center",
    },
    leftOffBox: {
      borderRadius: 10,
      backgroundColor: colors.surface,
      padding: spacing[3],
      gap: 4,
    },
    leftOffLabel: {
      fontFamily: fonts.baseSemi,
      fontSize: textSize.label * scale,
      letterSpacing: 1,
      color: colors.mutedForeground,
    },
    leftOffText: { fontFamily: fonts.base, fontSize: textSize.body * scale, lineHeight: 22 * scale, color: colors.foreground },
    hairline: {
      position: "absolute",
      left: 0,
      right: 0,
      bottom: 0,
      height: StyleSheet.hairlineWidth,
      backgroundColor: colors.border,
    },
    flash: {
      position: "absolute",
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: colors.primary,
    },
  });
}
