import React, { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, View, useWindowDimensions, type LayoutChangeEvent } from "react-native";
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withSequence, withSpring, withTiming } from "react-native-reanimated";
import type { Task } from "../../store/model";
import { byPlan, clockLabel } from "../../store/selectors";
import { arriveAfter, duration, easeOut, fadeTiming, leave, settle, spring } from "../../theme/motion";
import { useTheme } from "../../theme/ThemeProvider";
import { pad, radius, space } from "../../theme/tokens";
import { CircleCheck } from "../CircleCheck";
import { tick } from "../haptics";
import { Icon, type IconName } from "../Icon";
import { Txt, useType } from "../Txt";
import { useDayFold } from "./fold";
import { RowPlace } from "./place";
import type { Look, LookListProps, LookRowProps } from "./types";

/*
 * The margin (round 3, revised 2026-10-08). The card holds your words, set as
 * plain sentences, and a set time sits at the right of its title's first line,
 * small and grey. The checks step out into the page's margin as small beads,
 * one beside each title's first line, the way you'd tick a paper planner.
 *
 * Each row is one unit: its bead on the page, its slice of the card. It
 * swipes, leaves and arrives whole.
 */

// The grid, on a 393-point screen: the margin column runs 0 to 48 (beads centred on x 25, their
// left edge on Add task's x 16), the card 48 to 377, the words 64 to 361.
const CARD_LEFT = 48;
const CARD_RIGHT = 16;
const AXIS = 25;
const PAD_X = 16;
/**
 * A slice's padding: 13 over a title and 12 under it, so a one-line row is 48 and its ink sits
 * even in its slice (a line keeps more room under its baseline than over its capitals). At the
 * card's ends 15 on top and 14 at the foot: 20 from ink to edge at both.
 */
const PAD_TOP = 13;
const PAD_BOTTOM = 12;
const PAD_END = 15;
const PAD_FOOT = 14;
const STACK_GAP = 2;
/** The italic line's smaller type keeps a point less under its baseline: given back, so the next title starts on the card's beat. */
const LEFT_OFF_FOOT = 1;
/** The optical middle of a mixed-case line sits a little under its capitals' middle. */
const OPTICAL = 0.5;
/** Between a title and its time, at the least. */
const TIME_GAP = 16;
/** Half of (ascent - descent) for Nunito Sans, per point of size: where a baseline sits in its line. */
const BASELINE = 0.329;

// The bead: Sage's check drawn at 22 and shown at 18 at rest, on a 44-point target (x 3 to 47).
const BEAD = 22;
const REST = 0.82;
/**
 * Its ring, drawn 2 points thick on the 22-point check, so it shows at 1.64 at rest. A whole point:
 * the web rounds a fractional border down (1.83 drew as 1, a 0.8-point hairline at rest), so this is
 * the one width the phone and the web previews draw alike.
 */
const RING_DRAWN = 2;
const TARGET = 44;
const TARGET_LEFT = AXIS - TARGET / 2;

/**
 * "Also today": the chevron's column at the right, 12 wide, 4 clear of the names. The glyph's ink is
 * narrower than its 10-point box: the box hangs CHEVRON_HANG past the column so the ink's right edge
 * lands on x 361, the times' right edge.
 */
const ALSO_TOP = 14;
const ALSO_FOOT = 13.5;
const ALSO_LINE = 20;
const CHEVRON_COLUMN = 16;
const CHEVRON_HANG = 1.5;
/** Down from the line box's middle to the middle of the line's capitals and x-height, where the eye centres it. */
const CHEVRON_DROP = 1.5;
/** What a line of "Also today" keeps spare when packing names by their measured widths (kerning between runs). */
const ALSO_SPARE = 3;

/** Up to six tasks the whole day shows; past it, the first five and "Also today", naming the rest. */
const FOLD_AT = 6;
const FOLDED = 5;

/** Where a row sits on the card, given by the List (its first slice rounds on top, its last at the foot). */
type Slice = { first: boolean; last: boolean };
const SliceContext = createContext<Slice | null>(null);

/** The small marks a task carries, each with what it says for VoiceOver. A timed row leaves its repeat to the task (room for the time). */
function marksOf(task: Task, unsent: boolean): { key: string; icon: IconName; label: string }[] {
  const marks: { key: string; icon: IconName; label: string }[] = [];
  if (task.remind !== null) marks.push({ key: "remind", icon: "bell", label: "reminds you" });
  if (task.repeat && task.time === null) marks.push({ key: "repeat", icon: "repeat", label: "repeats" });
  if (unsent) marks.push({ key: "unsent", icon: "cloudUp", label: "not sent yet" });
  return marks;
}

