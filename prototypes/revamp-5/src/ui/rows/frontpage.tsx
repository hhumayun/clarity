import React, { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { LayoutChangeEvent } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import type { Task } from "../../store/model";
import { clockLabel } from "../../store/selectors";
import { useDevice } from "../../state/device";
import { arrive, arriveAfter, arriveSlow, duration, fadeTiming, leave, riseIn, settle } from "../../theme/motion";
import { useTheme } from "../../theme/ThemeProvider";
import { edge, face, radius } from "../../theme/tokens";
import { tick } from "../haptics";
import { Icon } from "../Icon";
import type { IconName } from "../Icon";
import { LARGE_TEXT, useType } from "../Txt";
import { useDayFold } from "./fold";
import type { Look, LookListProps, LookRowProps } from "./types";

/**
 * "The front page" (round 3 of the calmer rows, 2026-10-08). The next task is
 * set like a newspaper's lead story: its time in small capitals over one
 * large headline (Light 300 in dark mode, Regular in light). The next four
 * follow as quiet lines with their times set like page numbers, flush right
 * against a quiet ring; anything after that is named in one grey sentence.
 * In dark mode only the headline is bright.
 *
 * One grid: every word starts 16 in from the card, every check is centred
 * on one vertical line 30 in from its right edge. One rule, under the lead.
 */

// Nunito Sans's vertical metrics (per em): where a baseline falls in a line box, so marks of a
// smaller size can share the title's baseline, and a glyph can sit on the middle of the figures.
const ASCENT = 1.011;
const DESCENT = 0.353;
const CAP = 0.705;
const baseline = (size: number, line: number) => (line - (ASCENT + DESCENT) * size) / 2 + ASCENT * size;

/** Loose sizes (the ramp has no 14 or 11), grown with "Larger text" like the ramp. */
function useSize(size: number, line: number) {
  const large = useDevice((state) => state.prefs.largeText);
  return large ? { fontSize: Math.round(size * LARGE_TEXT), lineHeight: Math.round(line * LARGE_TEXT) } : { fontSize: size, lineHeight: line };
}

/** A glyph's size, grown with "Larger text" like the words beside it. */
function useGlyph(size: number) {
  const large = useDevice((state) => state.prefs.largeText);
  return large ? Math.round(size * LARGE_TEXT) : size;
}

// The check's 44-point target, and where the ring's centre sits from the card's right edge.
const TARGET = 44;
const CHECK_RIGHT = 8; // 8 + 22 = 30
const LEAD = { top: 18, left: 16, right: 60, bottom: 16 };
const BRIEF = { vertical: 13, left: 16 };
const NBSP = " ";

// Made once (a builder per render would set the animation up again each time).
/** The lead's eyebrow and context follow its headline in, a beat later. */
const follow = arriveAfter(60, 220);
/**
 * The next task stepping up into the lead rises from a little below. In the web build a rising arrival
 * is laid out out of the flow (Reanimated's keyframe for it is absolutely placed), so the new lead sat
 * over the first brief: there it fades in place, as under Reduce Motion.
 */
const stepUp = process.env.EXPO_OS === "web" ? arriveSlow : riseIn;
/** Unfolding: the named tasks arrive as briefs, 30 ms apart. */
const unfoldIn = Array.from({ length: 24 }, (_, k) => arriveAfter(30 * k, 220));

/** "3:00 pm" as figures and a suffix, so the suffix can be set smaller, like a page number. */
function splitClock(minutes: number): { figures: string; suffix: string } {
  const [figures, suffix] = clockLabel(minutes).split(" ");
  return { figures, suffix };
}

/** "3 pm", "6:30 pm": a time as it's said. */
function spoken(minutes: number): string {
  const { figures, suffix } = splitClock(minutes);
  return `${figures.replace(/:00$/, "")} ${suffix}`;
}

/** One colour laid over another at `amount` (0 to 1), as a solid colour. */
function mix(over: string, under: string, amount: number): string {
  const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const a = rgb(over);
  const b = rgb(under);
  return `#${a.map((v, i) => Math.round(v * amount + b[i] * (1 - amount)).toString(16).padStart(2, "0")).join("")}`;
}

const repeatSaid = { daily: "repeats daily", weekdays: "repeats on weekdays", weekly: "repeats weekly", monthly: "repeats monthly" } as const;

/** What VoiceOver reads for the row's words: "Next: Walk at lunch, 12:30 pm, reminds you, repeats daily". */
function said(task: Task, lead: boolean, unsent: boolean): string {
  const parts = [lead ? `Next: ${task.title}` : task.title];
  if (task.time !== null) parts.push(spoken(task.time));
  if (task.remind !== null) parts.push("reminds you");
  if (task.repeat) parts.push(repeatSaid[task.repeat]);
  if (unsent) parts.push("not sent yet");
  return parts.join(", ");
}

/** The small marks a task carries, most telling first: a reminder, a repeat, not sent yet. */
function marksOf(task: Task, unsent: boolean): IconName[] {
  if (task.done) return [];
  const names: IconName[] = [];
  if (task.remind !== null) names.push("bell");
  if (task.repeat) names.push("repeat");
  if (unsent) names.push("cloudUp");
  return names;
}

function Row(props: LookRowProps) {
  return props.variant === "today" && props.index === 0 ? <Lead {...props} /> : <Brief {...props} />;
}

function Glyphs({ names, size, gap }: { names: IconName[]; size: number; gap: number }) {
  const { colors } = useTheme();
  if (!names.length) return null;
  return (
    <View style={[styles.glyphs, { gap }]}>
      {names.map((name) => (
        <Icon key={name} name={name} size={size} color={colors.ink3} weight="medium" />
      ))}
    </View>
  );
}

/** The next task: its time in small capitals, one large headline, at most one line of context. */
function Lead({ task, checked, leftOff, unsent, noteTitle, title, check, open }: LookRowProps) {
  const { colors, dark } = useTheme();
  const eyebrow = useType("eyebrow");
  const lead = useType("lead");
  const leftOffType = useSize(14, 19);
  const noteType = useType("footnote");
  const glyph = useGlyph(11);
  const doc = useGlyph(12);
  const marks = marksOf(task, unsent);
  const timed = task.time !== null && !task.done;
  const hasEyebrow = timed || marks.length > 0;
  // The ring's centre on the headline's first line, from the type's own line heights (Larger text keeps it there).
  const eyebrowRoom = hasEyebrow ? eyebrow.lineHeight + 4 : 0;
  const checkTop = LEAD.top + eyebrowRoom + lead.lineHeight / 2 - TARGET / 2;
  // Ticked: the eyebrow and the context recede with the tick while the strike draws.
  const recede = useSharedValue(checked ? 0.6 : 1);
  useEffect(() => {
    recede.value = withTiming(checked ? 0.6 : 1, fadeTiming(duration.base));
  }, [checked, recede]);
  const receding = useAnimatedStyle(() => ({ opacity: recede.value }));
  const context = task.done ? null : leftOff ? (
    <Text numberOfLines={2} style={[leftOffType, styles.italic, { color: colors.ink3 }]}>
      {leftOff}
    </Text>
  ) : noteTitle ? (
    <View style={styles.from}>
      {/* The glyph's stroke, not its box, on the text's edge. */}
      <View style={[styles.doc, { height: noteType.lineHeight }]}>
        <Icon name="doc" size={doc} color={colors.ink3} weight="medium" />
      </View>
      <Text numberOfLines={1} style={[noteType, styles.flexShrink, { color: colors.ink3 }]}>
        {`From ${noteTitle}`}
      </Text>
    </View>
  ) : null;
  return (
    <View>
      {open(
        // VoiceOver reads the row by this label (the open area takes its children's labels); kept as a real view.
        <View collapsable={false} accessibilityLabel={said(task, true, unsent)}>
          {hasEyebrow ? (
            <Animated.View style={receding}>
              <Animated.View entering={follow} style={[styles.eyebrow, { height: eyebrow.lineHeight }]}>
                {timed ? <Text style={[eyebrow, styles.tabular, { color: colors.ink3 }]}>{clockLabel(task.time as number)}</Text> : null}
                {marks.length ? (
                  <View style={timed ? styles.afterTime : null}>
                    <Glyphs names={marks} size={glyph} gap={5} />
                  </View>
                ) : null}
              </Animated.View>
            </Animated.View>
          ) : null}
          {title({
            variant: "lead",
            // Light 300 only here, only in dark mode, only at 21 pt and up. A tick never changes the face.
            weight: dark ? "light" : "regular",
            color: dark ? colors.soft : colors.ink,
            numberOfLines: 3,
            style: hasEyebrow ? styles.headline : null,
          })}
          {context ? (
            <Animated.View style={[styles.context, receding]}>
              <Animated.View entering={follow}>{context}</Animated.View>
            </Animated.View>
          ) : null}
        </View>,
        styles.leadWords,
      )}
      {/* Rosebud's ring at full weight, empty at rest (a tick inside reads as done among empty rings). */}
      {check({ size: 28, quiet: true, ringColor: colors.ink2, ringWidth: 1.75, style: [styles.check, { top: checkTop }] })}
    </View>
  );
}

/** Every other task: one quiet line (two at most), its time set like a page number against a quiet ring. */
function Brief({ task, unsent, title, check, open }: LookRowProps) {
  const { colors, dark } = useTheme();
  const titleType = useType("callout");
  const time = useType("footnote");
  const suffix = useSize(11, 14);
  const glyph = useGlyph(11);
  const timed = task.time !== null && !task.done;
  // One mark at most, the most telling; the lead and the task page show them all, and VoiceOver reads them all.
  const mark = marksOf(task, unsent).slice(0, 1);
  const titleBase = baseline(titleType.fontSize, titleType.lineHeight);
  // The time shares the title's baseline; a glyph sits on the middle of the figures (or of the title's capitals).
  const timeTop = titleBase - baseline(time.fontSize, time.lineHeight);
  const glyphCentre = timed ? titleBase - (CAP * time.fontSize) / 2 : titleBase - (CAP * titleType.fontSize) / 2;
  const clock = timed ? splitClock(task.time as number) : null;
  // Dark: a step under ink2, so the headline stays the one bright line.
  const ink = dark ? mix(colors.ink2, colors.card, 0.88) : colors.ink;
  return (
    <View style={styles.brief}>
      {open(
        <View collapsable={false} style={styles.briefWords} accessibilityLabel={said(task, false, unsent)}>
          <View style={styles.flex}>{title({ variant: "callout", weight: "regular", color: ink, numberOfLines: 2, style: styles.briefTitle })}</View>
          {mark.length || clock ? (
            <View style={styles.marks} pointerEvents="none">
              {mark.length ? (
                <View style={{ height: glyph, marginTop: glyphCentre - glyph / 2, justifyContent: "center" }}>
                  <Glyphs names={mark} size={glyph} gap={4} />
                </View>
              ) : null}
              {clock ? (
                <Text style={[time, styles.tabular, { color: colors.ink3, marginTop: timeTop }]}>
                  {clock.figures}
                  <Text style={[suffix, styles.suffix]}>{` ${clock.suffix}`}</Text>
                </Text>
              ) : null}
            </View>
          ) : null}
        </View>,
        styles.briefOpen,
      )}
      {check({ size: 18, quiet: true, ringColor: colors.ringQuiet, ringWidth: 1.25, style: { marginTop: BRIEF.vertical + titleType.lineHeight / 2 - TARGET / 2 } })}
    </View>
  );
}

/**
 * The card: the lead, one hairline, the briefs, and (on a long day) "Also
 * today" naming the rest. Every row is a direct child of the card, so nothing
 * moves inside something that moves; the lead's row has its own key, so the
 * next task leaves the briefs and mounts fresh as the lead (its two faces
 * cross-fade; no text ever animates between sizes).
 */
function List({ tasks, variant, renderRow, foldKey }: LookListProps) {
  const { colors } = useTheme();
  const today = variant === "today";
  const { folded, unfold } = useDayFold(foldKey, tasks.length, 6);
  const shown = folded ? tasks.slice(0, 5) : tasks;
  const named = folded ? tasks.slice(5) : [];
  // Just unfolded: the named tasks arrive as briefs, one after another.
  const [opening, setOpening] = useState(false);
  const opened = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => void (opened.current && clearTimeout(opened.current)), []);
  const show = () => {
    tick();
    setOpening(true);
    unfold();
    opened.current = setTimeout(() => setOpening(false), 900);
  };

  const rows: React.ReactElement[] = [];
  shown.forEach((task, i) => {
    // renderRow's wrapper is an Animated.View (TaskCard): its arrival can be swapped for this look's.
    const row = renderRow(task, i) as React.ReactElement<{ entering?: unknown }>;
    if (today && i === 0) {
      // The lead: its own key, so a brief stepping up remounts here, rising from a little below.
      rows.push(React.cloneElement(row, { key: `lead-${task.id}`, entering: stepUp }));
      if (shown.length > 1) rows.push(<Animated.View key="rule" layout={settle} entering={arrive} exiting={leave} style={[styles.rule, { backgroundColor: colors.hairline }]} />);
    } else if (opening && i >= 5) {
      rows.push(React.cloneElement(row, { entering: unfoldIn[Math.min(i - 5, unfoldIn.length - 1)] }));
    } else rows.push(row);
  });

  return (
    <Animated.View layout={settle} style={[styles.card, today ? null : styles.cardDay, { backgroundColor: colors.card, boxShadow: colors.cardShadow }]}>
      {rows}
      {named.length ? <AlsoToday key="also" tasks={named} onPress={show} /> : null}
    </Animated.View>
  );
}

