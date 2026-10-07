import { useRouter } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, View, type NativeSyntheticEvent, type TextLayoutEventData } from "react-native";
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withDelay, withSequence, withTiming } from "react-native-reanimated";
import { useFocusHistory } from "../data/hooks";
import type { Task } from "../store/model";
import { clockLabel, dueMeta, shortDate, whenLabel } from "../store/selectors";
import { useSage, useUnsent } from "../data/sage";
import { duration, easeOut, fadeTiming, leave } from "../theme/motion";
import { useTheme } from "../theme/ThemeProvider";
import { pad, space } from "../theme/tokens";
import { useAcknowledge } from "./Acknowledgement";
import { CircleCheck } from "./CircleCheck";
import { done as doneHaptic, tap, tick } from "./haptics";
import { Icon, type IconName } from "./Icon";
import { SwipeRow } from "./SwipeRow";
import { calmRows, rowLook, type RowLook } from "./rowLook";
import { useTaskMenu } from "./TaskMenu";
import { Txt, type Tone } from "./Txt";

/** A ticked row rests this long, struck through, before it moves to Done. */
const SETTLE_MS = 640;
/** The most a ticked row holds its tick waiting for the change to land (an account's answer comes a moment later). */
const HOLD_TICK_MS = 2_500;

export type TaskVariant = "today" | "list" | "day" | "note";

/** The day's times, in the "sequence" look: the column's width. */
export const TIME_COLUMN = 60;

/**
 * One task on a card: the words on the left, a line of small icons under
 * them, and Rosebud's check on the right, under the thumb. Tick it (or
 * swipe right) and the check fills, a line is drawn through the words one
 * line at a time, and the row rests a beat before it leaves for Done.
 * Swipe left to focus on it. Tap the words to open it; long-press for the
 * quick menu. Its area is a grey word, nothing more.
 */
