import React, { createContext, useContext, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View, type LayoutChangeEvent } from "react-native";
import Animated, { Easing, interpolateColor, useAnimatedStyle, useReducedMotion, useSharedValue, withDelay, withSpring, withTiming } from "react-native-reanimated";
import Svg, { Path } from "react-native-svg";
import { today } from "../../lib/dates";
import type { Task } from "../../store/model";
import { clockLabel } from "../../store/selectors";
import { arrive, arriveSlow, duration, easeIn, easeOut, fadeTiming, keep, leave, settle, spring } from "../../theme/motion";
import { useTheme } from "../../theme/ThemeProvider";
import { edge, face, pad, radius } from "../../theme/tokens";
import { CHECK, CircleCheck } from "../CircleCheck";
import { tick } from "../haptics";
import { Icon, type IconName } from "../Icon";
import { Txt, useType } from "../Txt";
import { useDayFold } from "./fold";
import type { Look, LookListProps, LookRowProps } from "./types";

/*
 * The day fills (round 3, 2026-10-08). Ticked tasks don't leave Today: each
 * settles where it was, smaller and grey (no strike: the sage disc and the
 * filled thread already say "done"), its second lines gone, and the fine
 * thread joining the checks on the right turns your colour between the
 * things you've done. By evening the card is a quiet record of the day,
 * stitched in your colour, with no number anywhere.
 *
 * Geometry (393-point screen): the card 16 in from each edge; words from
 * x 32 to 315; a 44-point check column whose beads all sit on x 349, so the
 * next task's 24-point ring ends 16 in from the card's right edge, as the
 * words start 16 in from its left. The thread runs on that axis, a hairline
 * broken 4 points either side of every bead.
 *
 * Order: what was already finished when the day is first drawn leads the
 * card, in the order it was done (so the record runs down from the top);
 * after that, nothing moves for the rest of the day: a tick settles in place.
 */

/** The check column: 44 wide, 12 after the words, 6 from the card's edge (so the axis is 28 in). */
const COLUMN = 44;
const AXIS = COLUMN / 2;
const GAP = 12;
const RIGHT = 6;
/** An open row has 11 above and below (45 for one line of 17/23); a settled one 9 (40 for one line of 16/22), so the record reads as a soft stack. */
const PAD_Y = 11;
const PAD_SETTLED = 9;
const NBSP = "\u00A0";
/** Beads: the next one a firm 24, the rest quiet 20s; a settled disc is 20. */
const NEXT = 24;
const BEAD = 20;
/** The thread: a 1-point hairline at rest, stopping 4 short of a bead; 2 points where it's filled, stopping 2 short, so a run of the record reads as one stitched line. */
const BREAK = 4;
const BREAK_FILLED = 2;
const THREAD = 1;
const FILLED = 2;
/** On a long day the card shows rows until 5 open ones have shown, or 6 rows in all with at least 2 of them open, whichever comes first. */
const OPEN_SHOWN = 5;
const ROWS_SHOWN = 6;
const OPEN_AT_LEAST = 2;

/** Where a row sits on the thread, given by the List. */
type ThreadPlace = { first: boolean; last: boolean; prevDone: boolean; nextDone: boolean; isNext: boolean };
const Thread = createContext<ThreadPlace>({ first: true, last: true, prevDone: false, nextDone: false, isNext: false });

type Mark = { key: string; icon: IconName; label: string };

/** The marks a task carries, as small glyphs, each with what it says for VoiceOver. */
function marksOf(task: Task, unsent: boolean): Mark[] {
  const marks: Mark[] = [];
  if (task.remind !== null) marks.push({ key: "remind", icon: "bell", label: "reminds you" });
  if (task.repeat) marks.push({ key: "repeat", icon: "repeat", label: "repeats" });
  if (unsent) marks.push({ key: "unsent", icon: "cloudUp", label: "not sent yet" });
  return marks;
}

