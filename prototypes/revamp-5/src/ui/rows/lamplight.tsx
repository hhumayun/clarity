import React, { useContext, useEffect, useRef, useState } from "react";
import { Platform, Pressable, StyleSheet, Text, View, type LayoutChangeEvent } from "react-native";
import Animated, { LayoutAnimationConfig, useAnimatedStyle, withTiming } from "react-native-reanimated";
import { arriveAfter, fadeTiming, leave, riseInAfter, settle } from "../../theme/motion";
import { useTheme } from "../../theme/ThemeProvider";
import { clockLabel } from "../../store/selectors";
import { edge, face, pad, radius } from "../../theme/tokens";
import { tick } from "../haptics";
import { Icon, type IconName } from "../Icon";
import { Txt, useType } from "../Txt";
import { useDayFold } from "./fold";
import { RowPlace } from "./place";
import type { Look, LookListProps, LookRowProps } from "./types";

/*
 * Lamplight (round 3, 2026-10-08). Only the task you're on sits in the light:
 * Sage's brightest card, with its time, one line of context and the full
 * check. The rest of the day waits beneath it on a quieter tray, the same
 * size, only softer. Tick the lit task and the next one rises into the
 * light: the card never moves, only what's in it. It leads by light, never by
 * size: every title is the same 17/23 Regular.
 *
 * Small marks (a reminder, a repeat, not sent yet) follow a task's words
 * wherever it sits, glued to its last word so a glyph never wraps alone; a
 * time has its own place (under the lit title; a column by the tray's rings).
 */

/** Every row's right edge: the check's 44-point box sits this far in, so all checks share one axis (30 from the card's edge). */
const RIGHT = 8;
const CHECK_BOX = 44;
/** The tray tucks this far under the lit card, and shows this much of itself above its first line. */
const TUCK = 20;
const TRAY_TOP = 6;
const TRAY_BOTTOM = 6;
/** A tray row: 48 points from one to the next with a single line. */
const TRAY_PAD = 12.5;
const LIT_PAD = 16;
/** The tray holds up to six lines: past six waiting tasks, five of them and "Also today" naming the rest (always two or more). */
const TRAY_LINES = 6;
const FOLDED_LINES = 5;
/** The marks' size: a little under the time's cap height, so they read as marks, not words. */
const GLYPH = 11;
const NBSP = "\u00A0";

// Made once (a builder changes in place): the next task rising into the light 120 ms after the
// last one's words start to go, and its details following its title by 60 ms.
// (The web build can't run a builder with initial values: there it fades in, as under Reduce Motion.)
const intoTheLight = Platform.OS === "web" ? arriveAfter(120, 300) : riseInAfter(120, 300);
const detailsAfter = arriveAfter(180, 300);
// Unfolding "Also today": the named tasks arrive one after another, 30 ms apart.
const unfoldIn = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => arriveAfter(i * 30));

/** A colour laid over another at `alpha` (#rrggbb), so a softer ink stays one flat colour (no layer to fade). */
function over(top: string, under: string, alpha: number) {
  const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const [a, b] = [rgb(top), rgb(under)];
  return `#${a.map((v, i) => Math.round(v * alpha + b[i] * (1 - alpha)).toString(16).padStart(2, "0")).join("")}`;
}

/**
 * Where a line box's baseline sits, from its top, as iOS sets it (Nunito Sans: ascender 1.011,
 * descender 0.353 of the size; React Native centres the text in a taller line, and bottom-aligns it
 * in a shorter one).
 */
function baselineOf(type: { fontSize: number; lineHeight: number }) {
  const natural = type.fontSize * 1.364;
  return type.lineHeight >= natural ? (type.lineHeight - natural) / 2 + type.fontSize * 1.011 : type.lineHeight - type.fontSize * 0.353;
}
/** A smaller line set beside a bigger one, on its baseline. The web build's text sits a point higher in a small line (measured), so it's nudged there. */
function baselineGap(big: { fontSize: number; lineHeight: number }, small: { fontSize: number; lineHeight: number }) {
  return baselineOf(big) - baselineOf(small) + (Platform.OS === "web" ? 1 : 0);
}

/** The last two words held together, so a wrapped line never ends on one word alone. */
function unorphaned(text: string) {
  const words = text.trim().split(/ +/);
  if (words.length < 3 || words.slice(-2).join(" ").length > 22) return text;
  return `${words.slice(0, -1).join(" ")}${NBSP}${words[words.length - 1]}`;
}

