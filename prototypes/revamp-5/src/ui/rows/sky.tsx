import React, { useContext, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View, type LayoutChangeEvent, type TextStyle } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import type { Task } from "../../store/model";
import { arrive, arriveAfter, duration, fadeTiming, leave, settle } from "../../theme/motion";
import { useTheme } from "../../theme/ThemeProvider";
import { edge, face, radius, space, type Phase } from "../../theme/tokens";
import { tick } from "../haptics";
import { Icon, type IconName } from "../Icon";
import { Txt, useType } from "../Txt";
import { useDayFold } from "./fold";
import { RowPlace, type Place } from "./place";
import type { Look, LookListProps, LookRowProps } from "./types";

/*
 * "Under the sky" (round 3, 2026-10-08; second revision). Today follows the
 * day's parts. Each part with something in it has a centred heading in
 * Sage's section style, a line glyph of its sky before the words: [sunrise]
 * "This morning", [sun] "This afternoon", [sunset] "This evening", [moon]
 * "Tonight". The part it is now holds the lit card: everything untimed, and
 * anything timed for now or earlier (carried over, never coloured late).
 * Each later part waits on the page under its own heading, in quieter ink
 * and quieter rings. The now heading goes without its glyph while the
 * greeting card above already draws that part's sky (one sunrise, not two).
 * When the clock (or Settings' time of day) turns, the heading cross-fades
 * and the next part's tasks step up onto the card.
 *
 * One grid: words at x 32 on the card and on the page alike, the check's
 * centre at x 347, small marks after the words, the time ("3:00 pm", one
 * size) by the check on the title's first line, 48-point rows, no hairlines.
 * The lit card folds past six into one sentence ("Also this afternoon
 * Motion design sketches · …"); a later part past three shows two and its
 * own ("Also this evening …"). No counts, no colour but the tick.
 */

// ---------------------------------------------------------------------------
// The parts of the day (phaseOf's boundaries; night is the last part).

const ORDER: Phase[] = ["dawn", "day", "dusk", "night"];
const LABEL: Record<Phase, string> = { dawn: "This morning", day: "This afternoon", dusk: "This evening", night: "Tonight" };
const ALSO: Record<Phase, string> = { dawn: "Also this morning", day: "Also this afternoon", dusk: "Also this evening", night: "Also tonight" };
const GLYPH: Record<Phase, IconName> = { dawn: "sunrise", day: "today", dusk: "sunset", night: "moon" };
// Optical lift, so each glyph sits with the words: the horizon of sunrise and sunset near the baseline, the sun and moon on the capitals.
const LIFT: Record<Phase, number> = { dawn: -2, day: 0.5, dusk: -2, night: 0 };

/** The part of the day a time (minutes after midnight) falls in: 5–11 morning, 11–17 afternoon, 17–21 evening, 21–5 night. */
export function partOf(minutes: number): Phase {
  const h = Math.floor(minutes / 60);
  if (h >= 5 && h < 11) return "dawn";
  if (h >= 11 && h < 17) return "day";
  if (h >= 17 && h < 21) return "dusk";
  return "night";
}