function Row({ task, checked, leftOff, unsent, check, open }: LookRowProps) {
  const place = useContext(Thread);
  const { colors } = useTheme();
  const rowType = useType("row");
  const settledType = useType("callout");
  const eyebrow = useType("eyebrow");
  const sub = useType("subhead");
  const reduced = useReducedMotion();
  const done = task.done;
  const timed = task.time !== null;
  const marks = done ? [] : marksOf(task, unsent);
  const showEyebrow = !done && timed;
  const padY = done ? PAD_SETTLED : PAD_Y;
  // The bead sits on the title's first line, from the line heights (so Larger text keeps it there).
  const centre = padY + (showEyebrow ? eyebrow.lineHeight + 2 : 0) + (done ? settledType : rowType).lineHeight / 2;
  const radiusNow = (place.isNext && !done ? NEXT : BEAD) / 2;

  // The bead and the thread's breaks glide with the row as it settles or opens (the rows' own glide: 300, the strong ease-out).
  const c = useSharedValue(centre);
  const r = useSharedValue(radiusNow);
  useEffect(() => {
    c.value = reduced ? centre : withTiming(centre, { duration: duration.enter, easing: easeOut });
  }, [centre, c, reduced]);
  useEffect(() => {
    r.value = reduced ? radiusNow : withSpring(radiusNow, spring.settle);
  }, [radiusNow, r, reduced]);
  const beadAt = useAnimatedStyle(() => ({ top: c.value - COLUMN / 2 }));
  const above = useAnimatedStyle(() => ({ height: Math.max(0, c.value - r.value - BREAK) }));
  const below = useAnimatedStyle(() => ({ top: c.value + r.value + BREAK }));
  const aboveFilled = useAnimatedStyle(() => ({ height: Math.max(0, c.value - r.value - BREAK_FILLED) }));
  const belowFilled = useAnimatedStyle(() => ({ top: c.value + r.value + BREAK_FILLED }));

  // Whose change this is: the row's own tick (the fill grows from its bead) or a neighbour's (from the far end).
  const lastDone = useRef(done);
  const own = lastDone.current !== done;
  useEffect(() => {
    lastDone.current = done;
  }, [done]);

  const glyph = (mark: Mark, i: number, gap: number) => (
    <View key={mark.key} style={[styles.glyph, { marginLeft: i === 0 ? gap : 5 }]}>
      <Icon name={mark.icon} size={11} color={colors.ink3} weight="semibold" />
    </View>
  );
  // An untimed task's glyphs follow its last word: one no-break space and a point, about the eyebrow's 5.
  const inline = !timed && marks.length ? (
    <Txt variant="row" tone="ink3">
      {NBSP}
      {marks.map((mark, i) => glyph(mark, i, 1))}
    </Txt>
  ) : null;
  const italic = { fontSize: sub.fontSize - 1, lineHeight: sub.lineHeight - 1 };

  // VoiceOver reads the open area as one sentence: "Next: Send the brief to Ana, 3:00 pm, reminds you"; settled, "<title>, done".
  const spoken = done
    ? `${task.title}, done`
    : `${place.isNext ? "Next: " : ""}${task.title}${timed ? `, ${clockLabel(task.time ?? 0)}` : ""}${marks.map((mark) => `, ${mark.label}`).join("")}${leftOff ? `. ${leftOff}` : ""}`;

  const words = (
    <View accessibilityLabel={spoken} style={{ paddingTop: padY, paddingBottom: padY }}>
      {showEyebrow ? (
        <Animated.View entering={arrive} exiting={leave} style={[styles.eyebrow, { height: eyebrow.lineHeight, marginBottom: 2 }]}>
          {/* The time as the rest of Today writes it ("12:30 pm"), not in caps. */}
          <Txt variant="eyebrow" tone="ink3" weight="semibold" style={styles.time}>
            {clockLabel(task.time ?? 0)}
          </Txt>
          {marks.map((mark, i) => glyph(mark, i, 5))}
        </Animated.View>
      ) : null}
      <Animated.View layout={settle}>
        <Title text={task.title} checked={checked} done={done} suffix={inline} />
      </Animated.View>
      {!done && leftOff ? (
        <Animated.View entering={arrive} exiting={leave} layout={settle}>
          <Txt variant="subhead" tone="ink3" weight="italic" numberOfLines={2} style={[italic, styles.leftOff]}>
            {leftOff}
          </Txt>
        </Animated.View>
      ) : null}
    </View>
  );

  const rest = { backgroundColor: colors.threadOnCard, width: THREAD, left: AXIS - THREAD / 2 };
  return (
    <View style={styles.row}>
      {open(words, styles.words)}
      <View style={styles.column} pointerEvents="box-none">
        {place.first ? null : (
          <>
            <Animated.View pointerEvents="none" style={[styles.segment, styles.top, rest, above]} />
            <Fill on={done && place.prevDone} own={own} end="above" style={aboveFilled} />
          </>
        )}
        {place.last ? null : (
          <>
            <Animated.View pointerEvents="none" style={[styles.segment, styles.bottom, rest, below]} />
            <Fill on={done && place.nextDone} own={own} end="below" style={belowFilled} />
          </>
        )}
        <Animated.View style={[styles.bead, beadAt]}>
          {check({ style: styles.target, hitSlop: 0, draw: ({ on, pressed }) => <Bead on={on} pressed={pressed} done={done} next={place.isNext} /> })}
        </Animated.View>
      </View>
    </View>
  );
}