const NBSP = " ";

function Row(props: LookRowProps) {
  const slice = useContext(SliceContext);
  return slice ? <MarginRow {...props} slice={slice} /> : <PlainRow {...props} />;
}

function MarginRow({ task, checked, leftOff, unsent, title, check, open, wash, slice }: LookRowProps & { slice: Slice }) {
  const { colors, dark } = useTheme();
  const reduced = useReducedMotion();
  const { width } = useWindowDimensions();
  const row = useType("row");
  const sub = useType("subhead");
  const foot = useType("footnote");
  const marks = marksOf(task, unsent);
  // Ticked, the time and glyphs fade as the line draws through the words, keeping their space, so the
  // row holds its shape until it leaves.
  const shown = useSharedValue(checked ? 0 : 1);
  useEffect(() => {
    shown.value = withTiming(checked ? 0 : 1, fadeTiming(duration.base));
  }, [checked, shown]);
  const hideMarks = useAnimatedStyle(() => ({ opacity: shown.value }));
  const padTop = slice.first ? PAD_END : PAD_TOP;
  const padBottom = slice.last ? PAD_FOOT : PAD_BOTTOM;
  // The bead's centre, on the title's first line (from the ramp's line height, so "Larger text" keeps it there).
  const centre = padTop + row.lineHeight / 2 + OPTICAL;
  // The time's line, set so its baseline sits on the title's.
  const timeDrop = (row.lineHeight - foot.lineHeight) / 2 + (row.fontSize - foot.fontSize) * BASELINE;

  // Becoming the first row (the one above left) adds 2 points on top: the words and the bead ease
  // down into it as the rows glide, rather than jumping; the corners round in with them.
  const shift = useSharedValue(0);
  const lastTop = useRef(padTop);
  useLayoutEffect(() => {
    if (lastTop.current === padTop) return;
    const delta = lastTop.current - padTop;
    lastTop.current = padTop;
    if (!reduced) shift.value = withSequence(withTiming(shift.value + delta, { duration: 0 }), withTiming(0, { duration: duration.enter, easing: easeOut }));
  }, [padTop, reduced, shift]);
  const shiftStyle = useAnimatedStyle(() => ({ transform: [{ translateY: shift.value }] }));
  const topCorner = useSharedValue(slice.first ? radius.card : 0);
  const bottomCorner = useSharedValue(slice.last ? radius.card : 0);
  useEffect(() => {
    const timing = { duration: reduced ? 0 : duration.enter, easing: easeOut };
    topCorner.value = withTiming(slice.first ? radius.card : 0, timing);
    bottomCorner.value = withTiming(slice.last ? radius.card : 0, timing);
  }, [slice.first, slice.last, reduced, topCorner, bottomCorner]);
  const corners = useAnimatedStyle(() => ({
    borderTopLeftRadius: topCorner.value,
    borderTopRightRadius: topCorner.value,
    borderBottomLeftRadius: bottomCorner.value,
    borderBottomRightRadius: bottomCorner.value,
  }));
  // The press wash (and a just-added task's glow), on the slice only: the slice paints over the row's own.
  const washStyle = useAnimatedStyle(() => ({ opacity: wash.value }));

  // The title's measure: the slice's words, less the time and its gap on a timed row.
  const timed = task.time !== null;
  const [measure, setMeasure] = useState(width - CARD_LEFT - CARD_RIGHT - 2 * PAD_X - (timed ? 56 + TIME_GAP : 0));
  const glyphs = (inline: boolean) =>
    marks.map((mark, i) => (
      <Animated.View key={mark.key} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={[inline ? [styles.inlineGlyph, { paddingLeft: i ? 5 : 1 }] : styles.glyph, hideMarks]}>
        <Icon name={mark.icon} size={11} color={colors.ink3} weight="semibold" />
      </Animated.View>
    ));
  // A reminder or a repeat follows the last word, held to it by a no-break space. A title long
  // enough to run past two lines would cut it off with the ellipsis: there it stands at the end
  // of the second line instead, and the words stop short of it.
  const glyphWidth = marks.length * 11 + (marks.length - 1) * 5;
  const trailing = marks.length > 0;
  const long = trailing && task.title.length * row.fontSize * 0.47 > 2 * (measure - glyphWidth - 8);
  const words = (
    <Animated.View style={shiftStyle}>
      <View style={styles.line}>
        <View style={styles.flex} onLayout={(event: LayoutChangeEvent) => setMeasure(event.nativeEvent.layout.width)}>
          {title({
            variant: "row",
            weight: "regular",
            color: dark ? colors.soft : colors.ink,
            numberOfLines: 2,
            style: long ? { paddingRight: glyphWidth + 6 } : undefined,
            suffix: trailing && !long ? <>{NBSP}{glyphs(true)}</> : null,
          })}
          {long ? <View style={[styles.endGlyphs, { top: row.lineHeight + (row.lineHeight - 11) / 2 }]}>{glyphs(false)}</View> : null}
        </View>
        {timed ? (
          <Animated.View aria-hidden accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={[styles.time, { marginTop: timeDrop }, hideMarks]}>
            <Txt variant="footnote" tone="ink3" numberOfLines={1} style={styles.figures}>
              {clockLabel(task.time ?? 0).replace(" ", NBSP)}
            </Txt>
          </Animated.View>
        ) : null}
      </View>
      {leftOff ? (
        <Txt variant="subhead" tone="ink3" weight="italic" numberOfLines={2} style={{ fontSize: sub.fontSize - 1, lineHeight: sub.lineHeight - 1, marginTop: STACK_GAP, marginBottom: LEFT_OFF_FOOT }}>
          {leftOff}
        </Txt>
      ) : null}
    </Animated.View>
  );
  // VoiceOver hears everything the row shows, in reading order (the time and glyphs themselves are hidden from it).
  const spoken = [task.title, timed ? clockLabel(task.time ?? 0) : null, ...marks.map((mark) => mark.label), leftOff ? `left off: ${leftOff}` : null].filter(Boolean).join(", ");

  return (
    <View style={styles.row}>
      <Animated.View style={[styles.slice, { backgroundColor: colors.card }, corners]}>
        <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: colors.sunken }, washStyle]} />
        {open(words, { paddingTop: padTop, paddingBottom: padBottom, paddingHorizontal: PAD_X }, { accessibilityLabel: spoken })}
      </Animated.View>
      {/* The margin, on the page: the bead beside the title's first line. */}
      <Animated.View style={[styles.margin, shiftStyle]} pointerEvents="box-none">
        {check({
          hitSlop: 0,
          style: [styles.target, { top: centre - TARGET / 2 }],
          draw: ({ on, pressed }) => <Bead on={on} pressed={pressed} />,
        })}
      </Animated.View>
    </View>
  );
}

