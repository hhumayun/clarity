import { useRouter } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, View, type NativeSyntheticEvent, type TextLayoutEventData } from "react-native";
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withDelay, withSequence, withTiming } from "react-native-reanimated";
import { useAreaColor, useFocusHistory } from "../store/hooks";
import type { Task } from "../store/model";
import { clockLabel, dueMeta, shortDate, whenLabel } from "../store/selectors";
import { useStore } from "../store/store";
import { duration, easeOut } from "../theme/motion";
import { useTheme } from "../theme/ThemeProvider";
import { pad, space } from "../theme/tokens";
import { useAcknowledge } from "./Acknowledgement";
import { CircleCheck } from "./CircleCheck";
import { done as doneHaptic, tap, tick } from "./haptics";
import { Icon, type IconName } from "./Icon";
import { SwipeRow } from "./SwipeRow";
import { useTaskMenu } from "./TaskMenu";
import { Txt, type Tone } from "./Txt";

/** A ticked row rests this long, struck through, before it moves to Done. */
const SETTLE_MS = 640;

export type TaskVariant = "today" | "list" | "day" | "note";

/**
 * One task on a card: the words on the left, a line of small icons under
 * them, and Rosebud's check on the right, under the thumb. Tick it (or
 * swipe right) and the check fills, a line is drawn through the words one
 * line at a time, and the row rests a beat before it leaves for Done.
 * Swipe left to focus on it. Tap the words to open it; long-press for the
 * quick menu. Its area is a small dot, nothing more.
 */
export function TaskRow({
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
  const areaColor = useAreaColor();
  const history = useFocusHistory(task.id);
  const notes = useStore((state) => state.notes);
  const setDone = useStore((state) => state.setDone);
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

  const wash = useSharedValue(0);
  const washStyle = useAnimatedStyle(() => ({ opacity: wash.value }));
  useEffect(() => {
    if (!highlight) return;
    wash.value = withSequence(
      withTiming(1, { duration: 280, easing: easeOut }),
      withTiming(0, { duration: 420, easing: easeOut }),
      withTiming(1, { duration: 280, easing: easeOut }),
      withTiming(0, { duration: 700, easing: easeOut }),
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
        const next = setDone(task.id, true);
        setTicking(false);
        if (next) acknowledge(`Next: ${whenLabel({ day: next, time: task.time })}`, "repeat");
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
    if (showArea) add("area", null, task.area, "ink3", <View style={[styles.areaDot, { backgroundColor: areaColor(task.area) }]} />);
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
      const first = notes.find((note) => note.id === task.noteIds[0]);
      add("note", "doc", first?.title ?? "From your note", "ink2");
    }
  }
  const leftOff = variant === "today" && history?.leftOff && history.outcome !== "finished" ? history.leftOff : null;

  return (
    <SwipeRow done={task.done} onToggle={toggle} onFocus={task.done ? undefined : focus} onSwipe={onSwipe}>
      <View ref={row} collapsable={false} style={{ backgroundColor: colors.card }}>
        <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: colors.sunken }, washStyle]} />
        <View style={styles.row}>
          <Pressable
            onPress={() => !swiping.current && router.push(`/task/${task.id}`)}
            onLongPress={showMenu}
            delayLongPress={380}
            onPressIn={() => (wash.value = withTiming(1, { duration: duration.press, easing: easeOut }))}
            onPressOut={() => (wash.value = withTiming(0, { duration: duration.base, easing: easeOut }))}
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
            <Struck text={task.title} on={checked} animate={ticking} />
            {meta.length ? <View style={styles.meta}>{meta}</View> : null}
            {leftOff ? (
              <View style={styles.leftOff}>
                <Icon name="pen" size={13} color={colors.ink3} weight="medium" />
                <Txt variant="subhead" tone="ink2" numberOfLines={2} style={styles.flex}>
                  {leftOff}
                </Txt>
              </View>
            ) : null}
          </Pressable>
          <Pressable
            onPress={toggle}
            onPressIn={() => setCheckDown(true)}
            onPressOut={() => setCheckDown(false)}
            hitSlop={8}
            accessibilityRole="checkbox"
            aria-checked={checked}
            accessibilityLabel={checked ? `Mark ${task.title} not done` : `Mark ${task.title} done`}
            style={styles.check}
          >
            <CircleCheck on={checked} pressed={checkDown} />
          </Pressable>
        </View>
      </View>
    </SwipeRow>
  );
}

/**
 * A task's title that can be struck through as it's ticked: on the phone a
 * line is drawn across each line of text in turn, from the left; the web
 * build, which can't measure lines, uses the type's own strikethrough.
 */
function Struck({ text, on, animate }: { text: string; on: boolean; animate: boolean }) {
  const { colors } = useTheme();
  const [lines, setLines] = useState<{ x: number; y: number; width: number; height: number }[]>([]);
  const native = process.env.EXPO_OS !== "web";
  const onTextLayout = (event: NativeSyntheticEvent<TextLayoutEventData>) => {
    const next = event.nativeEvent.lines.map((line) => ({ x: line.x, y: line.y, width: line.width, height: line.height }));
    setLines((old) => (old.length === next.length && old.every((l, i) => Math.abs(l.width - next[i].width) < 0.5 && l.y === next[i].y) ? old : next));
  };
  return (
    <View style={styles.title}>
      <Txt
        variant="row"
        tone={on ? "ink3" : "ink"}
        onTextLayout={native ? onTextLayout : undefined}
        style={on && !native ? [styles.struck, { textDecorationColor: colors.ink3 }] : undefined}
      >
        {text}
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
  areaDot: { width: 7, height: 7, borderRadius: 3.5 },
  leftOff: { flexDirection: "row", alignItems: "flex-start", gap: 6, marginTop: 4 },
  check: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
});