/** The marks a task carries, as small glyphs, each with what it says for VoiceOver. */
function marksOf(task: LookRowProps["task"], unsent: boolean): { key: string; icon: IconName; label: string }[] {
  if (task.done) return [];
  const marks: { key: string; icon: IconName; label: string }[] = [];
  if (task.remind !== null) marks.push({ key: "remind", icon: "bell", label: "reminds you" });
  if (task.repeat) marks.push({ key: "repeat", icon: "repeat", label: "repeats" });
  if (unsent) marks.push({ key: "unsent", icon: "cloudUp", label: "not sent yet" });
  return marks;
}

/** While a tick's beat plays, what's said about the task steps back with its struck words. */
function useStepBack(fading: boolean) {
  return useAnimatedStyle(() => ({ opacity: withTiming(fading ? 0.45 : 1, fadeTiming(220)) }), [fading]);
}

/**
 * The marks as the title's tail, joined to its last word so a glyph never
 * starts a line, sitting on the baseline 4 points after it, 3 apart.
 * On the phone: a no-break space, then the glyphs as one inline group (text
 * layout won't break after a no-break space). The web build breaks before any
 * inline box, so there the no-break space is stretched to the glyphs' width
 * (it wraps with the word) and a box of no width draws them over it.
 */
const LEAD = 4;
const BETWEEN = 3;
const NBSP_EM = 0.257; // Nunito Sans's (no-break) space
/** file-text's left stroke sits this far into its box. */
const DOC_PULL = 1.3;
function Tail({ marks, color, fade, fontSize }: { marks: ReturnType<typeof marksOf>; color: string; fade: ReturnType<typeof useStepBack>; fontSize: number }) {
  const glyphs = marks.map((mark) => <Icon key={mark.key} name={mark.icon} size={GLYPH} color={color} weight="semibold" />);
  const width = marks.length * GLYPH + (marks.length - 1) * BETWEEN;
  const lead = LEAD - NBSP_EM * fontSize;
  if (Platform.OS === "web") {
    return (
      <>
        <Text style={{ letterSpacing: lead + width }}>{NBSP}</Text>
        <Animated.View importantForAccessibility="no-hide-descendants" accessibilityElementsHidden style={[styles.tailAnchor, fade]}>
          <View style={[styles.tail, styles.tailOver]}>{glyphs}</View>
        </Animated.View>
      </>
    );
  }
  return (
    <>
      <Text style={{ letterSpacing: lead }}>{NBSP}</Text>
      <Animated.View importantForAccessibility="no-hide-descendants" accessibilityElementsHidden style={[styles.tail, fade]}>
        {glyphs}
      </Animated.View>
    </>
  );
}

function Row(props: LookRowProps) {
  const place = useContext(RowPlace);
  return place?.surface === "lit" ? <LitRow {...props} /> : <TrayRow {...props} />;
}