/**
 * The rest of a long day, named in one grey sentence; a tap shows them as
 * briefs. Never a count. Each name is a unit: it never breaks across lines
 * (its spaces don't break) and is never cut; names that don't fit the lines
 * are left to "and more", and VoiceOver hears every one.
 */
function AlsoToday({ tasks, onPress }: { tasks: Task[]; onPress: () => void }) {
  const { colors } = useTheme();
  const large = useDevice((state) => state.prefs.largeText);
  const type = useSize(14, 20);
  const glyph = useGlyph(12);
  const lines = large ? 3 : 2;
  const titles = tasks.map((task) => task.title);
  // The column's width, to tell a name longer than a whole line (only that one may break between words).
  const [width, setWidth] = useState(0);
  const perLine = width ? width / (type.fontSize * 0.5) : 40;
  const units = titles.map((name) => (name.length < perLine * 0.85 ? name.replace(/ /g, NBSP) : name));
  // How many names fit, found by measuring a hidden copy and dropping whole names from the end.
  const key = `${titles.join("\n")}|${type.fontSize}|${Math.round(width)}`;
  const [fit, setFit] = useState({ key, count: titles.length, done: false });
  const current = fit.key === key ? fit : { key, count: titles.length, done: false };
  const sentence = (count: number) => units.slice(0, count).join(`${NBSP}· `) + (count < units.length ? `${NBSP}· and${NBSP}more` : "");
  const measured = (event: LayoutChangeEvent) => {
    const taken = Math.round(event.nativeEvent.layout.height / type.lineHeight);
    if (taken > lines && current.count > 1) setFit({ key, count: current.count - 1, done: false });
    else setFit({ key, count: current.count, done: true });
  };
  // The press: the rows' sunken wash, faded in as they do.
  const wash = useSharedValue(0);
  const washing = useAnimatedStyle(() => ({ opacity: wash.value }));
  const runIn = (
    <Text style={{ color: colors.ink2, fontFamily: face.semibold }}>{`Also${NBSP}today`}</Text>
  );
  return (
    <Animated.View layout={settle} entering={arrive} exiting={leave}>
      <Pressable
        onPress={onPress}
        onPressIn={() => (wash.value = withTiming(1, fadeTiming(duration.press)))}
        onPressOut={() => (wash.value = withTiming(0, fadeTiming(duration.base)))}
        accessibilityRole="button"
        accessibilityLabel={`Also today: ${titles.join(", ")}. Show them`}
        style={styles.also}
      >
        <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: colors.sunken }, washing]} />
        <View style={styles.flex} onLayout={(event) => setWidth(event.nativeEvent.layout.width)}>
          <Text numberOfLines={lines} style={[type, { color: colors.ink3, fontFamily: face.regular, opacity: current.done ? 1 : 0 }]}>
            {runIn}
            {/* An en space after the run-in; the names' dots never start a line. */}
            {` ${sentence(current.count)}`}
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
              {runIn}
              {` ${sentence(current.count)}`}
            </Text>
          )}
        </View>
        {/* On the checks' axis, centred on the first line, like the rings. */}
        <View style={[styles.chevron, { marginTop: type.lineHeight / 2 - TARGET / 2 }]}>
          <Icon name="down" size={glyph} color={colors.ink3} weight="medium" />
        </View>
      </Pressable>
    </Animated.View>
  );
}