/**
 * A title, drawn here rather than by the shared part so it is never struck.
 * Open: 17/23, Medium in ink in light, Regular in the gentler ink in dark (light
 * on dark reads a weight heavier). Ticked, it greys to ink3 through the beat;
 * settled, it is 16/22 Regular ink3 on one line, and it eases down to that size
 * from the left (a scale, so nothing reflows while it moves).
 */
function Title({ text, checked, done, suffix }: { text: string; checked: boolean; done: boolean; suffix: React.ReactNode }) {
  const { colors, dark } = useTheme();
  const rowType = useType("row");
  const settledType = useType("callout");
  const reduced = useReducedMotion();
  const ink = dark ? colors.soft : colors.ink;
  const grey = useSharedValue(checked ? 1 : 0);
  const scale = useSharedValue(1);
  useEffect(() => {
    grey.value = withTiming(checked ? 1 : 0, fadeTiming(checked ? 300 : 160));
  }, [checked, grey]);
  // From the old size to the new one, starting before the frame is drawn.
  const was = useRef(done);
  useLayoutEffect(() => {
    if (was.current === done) return;
    was.current = done;
    if (reduced) return;
    const ratio = rowType.fontSize / settledType.fontSize;
    scale.value = done ? ratio : 1 / ratio;
    scale.value = withTiming(1, { duration: duration.enter, easing: easeOut });
  }, [done, reduced, rowType.fontSize, settledType.fontSize, scale]);
  const style = useAnimatedStyle(() => ({ color: interpolateColor(grey.value, [0, 1], [ink, colors.ink3]), transform: [{ scale: scale.value }] }));
  return (
    <Animated.Text
      numberOfLines={done ? 1 : 2}
      style={[done ? settledType : rowType, { fontFamily: done || dark ? face.regular : face.medium, transformOrigin: "left center" }, style]}
    >
      {text}
      {done ? null : suffix}
    </Animated.Text>
  );
}

/**
 * The thread between two finished neighbours, in the accent at 2 points. Half
 * of it belongs to each row: drawn in, it grows from the bead just ticked
 * toward its neighbour (this row's half first, then the neighbour's); undone,
 * it draws back toward the neighbours. Under Reduce Motion it fades.
 */
function Fill({ on, own, end, style }: { on: boolean; own: boolean; end: "above" | "below"; style: ReturnType<typeof useAnimatedStyle> }) {
  const { accent } = useTheme();
  const reduced = useReducedMotion();
  const p = useSharedValue(on ? 1 : 0);
  // Which end it grows from or shrinks toward: "near" is this row's bead.
  const [origin, setOrigin] = useState<"near" | "far">("near");
  const was = useRef(on);
  useEffect(() => {
    if (was.current === on) return;
    was.current = on;
    if (reduced) {
      p.value = withDelay(on ? 60 : 0, withTiming(on ? 1 : 0, fadeTiming(on ? 300 : 160)));
      return;
    }
    if (on) {
      // Ticked here: grow from this bead (60 ms after the disc starts to soften), then the neighbour's half carries on.
      setOrigin(own ? "near" : "far");
      p.value = withDelay(own ? 60 : 210, withTiming(1, { duration: 150, easing: own ? Easing.in(Easing.quad) : Easing.out(Easing.quad), reduceMotion: keep }));
    } else {
      // Undone here: this half draws back toward the neighbour first, then the neighbour's toward its own bead.
      setOrigin(own ? "far" : "near");
      p.value = withDelay(own ? 0 : 80, withTiming(0, { duration: 80, easing: easeIn, reduceMotion: keep }));
    }
  }, [on, own, p, reduced]);
  const draw = useAnimatedStyle(() => (reduced ? { opacity: p.value } : { transform: [{ scaleY: p.value }], opacity: p.value > 0.001 ? 1 : 0 }));
  // The bead end: the bottom of the half above it, the top of the half below.
  const fromBottom = (end === "above") === (origin === "near");
  return (
    <Animated.View
      pointerEvents="none"
      style={[styles.segment, end === "above" ? styles.top : styles.bottom, { backgroundColor: accent.solid, width: FILLED, left: AXIS - FILLED / 2, transformOrigin: fromBottom ? "bottom" : "top" }, style, draw]}
    />
  );
}