/**
 * Outside this look's list (should a row ever be drawn on its own), the row
 * much as Sage draws it elsewhere: the title, its time and marks on a line
 * under it, and the check on the right.
 */
function PlainRow({ task, unsent, title, check, open, wash }: LookRowProps) {
  const { colors } = useTheme();
  const washStyle = useAnimatedStyle(() => ({ opacity: wash.value }));
  const meta: React.ReactNode[] = [];
  if (!task.done) {
    if (task.time !== null)
      meta.push(
        <View key="time" style={styles.piece}>
          <Icon name="clock" size={13} color={colors.ink3} weight="medium" />
          <Txt variant="footnote" tone="ink3">
            {clockLabel(task.time)}
          </Txt>
        </View>,
      );
    marksOf(task, unsent).forEach((mark) =>
      meta.push(
        <View key={mark.key} style={styles.piece} accessible accessibilityLabel={mark.label}>
          <Icon name={mark.icon} size={13} color={colors.ink3} weight="medium" />
        </View>,
      ),
    );
  }
  return (
    <View style={styles.plainRow}>
      {/* The row's own wash covers only this look's card part (x 48 on): this one covers the whole row. */}
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: colors.sunken }, washStyle]} />
      {open(
        <>
          {title()}
          {meta.length ? <View style={styles.meta}>{meta}</View> : null}
        </>,
        styles.plainWords,
      )}
      {check({ size: 28, quiet: false, style: styles.plainCheck })}
    </View>
  );
}

/**
 * The bead: a quiet ring, shown at 18 (open inside, so a swipe's tint shows
 * through it). Under the finger it grows to 22 and the ring firms; ticked,
 * Sage's full tick plays at 22 and the accent disc stays.
 */