export const frontpage: Look = { id: "frontpage", label: "The front page", surface: "card", heading: "keep", Row, List };

const styles = StyleSheet.create({
  flex: { flex: 1 },
  flexShrink: { flexShrink: 1 },
  tabular: { fontVariant: ["tabular-nums"] },
  italic: { fontFamily: face.italic },
  // The foot: the last line's baseline sits about as far from the card's edge (21) as the first capitals from its head (20).
  card: { marginHorizontal: edge, borderRadius: radius.card, borderCurve: "continuous", overflow: "hidden", paddingBottom: 2 },
  cardDay: { paddingTop: 2 },
  rule: { height: 1, marginHorizontal: 16, marginBottom: 4 },
  // The lead
  leadWords: { paddingTop: LEAD.top, paddingLeft: LEAD.left, paddingRight: LEAD.right, paddingBottom: LEAD.bottom },
  eyebrow: { flexDirection: "row", alignItems: "center" },
  afterTime: { marginLeft: 6 },
  headline: { marginTop: 4 },
  context: { marginTop: 6 },
  from: { flexDirection: "row", alignItems: "flex-start", gap: 5 },
  doc: { justifyContent: "center", marginLeft: -1 },
  check: { position: "absolute", right: CHECK_RIGHT, width: TARGET, height: TARGET },
  glyphs: { flexDirection: "row", alignItems: "center" },
  // A brief
  brief: { flexDirection: "row", alignItems: "flex-start", paddingRight: CHECK_RIGHT, minHeight: 48 },
  briefOpen: { flex: 1, paddingVertical: BRIEF.vertical, paddingLeft: BRIEF.left },
  briefWords: { flexDirection: "row", alignItems: "flex-start" },
  briefTitle: { letterSpacing: -0.1 },
  // Flush against the check's target: its own slack (13) is the gap to the ring, so the time and ring read as one folio.
  marks: { flexDirection: "row", alignItems: "flex-start", gap: 6, marginLeft: 12 },
  suffix: { fontFamily: face.regular, textTransform: "uppercase", letterSpacing: 0.3 },
  // "Also today"
  also: { flexDirection: "row", alignItems: "flex-start", minHeight: 48, paddingTop: 10, paddingBottom: 14, paddingLeft: 16, paddingRight: CHECK_RIGHT },
  measure: { position: "absolute", left: 0, right: 0, top: 0, opacity: 0 },
  chevron: { width: TARGET, height: TARGET, alignItems: "center", justifyContent: "center" },
});