/**
 * A bead: the quiet ring (20), or for the next task a firmer, larger ring
 * (24, in the title's ink) with nothing inside, so only a finished task ever
 * shows a tick; ticked, the full Rosebud moment at that size; settled, a soft
 * disc with a fine tick, so a run of finished tasks never becomes a column of
 * bright discs. Solid colour is spent only on the moment.
 */
function Bead({ on, pressed, done, next }: { on: boolean; pressed: boolean; done: boolean; next: boolean }) {
  const { colors, accent, dark } = useTheme();
  const settled = useSharedValue(done ? 1 : 0);
  const firm = useSharedValue(next && !done ? 1 : 0);
  const grow = useSharedValue(next && !done ? 1 : 0);
  const down = useSharedValue(0);
  // The next ring is drawn only once a row has been the next one.
  const [wasNext, setWasNext] = useState(next);
  useEffect(() => {
    if (next && !wasNext) setWasNext(true);
  }, [next, wasNext]);
  useEffect(() => {
    settled.value = withTiming(done ? 1 : 0, fadeTiming(done ? 300 : 160));
  }, [done, settled]);
  useEffect(() => {
    // Once done it keeps whichever ring it had, under the disc.
    if (done) return;
    firm.value = withDelay(next ? 120 : 0, withTiming(next ? 1 : 0, fadeTiming(220)));
    grow.value = withDelay(next ? 120 : 0, withSpring(next ? 1 : 0, spring.settle));
  }, [next, done, firm, grow]);
  useEffect(() => {
    down.value = withTiming(pressed && done ? 1 : 0, fadeTiming(pressed ? 90 : 220));
  }, [pressed, done, down]);
  const quietStyle = useAnimatedStyle(() => ({ opacity: (1 - settled.value) * (1 - firm.value), transform: [{ scale: 1 + grow.value * (NEXT / BEAD - 1) }] }));
  const nextStyle = useAnimatedStyle(() => ({ opacity: (1 - settled.value) * firm.value, transform: [{ scale: BEAD / NEXT + grow.value * (1 - BEAD / NEXT) }] }));
  const softStyle = useAnimatedStyle(() => ({ opacity: settled.value, transform: [{ scale: 1 - 0.1 * down.value }] }));
  return (
    <View style={styles.beadBox} pointerEvents="none">
      <Animated.View style={[styles.layer, quietStyle]}>
        <CircleCheck on={on} pressed={pressed} size={BEAD} quiet ringColor={colors.ringQuiet} ringWidth={1.25} fill={colors.card} />
      </Animated.View>
      {wasNext || next ? (
        <Animated.View style={[styles.layer, nextStyle]}>
          <CircleCheck on={on} pressed={pressed} size={NEXT} quiet ringColor={dark ? colors.soft : colors.ink} ringWidth={1.75} fill={colors.card} />
        </Animated.View>
      ) : null}
      <Animated.View style={[styles.layer, softStyle]}>
        <View style={[styles.disc, { backgroundColor: accent.soft }]}>
          {/* In light the pale disc gets a faint rim of the accent, so it holds its shape on white. */}
          {dark ? null : <View style={[styles.rim, { borderColor: accent.solid }]} />}
          <Svg width={BEAD} height={BEAD} viewBox="0 0 28 28">
            {/* 1.75 points at 20: 2.45 in the 28-unit drawing. */}
            <Path d={CHECK} stroke={accent.onSoft} strokeWidth={2.45} strokeLinecap="round" strokeLinejoin="round" fill="none" />
          </Svg>
        </View>
      </Animated.View>
    </View>
  );
}

/**
 * How the card is laid out on a day, kept until the app restarts (as the fold
 * is): which tasks were already done when the day was first drawn (they lead,
 * in the order they were done), and the first task behind the fold. A tick
 * changes neither, so the card keeps its rows and its height as you work.
 */
type DayLayout = { lead: string[]; length: number; firstHidden: string | null };
const layouts = new Map<string, DayLayout>();

/** Where a long day's card stops: after 5 open rows, or 6 in all once 2 open ones have shown, whichever comes first. */
function cutOf(tasks: Task[]): number {
  let open = 0;
  for (let i = 0; i < tasks.length; i++) {
    if (i >= ROWS_SHOWN && open >= OPEN_AT_LEAST) return i;
    if (!tasks[i].done && ++open > OPEN_SHOWN) return i;
  }
  return tasks.length;
}