function Bead({ on, pressed }: { on: boolean; pressed: boolean }) {
  const { colors } = useTheme();
  const reduced = useReducedMotion();
  // CircleCheck gives a little (0.9) under the finger: this grows past it, so it shows at 22.
  const target = on ? 1 : pressed ? 1 / 0.9 : REST;
  const scale = useSharedValue(target);
  useEffect(() => {
    scale.value = reduced ? withTiming(target, fadeTiming(duration.base)) : withSpring(target, spring.pop);
  }, [target, reduced, scale]);
  const grow = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  // Under the finger the ring firms to ink2 over the accent's soft well (CircleCheck's well covers its own ring).
  const firm = useSharedValue(0);
  useEffect(() => {
    firm.value = withTiming(pressed && !on ? 1 : 0, fadeTiming(pressed ? duration.press : duration.quick));
  }, [pressed, on, firm]);
  const firmStyle = useAnimatedStyle(() => ({ opacity: firm.value }));
  return (
    <Animated.View style={[styles.bead, grow]}>
      <CircleCheck on={on} pressed={pressed} size={BEAD} quiet ringColor={colors.ringQuiet} ringWidth={RING_DRAWN} />
      <Animated.View pointerEvents="none" style={[styles.firm, { borderColor: colors.ink2 }, firmStyle]} />
    </Animated.View>
  );
}

/** A name for "Also today", cut at a word if it's long, so two always show. */
function shorten(title: string, max: number): string {
  // Only worth cutting if it saves more than a short word ("…trial" for "trial" saved nothing).
  if (title.length <= max + 5) return title;
  let cut = title.lastIndexOf(" ", max - 1);
  if (cut < max * 0.5) cut = max - 1;
  return `${title.slice(0, cut).replace(/[\s,;:.–—-]+$/, "")}…`;
}

/** Glued to the end of every name but the last, so a line that breaks after a name still ends on its dot (as across the set). */
const END_DOT = `${NBSP}·`;
const LABEL = `Also today${NBSP}${NBSP}`;
const MORE = `and${NBSP}more`;

/**
 * Sets "Also today" and the names in at most two lines, every name whole: each is measured
 * (an unseen copy), then packed line by line, every name but the last carrying its dot, so a
 * line ends "… bill ·" and the next starts on a name. If they don't all fit, as many as do
 * (always two), then "and more", never a count.
 */
function pack(width: number, label: number, names: number[], dot: number, gap: number, more: number): string[][] | null {
  const room = width - ALSO_SPARE;
  const lay = (items: { id: string; w: number }[]) => {
    const lines: string[][] = [[]];
    let x = label;
    for (let k = 0; k < items.length; k++) {
      const item = items[k];
      const w = item.w + (k < items.length - 1 ? dot : 0);
      const line = lines[lines.length - 1];
      const need = line.length ? gap + w : w;
      if (x + need <= room) {
        line.push(item.id);
        x += need;
      } else {
        if (w > room) return null;
        lines.push([item.id]);
        x = w;
      }
    }
    return lines.length <= 2 && lines[0].length ? lines : null;
  };
  const all = lay(names.map((w, i) => ({ id: String(i), w })));
  if (all) return all;
  for (let n = names.length - 1; n >= 2; n--) {
    const some = lay([...names.slice(0, n).map((w, i) => ({ id: String(i), w })), { id: "more", w: more }]);
    if (some) return some;
  }
  return null;
}