/** "3:00 pm", one size (the space doesn't break). */
function clock(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, "0")}\u00A0${h < 12 ? "am" : "pm"}`;
}

// The web build's demo can set the time of day from the address (`&sky=day`), so the screenshots show the day's shape
// at any hour. It goes through Settings' own time-of-day control, so the greeting and picture follow too.
const ASKED: Phase | null = (() => {
  if (process.env.EXPO_OS !== "web" || typeof window === "undefined") return null;
  const asked = new URLSearchParams(window.location.search).get("sky");
  return asked && (ORDER as string[]).includes(asked) ? (asked as Phase) : null;
})();
let askedSet = false;

// ---------------------------------------------------------------------------
// The row.

const NOWRAP = (process.env.EXPO_OS === "web" ? { whiteSpace: "nowrap" } : {}) as unknown as TextStyle;
const ROUND = radius.button; // a row on the page: its wash and the swipe's colour are a rounded slab

const NOW: Place = { surface: "lit" };
const LATER: Place = { surface: "page", later: true, corners: "all", radius: ROUND };

function Row({ task, leftOff, unsent, title, check, open }: LookRowProps) {
  const { colors } = useTheme();
  const place = useContext(RowPlace);
  const later = !!place?.later;
  const line = useType("row");
  const scale = line.fontSize / 17;
  const mark = Math.round(12 * scale);
  const marks: React.ReactNode[] = [];
  if (task.remind !== null) marks.push(<Icon key="remind" name="bell" size={mark} color={colors.ink3} weight="medium" />);
  // A timed row keeps its line for the words and the time: there only the bell follows the words (the repeat is still said).
  if (task.repeat && task.time === null) marks.push(<Icon key="repeat" name="repeat" size={mark} color={colors.ink3} weight="medium" />);
  if (unsent) marks.push(<Icon key="unsent" name="cloudUp" size={mark} color={colors.ink3} weight="medium" />);
  const time = task.time !== null ? clock(task.time) : null;
  // What a screen reader hears for the row: "Walk at lunch, no podcast, 12:30 pm, reminder, repeats".
  const said = [
    task.title,
    time ? time.replace("\u00A0", " ") : null,
    task.remind !== null ? "reminder" : null,
    task.repeat ? "repeats" : null,
    unsent ? "not sent yet" : null,
    leftOff ? `where you left off: ${leftOff}` : null,
  ]
    .filter(Boolean)
    .join(", ");

  // The marks follow the words, glued to the last word by a no-break space (never a glyph alone on a line).
  // (The web build breaks before an inline box even after a no-break space, so there the pair is also kept from wrapping.)
  const suffix = marks.length ? (
    <Text style={NOWRAP}>
      {"\u00A0"}
      <View style={[styles.inline, { transform: [{ translateY: Math.round(0.5 * scale * 2) / 2 }] }]}>{marks}</View>
    </Text>
  ) : null;

  return (
    <View style={styles.row}>
      {open(
        <View style={styles.column}>
          <View style={styles.first}>
            <View style={styles.flex}>{title({ variant: "row", weight: "regular", color: later ? colors.ink2 : colors.soft, numberOfLines: 2, suffix })}</View>
            {time ? (
              <View style={[styles.time, { height: line.lineHeight }]} pointerEvents="none">
                {/* On the title's baseline: the same line height as the title, nudged by the difference in the fonts' sizes. */}
                <Txt variant="footnote" tone="ink3" style={[styles.tabular, { lineHeight: line.lineHeight, transform: [{ translateY: Math.round(2 * scale * 2) / 2 }] }]}>
                  {time}
                </Txt>
              </View>
            ) : null}
          </View>
          {leftOff ? (
            <Text numberOfLines={1} style={[styles.leftOff, { color: colors.ink3, fontSize: Math.round(14 * scale), lineHeight: Math.round(19 * scale) }]}>
              {leftOff}
            </Text>
          ) : null}
        </View>,
        styles.open,
        { accessibilityLabel: said },
      )}
      {/* The 44-point target, centred on the first line, takes no more height than the line (and reaches no further than its row). */}
      {/* The lit card's rings are the firmer ones (ink3, 1.5); a later row's step back (ringQuiet, 1.25). Press and tick keep the accent. */}
      {check({ size: 20, quiet: true, ringColor: later ? colors.ringQuiet : colors.ink3, ringWidth: later ? 1.25 : 1.5, hitSlop: 0, style: [styles.check, { marginVertical: (line.lineHeight - CHECK_BOX) / 2 }] })}
    </View>
  );
}

// ---------------------------------------------------------------------------
// The list: what's for now on the lit card; each later part on the page below it, under its own name.

const NOW_MOST = 6; // the lit card shows up to this many; past it, 5 and "Also this afternoon …"
const LATER_MOST = 3; // a later part shows up to 3; past it, 2 and "Also this evening …"
const STAGGER = 30;
const NBSP = "\u00A0";

// A later part unfolded on a day stays so for that day (until the app restarts), like useDayFold; and it folds back.
const opened = new Set<string>();

type Group = { key: string; label: string; glyph: Phase | null; also: string; tasks: Task[]; lit: boolean };

function List({ tasks, variant, renderRow, foldKey }: LookListProps) {
  const { phase, phaseOverride, setPhaseOverride } = useTheme();
  useEffect(() => {
    if (ASKED && !askedSet) {
      askedSet = true;
      setPhaseOverride(ASKED);
    }
  }, [setPhaseOverride]);
  const [, redraw] = useReducer((n: number) => n + 1, 0);

  const today = variant === "today";
  // After midnight the day's morning, afternoon and evening are all still to come: no parts in the small hours,
  // the plain "Tasks" list (the day changes at midnight and the part at 5, so the list redraws at both).
  // (Settings' time of day set to night shows the evening's "Tonight", whatever the hour.)
  const smallHours = phase === "night" && !phaseOverride && new Date().getHours() < 5;
  const plain = !today || smallHours;

  const groups = useMemo<Group[]>(() => {
    if (plain) return [{ key: "now", label: "Tasks", glyph: null, also: "Also today", tasks, lit: true }];
    const nowAt = ORDER.indexOf(phase);
    let nowTasks: Task[] = [];
    const byPart = new Map<Phase, Task[]>();
    for (const task of tasks) {
      const part = task.time === null ? null : partOf(task.time);
      if (part === null || ORDER.indexOf(part) <= nowAt) nowTasks.push(task);
      else byPart.set(part, [...(byPart.get(part) ?? []), task]);
    }
    const parts = ORDER.filter((part) => byPart.has(part));
    // Nothing for now: what comes next is the day's lit card (a landing point), under its own part's name.
    let nowPart = phase;
    if (!nowTasks.length && parts.length) {
      nowPart = parts.shift()!;
      nowTasks = byPart.get(nowPart)!;
    }
    const out: Group[] = [];
    // The greeting card above already draws the part it is now (sunrise under "Good morning"): the now heading names it in words only.
    if (nowTasks.length) out.push({ key: "now", label: LABEL[nowPart], glyph: nowPart === phase ? null : nowPart, also: ALSO[nowPart], tasks: nowTasks, lit: true });
    // Each later part on its own, named for its sky.
    for (const part of parts) out.push({ key: part, label: LABEL[part], glyph: part, also: ALSO[part], tasks: byPart.get(part)!, lit: false });
    return out;
  }, [tasks, plain, phase]);

  // The lit card folds with the day (useDayFold: past six, five and the sentence).
  const nowGroup = groups.find((group) => group.lit);
  const nowFold = useDayFold(foldKey, nowGroup?.tasks.length ?? 0, NOW_MOST);

  // Arrivals step in 30 ms apart: the rows the day turned onto the lit card, and the rows a sentence unfolds.
  const steps = useMemo(() => Array.from({ length: 16 }, (_, k) => arriveAfter(k * STAGGER, duration.base)), []);
  const wasLater = useRef(new Set<string>());
  const justOpened = useRef<string | null>(null);
  const laterIds = groups.filter((group) => !group.lit).flatMap((group) => group.tasks.map((task) => task.id));
  useEffect(() => {
    wasLater.current = new Set(laterIds);
    justOpened.current = null;
  });
  const step = (k: number) => ({ entering: steps[Math.min(k, steps.length - 1)] });

  let index = 0;
  return (
    <View>
      {groups.map((group, g) => {
        // The lit card: up to 6, or 5 and its sentence. A later part: up to 3, or 2 and its sentence.
        const most = group.lit ? NOW_MOST : LATER_MOST;
        const keep = most - 1;
        const key = foldKey ? `${foldKey}:${group.key}` : null;
        const long = !!key && group.tasks.length > most;
        const folded = group.lit ? nowFold.folded : long && !opened.has(key!);
        const shown = folded ? group.tasks.slice(0, keep) : group.tasks;
        let turned = 0;
        const rows = shown.map((task, i) => {
          if (group.lit && wasLater.current.has(task.id)) return renderRow(task, index++, step(turned++));
          if (justOpened.current === group.key && i >= keep) return renderRow(task, index++, step(i - keep));
          return renderRow(task, index++);
        });
        const unfold = () => {
          tick();
          justOpened.current = group.key;
          if (group.lit) nowFold.unfold();
          else opened.add(key!);
          redraw();
        };
        const fold = () => {
          tick();
          if (group.lit) nowFold.fold();
          else opened.delete(key!);
          redraw();
        };
        const last = g === groups.length - 1;
        return (
          <Animated.View key={group.key} layout={settle} entering={arrive} exiting={leave} style={last && !group.lit ? styles.lastOnPage : null}>
            <PartHeading label={group.label} glyph={group.glyph} first={!today} lit={group.lit} after={g === 0 ? null : groups[g - 1].lit ? "card" : "page"} />
            <Surface lit={group.lit} single={shown.length === 1 && !long}>
              <RowPlace.Provider value={group.lit ? NOW : LATER}>{rows}</RowPlace.Provider>
              {folded ? (
                <Animated.View key="also" entering={arrive} exiting={leave}>
                  <Also label={group.also} names={group.tasks.slice(keep).map((task) => task.title)} onPress={unfold} onPage={!group.lit} />
                </Animated.View>
              ) : long ? (
                <Animated.View key="fewer" entering={arriveAfter((group.tasks.length - keep) * STAGGER, duration.base)} exiting={leave}>
                  <Fewer onPress={fold} onPage={!group.lit} />
                </Animated.View>
              ) : null}
            </Surface>
          </Animated.View>
        );
      })}
    </View>
  );
}

/** The set's short lift (as Lamplight's): litShadow's tint, close and soft, so no halo spreads on the bare page. Dark keeps litShadow (none). */
function liftOf(shadow: string, dark: boolean) {
  const tint = dark ? null : shadow.match(/rgba\((\d+),\s*(\d+),\s*(\d+)/);
  return tint ? `0px 1px 2px rgba(${tint[1]}, ${tint[2]}, ${tint[3]}, 0.05), 0px 2px 8px rgba(${tint[1]}, ${tint[2]}, ${tint[3]}, 0.05)` : shadow;
}

/** What holds a group's rows: the lit card for now (lifted in light, a step up in dark), or nothing for later (the page itself). Its height glides as rows come and go. */
function Surface({ lit, single, children }: { lit: boolean; single: boolean; children: React.ReactNode }) {
  const { colors, dark } = useTheme();
  return (
    <Animated.View layout={settle} style={[styles.surface, lit ? { backgroundColor: colors.lit, boxShadow: liftOf(colors.litShadow, dark), paddingVertical: single ? 6 : space[1] } : null]}>
      {children}
    </Animated.View>
  );
}

/**
 * A group's heading, centred, in Sage's section style, with a line glyph of
 * its part of the sky. When it changes, the old words leave as the new ones
 * arrive, the old held in place so the line doesn't jump.
 */
function PartHeading({ label, glyph, first, lit, after }: { label: string; glyph: Phase | null; first: boolean; lit: boolean; after: "card" | "page" | null }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.heading, first && styles.headingFirst, after === "card" && styles.afterCard, after === "page" && styles.afterPage, !lit && styles.beforeRows]}>
      <Animated.View key={label} entering={arrive} exiting={leave} style={styles.headingWords}>
        {glyph ? (
          <View style={{ transform: [{ translateY: LIFT[glyph] }] }}>
            <Icon name={GLYPH[glyph]} size={16} color={colors.ink3} weight="regular" />
          </View>
        ) : null}
        <Txt variant="section" tone="ink3" accessibilityRole="header">
          {label}
        </Txt>
      </Animated.View>
    </View>
  );
}

/** The 14/20 line of the sentences, and the row's own line (for the chevron's axis). */
function useSmall() {
  const line = useType("row");
  const scale = line.fontSize / 17;
  return { scale, small: { fontSize: Math.round(14 * scale), lineHeight: Math.round(20 * scale) } };
}

/** The sunken press wash of the rows, faded in and out as theirs is. */
function useWash() {
  const wash = useSharedValue(0);
  const style = useAnimatedStyle(() => ({ opacity: wash.value }));
  return {
    style,
    onPressIn: () => (wash.value = withTiming(1, fadeTiming(duration.press))),
    onPressOut: () => (wash.value = withTiming(0, fadeTiming(duration.base))),
  };
}

/**
 * What's folded away, named rather than counted, in one sentence: "Also this
 * afternoon" (SemiBold ink2), then the names (Regular ink3) on the same
 * line, two lines at most: "Motion design sketches · Cancel the puzzle app
 * trial · and more". Each name is a unit (its spaces don't break, the dot
 * stays with the name before it) and is never cut: how many fit is measured
 * on a hidden copy, dropping whole names from the end. The chevron sits on
 * the first line, on the checks' axis.
 */
function Also({ label, names, onPress, onPage }: { label: string; names: string[]; onPress: () => void; onPage: boolean }) {
  const { colors } = useTheme();
  const { scale, small } = useSmall();
  const wash = useWash();
  const lines = 2;
  // The column's width, to tell a name longer than most of a line (only that one may break between words).
  const [width, setWidth] = useState(0);
  const perLine = width ? width / (small.fontSize * 0.5) : 40;
  const units = names.map((name) => (name.length < perLine * 0.8 ? name.replace(/ /g, NBSP) : name));
  const sentence = (count: number) => units.slice(0, count).join(`${NBSP}· `) + (count < units.length ? `${NBSP}· and${NBSP}more` : "");
  const key = `${names.join("\n")}|${small.fontSize}|${Math.round(width)}`;
  const [fit, setFit] = useState({ key, count: names.length, done: false });
  const current = fit.key === key ? fit : { key, count: names.length, done: false };
  const measured = (event: LayoutChangeEvent) => {
    if (!width) return;
    const taken = Math.round(event.nativeEvent.layout.height / small.lineHeight);
    if (taken > lines && current.count > 1) setFit({ key, count: current.count - 1, done: false });
    else setFit({ key, count: current.count, done: true });
  };
  const words = (count: number) => (
    <>
      <Text style={{ fontFamily: face.semibold, color: colors.ink2 }}>{label.replace(/ /g, NBSP)}</Text>
      {` ${sentence(count)}`}
    </>
  );
  return (
    <Pressable onPress={onPress} onPressIn={wash.onPressIn} onPressOut={wash.onPressOut} accessibilityRole="button" accessibilityLabel={`${label}: ${names.join(", ")}. Show them`} style={[styles.fold, onPage && styles.foldOnPage]}>
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: colors.sunken }, wash.style]} />
      <View style={styles.flex} onLayout={(event) => setWidth(event.nativeEvent.layout.width)}>
        <Text numberOfLines={lines} style={[small, { fontFamily: face.regular, color: colors.ink3, opacity: current.done ? 1 : 0 }]}>
          {words(current.count)}
        </Text>
        {current.done ? null : (
          <Text
            key={`${key}|${current.count}`}
            onLayout={measured}
            aria-hidden
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            style={[small, styles.measure, { fontFamily: face.regular }]}
          >
            {words(current.count)}
          </Text>
        )}
      </View>
      <View style={[styles.chevron, { height: small.lineHeight }]}>
        <Icon name="down" size={Math.round(11 * scale)} color={colors.ink3} weight="medium" />
      </View>
    </Pressable>
  );
}

/** After a sentence unfolds: the way back, in the sentence's own voice. */
function Fewer({ onPress, onPage }: { onPress: () => void; onPage: boolean }) {
  const { colors } = useTheme();
  const { scale, small } = useSmall();
  const wash = useWash();
  return (
    <Pressable onPress={onPress} onPressIn={wash.onPressIn} onPressOut={wash.onPressOut} accessibilityRole="button" accessibilityLabel="Show fewer" style={[styles.fold, onPage && styles.foldOnPage]}>
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: colors.sunken }, wash.style]} />
      <Text style={[styles.flex, small, { fontFamily: face.semibold, color: colors.ink2 }]}>Show fewer</Text>
      <View style={[styles.chevron, { height: small.lineHeight }]}>
        <Icon name="up" size={Math.round(11 * scale)} color={colors.ink3} weight="medium" />
      </View>
    </Pressable>
  );
}

export const sky: Look = { id: "sky", label: "Under the sky", surface: "card", heading: "none", actionsSurface: "quiet", Row, List };

// ---------------------------------------------------------------------------

const PAD = 12.5; // (48 − 23) / 2: a one-line row is 48
const FOLD_PAD = 14; // (48 − 20) / 2: a one-line sentence is 48, its first line on the rows' axis (24 down)
const CHECK_BOX = 44;
const TIME_GAP = 16; // the least room between the words (and their marks) and the time
const AFTER_CARD = 35; // the lit card's edge to a later heading's cap top: 40
const AFTER_PAGE = 20.5; // a page row's last ink to the next heading's cap top: 40
const BEFORE_ROWS = 1.5; // a later heading's baseline to its first row's cap top: 24

const styles = StyleSheet.create({
  flex: { flex: 1 },
  row: { flexDirection: "row", alignItems: "flex-start", minHeight: 48, paddingTop: PAD, paddingBottom: PAD, paddingLeft: 16, paddingRight: 8 },
  open: { flex: 1, marginTop: -PAD, marginBottom: -PAD, paddingTop: PAD, paddingBottom: PAD, marginLeft: -16, paddingLeft: 16 },
  column: { flex: 1 },
  first: { flexDirection: "row", alignItems: "flex-start" },
  inline: { flexDirection: "row", alignItems: "center", gap: 3 },
  time: { marginLeft: TIME_GAP, justifyContent: "center" },
  leftOff: { fontFamily: face.italic, marginTop: 1 },
  tabular: { fontVariant: ["tabular-nums"] },
  check: { width: CHECK_BOX, height: CHECK_BOX, minWidth: CHECK_BOX, minHeight: CHECK_BOX },
  surface: { marginHorizontal: edge, borderRadius: radius.card, borderCurve: "continuous", overflow: "hidden" },
  // The last part on the page: its last line ends as far above Add task as the lit card's last line would (the card's 4 inner foot, then Today's 12).
  lastOnPage: { paddingBottom: space[1] },
  heading: { alignItems: "center", paddingTop: space[7], paddingBottom: space[3] },
  headingFirst: { paddingTop: space[4] },
  // A later part's heading belongs to its rows: 40 from whatever ends the group above (the lit card's edge, or the last ink of a page row)
  // to its cap top, and 24 from its baseline to its first row's cap top. (Section 15/20: the cap top sits 4.5 below the line's top,
  // the baseline 5 above its foot; a row's cap top is 5.5 below its 23 line, under the row's 12.5; a page row's last ink is ~5.5 above its foot.)
  afterCard: { paddingTop: AFTER_CARD },
  afterPage: { paddingTop: AFTER_PAGE },
  beforeRows: { paddingBottom: BEFORE_ROWS },
  headingWords: { flexDirection: "row", alignItems: "center", gap: 6 },
  fold: { flexDirection: "row", alignItems: "flex-start", minHeight: 48, paddingVertical: FOLD_PAD, paddingLeft: 16, paddingRight: 8 },
  foldOnPage: { borderRadius: ROUND, borderCurve: "continuous", overflow: "hidden" },
  measure: { position: "absolute", left: 0, right: 0, top: 0, opacity: 0 },
  chevron: { width: CHECK_BOX, alignItems: "center", justifyContent: "center", marginLeft: 10 },
});