/** The task you're on: its words (and marks), then one grey line: its time, and where you left off or the note it's from. The full-strength (plain) ring. */
function LitRow({ task, checked, leftOff, unsent, noteTitle, title, check, open }: LookRowProps) {
  const { colors, dark } = useTheme();
  const row = useType("row");
  const sub = useType("subhead");
  const marks = marksOf(task, unsent);
  const time = task.time !== null && !task.done ? clockLabel(task.time) : null;
  // The context: where a focus session left off, or else the note it came from.
  const context = task.done ? null : leftOff ? "leftOff" : noteTitle ? "note" : null;
  const fade = useStepBack(checked && !task.done);
  // The details line, 14/19, from the ramp (so "Larger text" grows it too).
  const small = { fontSize: sub.fontSize - 1, lineHeight: sub.lineHeight - 1 };
  // VoiceOver: "Next: <title>, 12:30 pm, From Slow morning, reminds you".
  const said = ["Next: " + task.title, time, context === "leftOff" ? `you left off: ${leftOff}` : context === "note" ? `From ${noteTitle}` : null, ...marks.map((mark) => mark.label)].filter(Boolean).join(", ");
  // "12:30 pm · ": the dot held to the time by a no-break space.
  const lead = time ? `${time}${NBSP}·` : null;
  let details: React.ReactNode = null;
  if (context === "leftOff") {
    details = (
      <Txt variant="subhead" tone="ink3" numberOfLines={2} style={small}>
        {lead ? <Text style={styles.tabular}>{`${lead} `}</Text> : null}
        <Text style={{ fontFamily: face.italic, color: colors.ink2 }}>{unorphaned(leftOff ?? "")}</Text>
      </Txt>
    );
  } else if (context === "note") {
    details = (
      <View style={styles.from}>
        {lead ? (
          <Txt variant="subhead" tone="ink3" style={[small, styles.tabular]}>
            {lead}
          </Txt>
        ) : null}
        {/* The glyph's ink, not its box, a space after the dot (or on the words' edge). */}
        <View style={[styles.docGlyph, { height: small.lineHeight, marginLeft: (lead ? NBSP_EM * small.fontSize : 0) - DOC_PULL }]}>
          <Icon name="doc" size={GLYPH} color={colors.ink3} weight="semibold" />
        </View>
        <Txt variant="subhead" tone="ink3" numberOfLines={1} style={[small, styles.flexShrink]}>
          {`From ${noteTitle}`}
        </Txt>
      </View>
    );
  } else if (time) {
    details = (
      <Txt variant="subhead" tone="ink3" style={[small, styles.tabular]}>
        {time}
      </Txt>
    );
  }
  const words = (
    <>
      {title({ variant: "row", weight: "regular", color: dark ? colors.soft : colors.ink, numberOfLines: 3, suffix: marks.length ? <Tail marks={marks} color={colors.ink3} fade={fade} fontSize={row.fontSize} /> : null })}
      {details ? (
        <Animated.View entering={detailsAfter}>
          <Animated.View style={[styles.details, fade]}>{details}</Animated.View>
        </Animated.View>
      ) : null}
    </>
  );
  return (
    <View style={styles.row}>
      {open(words, styles.litWords, { accessibilityLabel: said })}
      {/* The one full-strength ring on Today: 28, ink2, 1.75, empty at rest (no faint check: an open task never looks done). */}
      {check({ size: 28, quiet: true, ringColor: colors.ink2, ringWidth: 1.75, style: [styles.check, styles.litCheck, { marginTop: LIT_PAD + row.lineHeight / 2 - CHECK_BOX / 2 }] })}
    </View>
  );
}

/** A task waiting its turn: the same words, softer, its marks after them; its time in a column by a quiet ring. */
function TrayRow({ task, variant, checked, unsent, title, check, open }: LookRowProps) {
  const { colors, dark } = useTheme();
  const row = useType("row");
  const foot = useType("footnote");
  const marks = marksOf(task, unsent);
  const time = task.time !== null && !task.done ? clockLabel(task.time) : null;
  const fade = useStepBack(checked && !task.done);
  // Today: ink2, and in dark ink2 at 88% over the tray, so the lit title is plainly the one bright line.
  // Another day has nothing lit: its lines are the list, in the title ink (the gentler ink2 in dark, so nine lines don't glare).
  const ink = variant === "day" ? (dark ? colors.ink2 : colors.soft) : dark ? over(colors.ink2, colors.quiet, 0.88) : colors.ink2;
  const said = [task.title, time, ...marks.map((mark) => mark.label)].filter(Boolean).join(", ");
  const words = (
    <>
      <View style={styles.flex}>{title({ variant: "row", weight: "regular", color: ink, numberOfLines: 2, suffix: marks.length ? <Tail marks={marks} color={colors.ink3} fade={fade} fontSize={row.fontSize} /> : null })}</View>
      {time ? (
        // On the title's baseline, not centred on its line.
        <Animated.View style={[styles.trayTime, { marginTop: baselineGap(row, foot) }, fade]}>
          <Txt variant="footnote" tone="ink3" style={styles.tabular}>
            {time}
          </Txt>
        </Animated.View>
      ) : null}
    </>
  );
  return (
    <View style={styles.row}>
      {open(words, styles.trayWords, { accessibilityLabel: said })}
      {check({ size: 18, quiet: true, ringColor: colors.ringQuiet, ringWidth: 1.25, hitSlop: 2, style: [styles.check, { marginTop: TRAY_PAD + row.lineHeight / 2 - CHECK_BOX / 2 }] })}
    </View>
  );
}

/**
 * litShadow's tint as a short, soft lift: a hairline of contact and a close
 * 2/8 shadow, so the card stands off the tray without dirtying the tray just
 * under its edge (dark has none).
 */