export const TaskRow = React.memo(function TaskRow({
  task,
  variant = "list",
  showArea = true,
  noteId,
  highlight,
}: {
  task: Task;
  variant?: TaskVariant;
  showArea?: boolean;
  /** Set inside a note's tasks, so the menu can offer "Remove from this note". */
  noteId?: string;
  /** A row just added: it glows twice where it landed. */
  highlight?: boolean;
}) {
  const { colors } = useTheme();
  const router = useRouter();
  const reduced = useReducedMotion();
  const history = useFocusHistory(task.id);
  // Only the title of the note it came from: the whole list would redraw every row whenever any note changed.
  const fromNote = useSage((state) => (task.noteIds.length ? (state.notes.find((note) => note.id === task.noteIds[0])?.title ?? null) : null));
  const setDone = useSage((state) => state.setDone);
  const acknowledge = useAcknowledge();
  const openMenu = useTaskMenu();
  const row = useRef<View>(null);
  // A swipe ends with the finger lifting over the row: that isn't a tap.
  const swiping = useRef(false);
  const onSwipe = (now: boolean) => {
    if (now) swiping.current = true;
    else setTimeout(() => (swiping.current = false), 250);
  };

  const [ticking, setTicking] = useState(false);
  const [checkDown, setCheckDown] = useState(false);
  const checked = task.done || ticking;
  // Once ticked, the row keeps its tick until the change has landed: the task is done where it's
  // kept (for an account, a moment later), or a repeating task has moved on to its next day. Letting
  // go sooner showed it un-ticked for a frame as it left, which read as "undone".
  const tickedDay = useRef<Task["day"] | undefined>(undefined);
  useEffect(() => {
    if (!ticking || tickedDay.current === undefined) return;
    if (task.done || task.day !== tickedDay.current) {
      tickedDay.current = undefined;
      setTicking(false);
    }
  }, [task.done, task.day, ticking]);

  const wash = useSharedValue(0);
  const washStyle = useAnimatedStyle(() => ({ opacity: wash.value }));
  useEffect(() => {
    if (!highlight) return;
    wash.value = withSequence(
      withTiming(1, fadeTiming(280)),
      withTiming(0, fadeTiming(420)),
      withTiming(1, fadeTiming(280)),
      withTiming(0, fadeTiming(700)),
    );
  }, [highlight, wash]);

  const toggle = () => {
    if (ticking) return;
    if (task.done) {
      tap();
      setDone(task.id, false);
      return;
    }
    doneHaptic();
    setTicking(true);
    setTimeout(
      () => {
        tickedDay.current = task.day;
        const next = setDone(task.id, true);
        if (next) {
          // A repeating task is open again at its next day: the tick eases back and the line fades.
          tickedDay.current = undefined;
          setTicking(false);
          acknowledge(`Next: ${whenLabel({ day: next, time: task.time })}`, "repeat");
          return;
        }
        // If the change never lands (it failed and was put back), the row shows it as it is.
        setTimeout(() => {
          if (tickedDay.current === undefined) return;
          tickedDay.current = undefined;
          setTicking(false);
        }, HOLD_TICK_MS);
      },
      reduced ? 300 : SETTLE_MS,
    );
  };

  const focus = () => {
    tap();
    router.push(`/focus/${task.id}`);
  };

  const showMenu = () => {
    if (swiping.current) return;
    tick();
    row.current?.measureInWindow((x, y, width, height) => openMenu({ taskId: task.id, rect: { x, y, width, height }, noteId }));
  };

  const unsent = useUnsent(`task:${task.id}`);
  // The meta line: small icons first, words only where an icon can't say it.
  const meta: React.ReactNode[] = [];
  const add = (key: string, icon: IconName | null, text: string | null, tone: Tone = "ink3", lead?: React.ReactNode) =>
    meta.push(
      <View key={key} style={styles.piece}>
        {lead}
        {icon ? <Icon name={icon} size={13} color={tone === "warm" ? colors.warm : tone === "ink2" ? colors.ink2 : colors.ink3} weight="medium" /> : null}
        {text ? (
          <Txt variant="footnote" tone={tone} numberOfLines={1} style={styles.pieceText}>
            {text}
          </Txt>
        ) : null}
      </View>,
    );
  if (!task.done) {
    if (showArea) add("area", null, task.area, "ink3");
    if (variant === "today" || variant === "day") {
      if (task.movedFrom && variant === "today") add("moved", "toLine", shortDate(task.movedFrom));
      if (task.time !== null) add("time", "clock", clockLabel(task.time));
    } else {
      const due = dueMeta(task);
      if (due) add("due", due.late ? "late" : "calendar", due.text, due.late ? "warm" : "ink3");
    }
    if (task.remind !== null) add("remind", "bell", null);
    if (task.repeat) add("repeat", "repeat", null);
    if ((variant === "list" || variant === "today") && task.noteIds.length > 0) {
      add("note", "doc", fromNote ?? "From your note", "ink2");
    }
  }
  if (unsent)
    meta.push(
      <View key="unsent" style={styles.piece} accessible accessibilityLabel="Not sent yet">
        <Icon name="cloudUp" size={13} color={colors.ink3} weight="medium" />
      </View>,
    );
  const leftOff = variant === "today" && history?.leftOff && history.outcome !== "finished" ? history.leftOff : null;
  // The calmer looks (see rowLook): no meta line; the time and small marks by the check, or in a column.
  const calm = calmRows(variant);
  const look: RowLook = calm ? rowLook : "now";
  const journal = look === "journal";

  const words = (
    <Pressable
      onPress={() => !swiping.current && router.push(`/task/${task.id}`)}
      onLongPress={showMenu}
      delayLongPress={380}
      onPressIn={() => (wash.value = withTiming(1, fadeTiming(duration.press)))}
      onPressOut={() => (wash.value = withTiming(0, fadeTiming(duration.base)))}
      accessibilityRole="button"
      accessibilityHint="Opens the task. Long-press for quick actions."
      accessibilityActions={[
        { name: "toggle", label: task.done ? "Mark not done" : "Mark done" },
        { name: "longpress", label: "Quick actions" },
      ]}
      onAccessibilityAction={(event) => {
        if (event.nativeEvent.actionName === "toggle") toggle();
        if (event.nativeEvent.actionName === "longpress") showMenu();
      }}
      style={styles.words}
    >
      <Struck text={task.title} on={checked} animate={ticking} look={look} suffix={journal && task.time !== null && !task.done ? clockLabel(task.time) : null} />
      {!calm && meta.length ? <View style={styles.meta}>{meta}</View> : null}
      {look === "card" ? <Marks task={task} time unsent={unsent} /> : null}
      {leftOff ? (
        <View style={styles.leftOff}>
          <Icon name="pen" size={13} color={colors.ink3} weight="medium" />
          <Txt variant={calm ? "footnote" : "subhead"} tone={calm ? "ink3" : "ink2"} numberOfLines={2} style={styles.flex}>
            {leftOff}
          </Txt>
        </View>
      ) : null}
    </Pressable>
  );
  const check = (
    <Pressable
      onPress={toggle}
      onPressIn={() => setCheckDown(true)}
      onPressOut={() => setCheckDown(false)}
      hitSlop={journal ? 12 : 8}
      accessibilityRole="checkbox"
      aria-checked={checked}
      accessibilityLabel={checked ? `Mark ${task.title} not done` : `Mark ${task.title} done`}
      style={journal ? styles.journalCheck : styles.check}
    >
      <CircleCheck on={checked} pressed={checkDown} size={journal ? 20 : calm ? 22 : 28} quiet={calm} />
    </Pressable>
  );
  // Beside the check (sequence, journal): a reminder or a repeat, small. The card look has them under the title, with the time.
  const marks = calm && look !== "card" ? <Marks task={task} time={false} unsent={unsent} /> : null;

  return (
    <SwipeRow done={task.done} onToggle={toggle} onFocus={task.done ? undefined : focus} onSwipe={onSwipe}>
      <View ref={row} collapsable={false} style={{ backgroundColor: journal ? colors.page : colors.card }}>
        <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: colors.sunken }, washStyle]} />
        {journal ? (
          <View style={[styles.row, styles.journalRow]}>
            {check}
            {words}
            {marks}
          </View>
        ) : look === "sequence" ? (
          <View style={[styles.row, styles.calmRow]}>
            <View style={styles.timeColumn}>
              {task.time !== null && !task.done ? (
                <Txt variant="footnote" tone="ink2" weight="semibold" style={styles.tabular}>
                  {clockLabel(task.time)}
                </Txt>
              ) : null}
            </View>
            {words}
            {marks}
            {check}
          </View>
        ) : (
          <View style={[styles.row, calm && styles.calmRow]}>
            {words}
            {marks}
            {check}
          </View>
        )}
      </View>
    </SwipeRow>
  );
});

