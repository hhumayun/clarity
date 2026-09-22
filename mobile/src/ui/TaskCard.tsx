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
  onStatusChange: (status: TaskStatus) => void;
  onEdit: () => void;
  onDelete: () => Promise<void>;
};

export function TaskCard({
  task,
  showProject = true,
  showNoteLink = true,
  flashKey,
  onStatusChange,
  onEdit,
  onDelete,
}: Props) {
  const router = useRouter();
  const toast = useToast();
  const { colors, scale } = useAppTheme();
  const styles = useMemo(() => makeStyles(colors, scale), [colors, scale]);
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const done = task.status === "done";
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

  return (
    <View style={[styles.card, shownDone && styles.done]}>
      <Animated.View pointerEvents="none" style={[styles.flash, flashStyle]} />
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

      <View style={styles.body}>
        <View>
          <Pressable onPress={onEdit}>
            <Text
              style={[styles.text, shownDone && styles.textDone]}
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
          </Pressable>
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
                  changeStatus(status);
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
    text: {
      fontFamily: fonts.baseSemi,
      fontSize: 16 * scale,
      color: colors.foreground,
    },
    textDone: { color: colors.mutedForeground },
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