function liftOf(shadow: string, dark: boolean) {
  const tint = dark ? null : shadow.match(/rgba\((\d+),\s*(\d+),\s*(\d+)/);
  return tint ? `0px 1px 2px rgba(${tint[1]}, ${tint[2]}, ${tint[3]}, 0.05), 0px 2px 8px rgba(${tint[1]}, ${tint[2]}, ${tint[3]}, 0.05)` : shadow;
}

/** Today: the lit card over the quiet tray. Another day: nothing lit, every line on the tray alone. */
function List({ tasks, variant, renderRow, foldKey }: LookListProps) {
  const { colors, dark } = useTheme();
  const fold = useDayFold(foldKey, tasks.length - 1, TRAY_LINES);
  // Just unfolded: the named tasks arrive one after another.
  const [opening, setOpening] = useState(false);
  const opened = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => void (opened.current && clearTimeout(opened.current)), []);
  const show = () => {
    setOpening(true);
    fold.unfold();
    opened.current = setTimeout(() => setOpening(false), 900);
  };

  // Drawn still the first time (opening the app, coming back to Today): "the light moves on" plays only when it does.
  if (variant !== "today") {
    return (
      <LayoutAnimationConfig skipEntering>
        <Animated.View layout={settle} style={[styles.dayTray, { backgroundColor: colors.quiet }]}>
          <RowPlace.Provider value={PLACE_QUIET}>{tasks.map((task, i) => renderRow(task, i))}</RowPlace.Provider>
        </Animated.View>
      </LayoutAnimationConfig>
    );
  }

  const [first, ...rest] = tasks;
  const shown = fold.folded ? rest.slice(0, FOLDED_LINES) : rest;
  const others = fold.folded ? rest.slice(FOLDED_LINES) : [];
  return (
    <LayoutAnimationConfig skipEntering>
      {/* The lit card: the shadow outside, the clip inside (iOS clips a shadow drawn on a clipping view). It never moves on a tick; only what's in it changes. */}
      <Animated.View layout={settle} style={[styles.lit, { backgroundColor: colors.lit, boxShadow: liftOf(colors.litShadow, dark) }]}>
        <View style={[styles.litClip, { backgroundColor: colors.lit }]}>
          <RowPlace.Provider value={PLACE_LIT}>
            {renderRow(first, 0, { entering: intoTheLight })}
          </RowPlace.Provider>
        </View>
      </Animated.View>
      {rest.length ? (
        <Animated.View layout={settle} exiting={leave} style={[styles.tray, { backgroundColor: colors.quiet }]}>
          <RowPlace.Provider value={PLACE_QUIET}>
            {shown.map((task, i) => renderRow(task, i + 1, opening && i >= FOLDED_LINES ? { entering: unfoldIn[Math.min(i - FOLDED_LINES, unfoldIn.length - 1)] } : undefined))}
            {others.length ? <AlsoToday tasks={others} onPress={show} /> : null}
          </RowPlace.Provider>
        </Animated.View>
      ) : null}
    </LayoutAnimationConfig>
  );
}
const PLACE_LIT = { surface: "lit" as const };
const PLACE_QUIET = { surface: "quiet" as const };

/**
 * The tray's last line on a long day: "Also today" and the rest by name, as a
 * list ("A · B · C", or "A · B · and more"; never a count). Each name is a
 * unit: its spaces don't break, so it never splits across lines, and it is
 * never cut. How many fit two lines is found by measuring a hidden copy and
 * dropping whole names from the end. VoiceOver hears every name.
 */