/** In the calmer looks, what the meta line said, as small marks: the time (in the card look, under the title), a reminder, a repeat. */
function Marks({ task, time, unsent }: { task: Task; time: boolean; unsent: boolean }) {
  const { colors } = useTheme();
  if (task.done) return null;
  const pieces: React.ReactNode[] = [];
  if (time && task.time !== null)
    pieces.push(
      <Txt key="time" variant="footnote" tone="ink3" style={styles.tabular}>
        {clockLabel(task.time)}
      </Txt>,
    );
  if (task.remind !== null) pieces.push(<Icon key="remind" name="bell" size={12} color={colors.ink3} weight="medium" />);
  if (task.repeat) pieces.push(<Icon key="repeat" name="repeat" size={12} color={colors.ink3} weight="medium" />);
  if (unsent) pieces.push(<Icon key="unsent" name="cloudUp" size={12} color={colors.ink3} weight="medium" />);
  return pieces.length ? (
    <View style={styles.marks} pointerEvents="none">
      {pieces}
    </View>
  ) : null;
}

/**
 * A task's title that can be struck through as it's ticked: on the phone a
 * line is drawn across each line of text in turn, from the left; the web
 * build, which can't measure lines, uses the type's own strikethrough.
 */
function Struck({ text, on, animate, look = "now", suffix = null }: { text: string; on: boolean; animate: boolean; look?: RowLook; suffix?: string | null }) {
  const { colors } = useTheme();
  const calm = look !== "now";
  const [lines, setLines] = useState<{ x: number; y: number; width: number; height: number }[]>([]);
  const native = process.env.EXPO_OS !== "web";
  const onTextLayout = (event: NativeSyntheticEvent<TextLayoutEventData>) => {
    const next = event.nativeEvent.lines.map((line) => ({ x: line.x, y: line.y, width: line.width, height: line.height }));
    setLines((old) => (old.length === next.length && old.every((l, i) => Math.abs(l.width - next[i].width) < 0.5 && l.y === next[i].y) ? old : next));
  };
  return (
    <View style={styles.title}>
      <Txt
        variant={calm && look !== "journal" ? "callout" : "row"}
        tone={on ? "ink3" : "ink"}
        // One face either way: a thinner one shrank the title and could rewrap it mid-tick.
        weight={look === "card" ? "medium" : calm ? "regular" : "semibold"}
        numberOfLines={calm ? 2 : undefined}
        onTextLayout={native ? onTextLayout : undefined}
        style={[calm && !on ? { color: colors.soft } : null, on && !native ? [styles.struck, { textDecorationColor: colors.ink3 }] : null]}
      >
        {text}
        {/* The time stays whole, with its dot: the line breaks before it, never inside it. */}
        {suffix ? <Txt variant="row" tone="ink3">{` \u00A0·\u00A0${suffix.replace(/ /g, "\u00A0")}`}</Txt> : null}
      </Txt>
      {native && on
        ? lines.map((line, i) => <StrikeLine key={i} line={line} delay={animate ? i * 90 : 0} animate={animate} color={colors.ink3} />)
        : null}
    </View>
  );
}