/** The card's last slice on a long day: "Also today" and the rest by name (never a count). */
function AlsoToday({ tasks, onPress }: { tasks: Task[]; onPress: () => void }) {
  const { colors } = useTheme();
  const sub = useType("subhead");
  const size = { fontSize: sub.fontSize - 1, lineHeight: ALSO_LINE * (sub.lineHeight / 20) };
  // Each name whole: no-break spaces inside it, so it can only ever move to a line as one piece.
  const names = useMemo(() => tasks.map((task) => shorten(task.title, 26).replace(/ /g, NBSP)), [tasks]);
  const key = names.join("|");

  // Measured: the column's width, and each piece's own width in one unbroken line.
  const [column, setColumn] = useState(0);
  const [widths, setWidths] = useState<Record<string, number>>({});
  const note = (id: string) => (event: LayoutChangeEvent) => {
    const w = event.nativeEvent.layout.width;
    setWidths((old) => (Math.abs((old[id] ?? -1) - w) < 0.25 ? old : { ...old, [id]: w }));
  };
  const known = column > 0 && widths.label > 0 && widths.dot > 0 && widths.gap > 0 && widths.more > 0 && names.every((_, i) => widths[`${key}#${i}`] > 0);
  // The gap between pieces is a space (measured as a no-break one, the same width: "· " less "·").
  const lines = known ? pack(column, widths.label, names.map((_, i) => widths[`${key}#${i}`]), widths.dot, widths.gap - widths.dot, widths.more) : null;
  const text = (line: string[], isLast: boolean) =>
    line.map((id, k) => (id === "more" ? MORE : names[Number(id)]) + (isLast && k === line.length - 1 ? "" : END_DOT)).join(" ");

  const regular = (children: React.ReactNode, extra?: object) => (
    <Txt variant="subhead" tone="ink3" weight="regular" style={[size, extra]}>
      {children}
    </Txt>
  );
  return (
    <Animated.View layout={settle} exiting={leave} style={styles.row}>
      <Pressable
        onPress={() => {
          tick();
          onPress();
        }}
        accessibilityRole="button"
        accessibilityLabel={`Also today: ${tasks.map((task) => task.title).join(", ")}. Show them`}
        style={({ pressed }) => [styles.slice, styles.bottom, styles.also, { backgroundColor: pressed ? colors.sunken : colors.card }]}
      >
        <View style={styles.flex} onLayout={(event: LayoutChangeEvent) => setColumn(event.nativeEvent.layout.width)}>
          {lines ? (
            lines.map((line, k) => (
              <Txt key={k} variant="subhead" tone="ink2" weight="semibold" numberOfLines={1} style={size}>
                {k === 0 ? LABEL : null}
                {regular(text(line, k === lines.length - 1))}
              </Txt>
            ))
          ) : (
            // Until the pieces are measured (a frame): the same words, wrapped by the text itself.
            <Txt variant="subhead" tone="ink2" weight="semibold" numberOfLines={2} style={size}>
              {LABEL}
              {regular(names.map((name, i) => name + (i < names.length - 1 ? END_DOT : "")).join(" "))}
            </Txt>
          )}
        </View>
        <View style={[styles.chevron, { marginTop: (size.lineHeight - 10) / 2 + CHEVRON_DROP }]}>
          <Icon name="down" size={10} color={colors.ink2} weight="bold" />
        </View>
        {/* The unseen pieces, each on one line, measured for the packing above. */}
        <View pointerEvents="none" aria-hidden accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.measure}>
          <Txt variant="subhead" weight="semibold" numberOfLines={1} style={[size, styles.piece1]} onLayout={note("label")}>
            {LABEL}
          </Txt>
          <View style={styles.piece1} onLayout={note("dot")}>
            {regular(END_DOT)}
          </View>
          <View style={styles.piece1} onLayout={note("gap")}>
            {regular(`${END_DOT}${NBSP}`)}
          </View>
          <View style={styles.piece1} onLayout={note("more")}>
            {regular(MORE)}
          </View>
          {names.map((name, i) => (
            <View key={`${key}#${i}`} style={styles.piece1} onLayout={note(`${key}#${i}`)}>
              {regular(name)}
            </View>
          ))}
        </View>
      </Pressable>
    </Animated.View>
  );
}