function dayLayout(key: string, tasks: Task[]): { ordered: Task[]; cut: number } {
  let layout = layouts.get(key);
  if (!layout) {
    const lead = tasks.filter((task) => task.done).sort((a, b) => (a.doneAt ?? 0) - (b.doneAt ?? 0));
    layout = { lead: lead.map((task) => task.id), length: 0, firstHidden: null };
    layouts.set(key, layout);
  }
  const rank = new Map(layout.lead.map((id, i) => [id, i]));
  const ordered = [...tasks.filter((task) => rank.has(task.id)).sort((a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0)), ...tasks.filter((task) => !rank.has(task.id))];
  // Worked out again only when tasks are added, or the first hidden one has gone; never on a tick.
  const at = layout.firstHidden ? ordered.findIndex((task) => task.id === layout.firstHidden) : -1;
  const stale = ordered.length > layout.length || (layout.firstHidden !== null && at < 0);
  const cut = stale ? cutOf(ordered) : layout.firstHidden ? at : ordered.length;
  layout.length = ordered.length;
  layout.firstHidden = cut < ordered.length ? ordered[cut].id : null;
  return { ordered, cut };
}

/** The card: the day's planned tasks, open and done; finished ones settle where they were. */
function List({ tasks, variant, renderRow, foldKey }: LookListProps) {
  const { colors } = useTheme();
  const t = today();
  const day = tasks[0]?.day ?? t;
  const { ordered, cut } = dayLayout(`${variant}:${foldKey ?? day}`, tasks);
  const hidden = ordered.slice(cut);
  // Folded only when two or more would be left over (one is simply shown).
  const fold = useDayFold(foldKey, hidden.length, 1);
  const shown = fold.folded ? ordered.slice(0, cut) : ordered;
  const hiddenOpen = hidden.filter((task) => !task.done);
  const allDone = ordered.every((task) => task.done);
  const firstOpen = shown.findIndex((task) => !task.done);
  const allDoneLine = variant === "today" || day === t ? "All done for today. Enjoy the quiet." : day > t ? "All done." : "All done that day.";
  return (
    <Animated.View layout={settle} style={[styles.card, { backgroundColor: colors.card, boxShadow: colors.cardShadow }]}>
      {allDone ? (
        <Animated.View entering={arriveSlow} exiting={leave} layout={settle}>
          <Txt variant="subhead" tone="ink3" style={styles.allDone}>
            {allDoneLine}
          </Txt>
        </Animated.View>
      ) : null}
      {shown.map((task, i) => (
        <Thread.Provider
          key={task.id}
          value={{
            first: i === 0,
            last: i === shown.length - 1,
            prevDone: i > 0 && shown[i - 1].done,
            nextDone: i < shown.length - 1 && shown[i + 1].done,
            isNext: i === firstOpen,
          }}
        >
          {renderRow(task, i)}
        </Thread.Provider>
      ))}
      {fold.folded ? <AlsoToday label={hiddenOpen.length ? "Also today" : "Also done"} tasks={hiddenOpen.length ? hiddenOpen : hidden} onPress={fold.unfold} /> : null}
    </Animated.View>
  );
}