function StrikeLine({ line, delay, animate, color }: { line: { x: number; y: number; width: number; height: number }; delay: number; animate: boolean; color: string }) {
  const reduced = useReducedMotion();
  const progress = useSharedValue(animate && !reduced ? 0 : 1);
  useEffect(() => {
    if (animate && !reduced) progress.value = withDelay(delay, withTiming(1, { duration: 260, easing: easeOut }));
  }, [animate, delay, progress, reduced]);
  const style = useAnimatedStyle(() => ({ transform: [{ scaleX: progress.value }] }));
  return (
    <Animated.View
      pointerEvents="none"
      // Taken off (a repeating task back on its next day, a tick undone): it fades rather than vanishing.
      exiting={leave}
      style={[styles.strike, { left: line.x, top: line.y + line.height * 0.54, width: line.width, backgroundColor: color, transformOrigin: "left" }, style]}
    />
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  row: { flexDirection: "row", alignItems: "center", gap: space[3], paddingLeft: pad, paddingRight: pad - 8, paddingVertical: 13, minHeight: 58 },
  words: { flex: 1, gap: 3 },
  title: { alignSelf: "flex-start", maxWidth: "100%" },
  struck: { textDecorationLine: "line-through" },
  strike: { position: "absolute", height: 1.5, borderRadius: 1 },
  meta: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", columnGap: 12, rowGap: 2 },
  piece: { flexDirection: "row", alignItems: "center", gap: 4, flexShrink: 1 },
  pieceText: { flexShrink: 1, maxWidth: 190 },
  leftOff: { flexDirection: "row", alignItems: "flex-start", gap: 6, marginTop: 4 },
  check: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  calmRow: { minHeight: 52, paddingVertical: 10, gap: space[2] },
  journalRow: { alignItems: "flex-start", minHeight: 50, paddingLeft: 0, paddingRight: 0, paddingVertical: 13, gap: space[3] },
  journalCheck: { width: 20, height: 23, alignItems: "center", justifyContent: "center" },
  timeColumn: { width: TIME_COLUMN },
  marks: { flexDirection: "row", alignItems: "center", gap: 7 },
  tabular: { fontVariant: ["tabular-nums"] },
});