/** The day in plan order (timed first, by time; then the rest), on one card drawn as slices. */
function List({ tasks, renderRow, foldKey }: LookListProps) {
  const { colors } = useTheme();
  const ordered = useMemo(() => [...tasks].sort(byPlan), [tasks]);
  const fold = useDayFold(foldKey, ordered.length, FOLD_AT);
  const shown = fold.folded ? ordered.slice(0, FOLDED) : ordered;
  const rest = fold.folded ? ordered.slice(FOLDED) : [];
  const folding = rest.length > 0;

  // Unfolding: the rows that come in arrive 30 ms apart (once: then the stagger is forgotten).
  const arriving = useRef(new Map<string, ReturnType<typeof arriveAfter>>());
  const unfold = () => {
    rest.forEach((task, i) => arriving.current.set(task.id, arriveAfter(30 * i, duration.base)));
    fold.unfold();
  };
  useEffect(() => {
    if (!fold.folded && arriving.current.size) arriving.current.clear();
  });

  const lift = useMemo(() => {
    // The card's lift falls down and to the right, away from the margin, so the beads sit on clean paper.
    const tints = colors.cardShadow.match(/rgba?\([^)]*\)/g) ?? [];
    return tints.length >= 2 ? `1px 1px 2px ${tints[0]}, 3px 6px 14px -6px ${tints[1]}` : colors.cardShadow;
  }, [colors.cardShadow]);

  return (
    <Animated.View layout={settle}>
      {/* One card behind the slices, for the lift (light); each slice paints itself, so it swipes with its row. */}
      <View pointerEvents="none" style={[styles.backing, { backgroundColor: colors.card, boxShadow: lift }]} />
      {shown.map((task, i) => {
        const first = i === 0;
        const last = i === shown.length - 1 && !folding;
        return (
          <SliceContext.Provider key={task.id} value={{ first, last }}>
            {/* The swipe's tint follows the slice's corners. */}
            <RowPlace.Provider value={{ surface: "none", corners: first && last ? "all" : first ? "top" : last ? "bottom" : undefined, radius: radius.card }}>
              {renderRow(task, i, { entering: arriving.current.get(task.id) })}
            </RowPlace.Provider>
          </SliceContext.Provider>
        );
      })}
      {folding ? <AlsoToday tasks={rest} onPress={unfold} /> : null}
    </Animated.View>
  );
}

export const margin: Look = { id: "margin", label: "The margin", surface: "none", heading: "keep", actionsSurface: "quiet", rowInset: { left: CARD_LEFT, right: CARD_RIGHT }, Row, List };

const styles = StyleSheet.create({
  flex: { flex: 1 },
  backing: { position: "absolute", top: 0, bottom: 0, left: CARD_LEFT, right: CARD_RIGHT, borderRadius: radius.card, borderCurve: "continuous" },
  row: { flexDirection: "row" },
  line: { flexDirection: "row", alignItems: "flex-start" },
  // The margin column sits over the row's left 48 points; the slice fills the rest.
  margin: { position: "absolute", top: 0, bottom: 0, left: 0, width: CARD_LEFT },
  slice: { flex: 1, marginLeft: CARD_LEFT, marginRight: CARD_RIGHT, overflow: "hidden", borderCurve: "continuous" },
  bottom: { borderBottomLeftRadius: radius.card, borderBottomRightRadius: radius.card },
  // The time, at the right of the title's first line: 16 clear of the words, its figures all one width.
  time: { marginLeft: TIME_GAP },
  figures: { textAlign: "right", fontVariant: ["tabular-nums"] },
  glyph: { justifyContent: "center", marginLeft: 1 },
  inlineGlyph: { height: 11, justifyContent: "center" },
  endGlyphs: { position: "absolute", right: 0, flexDirection: "row", gap: 5 },
  target: { position: "absolute", left: TARGET_LEFT, width: TARGET, height: TARGET, minWidth: TARGET, minHeight: TARGET },
  bead: { width: BEAD, height: BEAD },
  // Inside CircleCheck's give (0.9), so it lands on its ring.
  firm: { position: "absolute", left: BEAD * 0.05, top: BEAD * 0.05, width: BEAD * 0.9, height: BEAD * 0.9, borderRadius: BEAD, borderWidth: RING_DRAWN * 0.9 },
  also: { flexDirection: "row", alignItems: "flex-start", minHeight: 48, paddingTop: ALSO_TOP, paddingBottom: ALSO_FOOT, paddingHorizontal: PAD_X },
  // The unseen pieces: off to the side, each its own width.
  measure: { position: "absolute", left: 0, top: 0, width: 2000, opacity: 0, alignItems: "flex-start" },
  piece1: { alignSelf: "flex-start" },
  chevron: { width: 12, height: 10, marginLeft: CHEVRON_COLUMN - 12, marginRight: -CHEVRON_HANG, alignItems: "flex-end", justifyContent: "center" },
  // A row on its own, as Sage draws it elsewhere.
  plainRow: { flexDirection: "row", alignItems: "center", gap: space[3], paddingLeft: pad, paddingRight: pad - 8, paddingVertical: 13, minHeight: 58 },
  plainWords: { flex: 1, gap: 3 },
  plainCheck: { width: TARGET, height: TARGET },
  meta: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", columnGap: 12, rowGap: 2 },
  piece: { flexDirection: "row", alignItems: "center", gap: 4, flexShrink: 1 },
});