function AlsoToday({ tasks, onPress }: { tasks: LookListProps["tasks"]; onPress: () => void }) {
  const { colors } = useTheme();
  const sub = useType("subhead");
  const row = useType("row");
  const size = { fontSize: sub.fontSize - 1, lineHeight: sub.lineHeight };
  const LINES = 2;
  // Its first line on the tray's 48-point pitch, like a one-line row's.
  const inset = TRAY_PAD + (row.lineHeight - size.lineHeight) / 2;
  const names = tasks.map((task) => task.title);
  // Only a name longer than most of a line may break between its words.
  const [width, setWidth] = useState(0);
  const perLine = width ? width / (size.fontSize * 0.5) : 40;
  const units = names.map((name) => (name.length < perLine * 0.85 ? name.replace(/ /g, NBSP) : name));
  // The set's form: "A · B", or "A · B · and more" (the dot held to the name before it).
  const sentence = (count: number) => units.slice(0, count).join(`${NBSP}· `) + (count < units.length ? `${NBSP}· and${NBSP}more` : "");
  const key = `${names.join("\n")}|${size.fontSize}|${Math.round(width)}`;
  const [fit, setFit] = useState({ key, count: names.length, done: false });
  const current = fit.key === key ? fit : { key, count: names.length, done: false };
  const measured = (event: LayoutChangeEvent) => {
    const taken = Math.round(event.nativeEvent.layout.height / size.lineHeight);
    if (taken > LINES && current.count > 1) setFit({ key, count: current.count - 1, done: false });
    else setFit({ key, count: current.count, done: true });
  };
  const words = (count: number) => (
    <>
      <Text style={{ fontFamily: face.semibold, color: colors.ink2 }}>{`Also${NBSP}today`}</Text>
      {/* An en space after the run-in. */}
      {`\u2002${sentence(count)}`}
    </>
  );
  return (
    <Animated.View layout={settle} exiting={leave}>
      <Pressable
        onPress={() => {
          tick();
          onPress();
        }}
        accessibilityRole="button"
        accessibilityLabel={`Also today: ${names.join(", ")}. Show them`}
        // The rows' own press: a wash of sunken (the tray's clip rounds its corners).
        style={({ pressed }) => [styles.also, { paddingTop: inset, paddingBottom: inset }, pressed ? { backgroundColor: colors.sunken } : null]}
      >
        <View style={styles.flex} onLayout={(event) => setWidth(event.nativeEvent.layout.width)}>
          <Txt variant="subhead" tone="ink3" numberOfLines={LINES} style={[size, { opacity: current.done ? 1 : 0 }]}>
            {words(current.count)}
          </Txt>
          {current.done ? null : (
            <Txt
              key={`${key}|${current.count}`}
              variant="subhead"
              tone="ink3"
              onLayout={measured}
              aria-hidden
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
              style={[size, styles.measure]}
            >
              {words(current.count)}
            </Txt>
          )}
        </View>
        <View style={[styles.chevron, { height: size.lineHeight }]}>
          <Icon name="down" size={12} color={colors.ink3} weight="medium" />
        </View>
      </Pressable>
    </Animated.View>
  );
}

// Add task, Catch up / All tasks and Done step back onto the quiet surface: the lit card is the only lit thing on Today.
export const lamplight: Look = { id: "lamplight", label: "Lamplight", surface: "card", heading: "keep", actionsSurface: "quiet", Row, List };

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "flex-start", paddingRight: RIGHT },
  flex: { flex: 1 },
  flexShrink: { flexShrink: 1 },
  // Read, not seen: a 1-point clip with clear ink (VoiceOver still reads it; nothing shows).
  tabular: { fontVariant: ["tabular-nums"] },
  tail: { flexDirection: "row", gap: BETWEEN, height: GLYPH },
  tailAnchor: { width: 0, height: GLYPH },
  tailOver: { position: "absolute", right: 0, top: 0 },
  check: { width: CHECK_BOX, height: CHECK_BOX },
  // The lit row: 16 all round but the check's side.
  litWords: { flex: 1, paddingTop: LIT_PAD, paddingBottom: LIT_PAD, paddingLeft: pad },
  litCheck: { marginLeft: 10 },
  details: { marginTop: 3 },
  from: { flexDirection: "row", alignItems: "flex-start" },
  docGlyph: { justifyContent: "center", marginRight: 4 },
  // A tray row: the words open it; the ring is on the lit check's axis, the time 10 points before it (reaching 3 into its box), at least 10 after the words.
  trayWords: { flex: 1, flexDirection: "row", alignItems: "flex-start", paddingTop: TRAY_PAD, paddingBottom: TRAY_PAD, paddingLeft: pad },
  trayTime: { marginLeft: 10, marginRight: -3 },
  // The two surfaces, one width.
  lit: { marginHorizontal: edge, borderRadius: radius.card, borderCurve: "continuous", zIndex: 1 },
  litClip: { borderRadius: radius.card, borderCurve: "continuous", overflow: "hidden" },
  tray: { marginHorizontal: edge, marginTop: -TUCK, paddingTop: TUCK + TRAY_TOP, paddingBottom: TRAY_BOTTOM, borderRadius: radius.card, borderCurve: "continuous", overflow: "hidden" },
  dayTray: { marginHorizontal: edge, paddingTop: TRAY_TOP, paddingBottom: TRAY_BOTTOM, borderRadius: radius.card, borderCurve: "continuous", overflow: "hidden" },
  also: { flexDirection: "row", alignItems: "flex-start", minHeight: 48, paddingLeft: pad, paddingRight: RIGHT },
  measure: { position: "absolute", left: 0, right: 0, top: 0, opacity: 0 },
  chevron: { width: CHECK_BOX, alignItems: "center", justifyContent: "center" },
});