/** A task's name as "Also today" says it: its first clause ("Research a new dentist"), never cut mid-word. */
function shortName(title: string): string {
  const clause = title.split(/\s*[:;,(–—]\s*|\s+-\s+/)[0].trim();
  return clause.split(/\s+/).length >= 2 ? clause : title.trim();
}

/**
 * The card's last line on a long day: "Also today" and the open tasks left,
 * by name. Each name is a unit: its spaces don't break, so it never splits
 * across lines, and it's never cut. Names are set apart by " · " (the dot
 * never starts a line); those that don't fit two lines, found by measuring a
 * hidden copy, are left to "and more". Never a count. VoiceOver hears them all.
 */
function AlsoToday({ label, tasks, onPress }: { label: string; tasks: Task[]; onPress: () => void }) {
  const { colors } = useTheme();
  const sub = useType("subhead");
  const rowType = useType("row");
  const type = { fontSize: sub.fontSize - 1, lineHeight: sub.lineHeight };
  const lines = 2;
  // Its first line centred where an open title's would be, so the chevron sits on the bead axis and that line.
  const inset = PAD_Y + (rowType.lineHeight - type.lineHeight) / 2;
  const names = tasks.map((task) => shortName(task.title));
  // The words' width: a name longer than most of a line may break between its words (only that one).
  const [width, setWidth] = useState(0);
  const perLine = width ? width / (type.fontSize * 0.5) : 40;
  const units = names.map((name) => (name.length < perLine * 0.85 ? name.replace(/ /g, NBSP) : name));
  const said = (count: number) => units.slice(0, count).join(`${NBSP}· `) + (count < units.length ? `${NBSP}· and${NBSP}more` : "");
  const key = `${names.join("\n")}|${label}|${type.fontSize}|${Math.round(width)}`;
  const [fit, setFit] = useState({ key, count: names.length, done: false });
  const current = fit.key === key ? fit : { key, count: names.length, done: false };
  const measured = (event: LayoutChangeEvent) => {
    const taken = Math.round(event.nativeEvent.layout.height / type.lineHeight);
    if (taken > lines && current.count > 1) setFit({ key, count: current.count - 1, done: false });
    else setFit({ key, count: current.count, done: true });
  };
  const runIn = <Text style={{ color: colors.ink2, fontFamily: face.semibold }}>{label.replace(/ /g, NBSP)}</Text>;
  const line = (
    <>
      {runIn}
      {` ${said(current.count)}`}
    </>
  );
  return (
    <Animated.View layout={settle} entering={arrive} exiting={leave}>
      <Pressable
        onPress={() => {
          tick();
          onPress();
        }}
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${tasks.map((task) => task.title).join(", ")}. Show them`}
        style={({ pressed }) => [styles.also, { paddingTop: inset, paddingBottom: inset, opacity: pressed ? 0.55 : 1 }]}
      >
        <View style={styles.alsoWords} onLayout={(event) => setWidth(event.nativeEvent.layout.width)}>
          <Text numberOfLines={lines} style={[type, { color: colors.ink3, fontFamily: face.regular, opacity: current.done ? 1 : 0 }]}>
            {line}
          </Text>
          {current.done ? null : (
            <Text
              key={`${key}|${current.count}`}
              onLayout={measured}
              aria-hidden
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
              style={[type, styles.measure, { fontFamily: face.regular }]}
            >
              {line}
            </Text>
          )}
        </View>
        <View style={[styles.chevron, { height: type.lineHeight }]}>
          <Icon name="down" size={12} color={colors.ink3} weight="medium" />
        </View>
      </Pressable>
    </Animated.View>
  );
}

export const fills: Look = { id: "fills", label: "The day fills", surface: "card", heading: "keep", ownsDone: true, Row, List };

const styles = StyleSheet.create({
  card: { marginHorizontal: edge, paddingVertical: 6, borderRadius: radius.card, borderCurve: "continuous", overflow: "hidden" },
  row: { flexDirection: "row", alignItems: "stretch", paddingRight: RIGHT },
  words: { flex: 1, paddingLeft: pad },
  column: { width: COLUMN, marginLeft: GAP },
  segment: { position: "absolute" },
  top: { top: 0 },
  bottom: { bottom: 0 },
  bead: { position: "absolute", left: 0, width: COLUMN, height: COLUMN },
  target: { width: COLUMN, height: COLUMN },
  beadBox: { width: NEXT, height: NEXT, alignItems: "center", justifyContent: "center" },
  layer: { position: "absolute", alignItems: "center", justifyContent: "center" },
  disc: { width: BEAD, height: BEAD, borderRadius: BEAD / 2, alignItems: "center", justifyContent: "center" },
  rim: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, borderRadius: BEAD / 2, borderWidth: 1, opacity: 0.25 },
  eyebrow: { flexDirection: "row", alignItems: "center" },
  time: { fontVariant: ["tabular-nums"], textTransform: "none", letterSpacing: 0.2 },
  glyph: { justifyContent: "center" },
  leftOff: { marginTop: 2 },
  // Hung from the words' edge like the record below it: 20 from the card's top (with its 6) and 20 above the first title (with a settled row's 9).
  allDone: { paddingLeft: pad, paddingRight: GAP + COLUMN + RIGHT, paddingTop: 14, paddingBottom: 11 },
  also: { flexDirection: "row", alignItems: "flex-start", paddingLeft: pad, paddingRight: RIGHT },
  measure: { position: "absolute", left: 0, right: 0, top: 0, opacity: 0 },
  alsoWords: { flex: 1 },
  chevron: { width: COLUMN, marginLeft: GAP, alignItems: "center", justifyContent: "center" },
});
