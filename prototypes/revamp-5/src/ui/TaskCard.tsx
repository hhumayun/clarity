import React, { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import Animated, { LayoutAnimationConfig, useAnimatedStyle, useReducedMotion, useSharedValue, withSequence, withSpring, withTiming } from "react-native-reanimated";
import type { Task } from "../store/model";
import { useSage } from "../data/sage";
import { arrive, arriveSlow, duration, easeOut, leave, settle, spring } from "../theme/motion";
import { useTheme } from "../theme/ThemeProvider";
import { edge, pad, radius, space } from "../theme/tokens";
import { tick } from "./haptics";
import { Icon } from "./Icon";
import { calmRows, rowLook } from "./rowLook";
import { TaskRow, TIME_COLUMN, type TaskVariant } from "./TaskRow";
import { Txt } from "./Txt";

// In the calmer looks, Today shows this many, then "The rest of today" (no count); unfolded, it stays so for the day.
const FOLD_AT = 5;
const unfoldedDays = new Set<string>();

/** The day in order, for the "sequence" look: tasks with a time first, earliest first, then the rest as they were. */
function byTime(tasks: Task[]): Task[] {
  const timed = tasks.filter((task) => task.time !== null).sort((a, b) => (a.time ?? 0) - (b.time ?? 0));
  return [...timed, ...tasks.filter((task) => task.time === null)];
}

// The presets (arrive, leave, settle) are made once: a new builder each render would set the animation up again each time.

/**
 * Tasks on one card, a hairline between rows. A row that leaves fades while
 * the rows under it close the gap and the card shrinks to fit; a row that
 * arrives fades in where it lands. The first render doesn't animate, nor
 * does a quiet change (an area chosen, see useQuietFilter).
 */
export function TaskCard({
  tasks,
  variant = "list",
  showArea = true,
  noteId,
  highlightId,
  empty,
  quiet = false,
  foldKey,
}: {
  tasks: Task[];
  variant?: TaskVariant;
  showArea?: boolean;
  noteId?: string;
  highlightId?: string | null;
  /** Said inside the card when there are no tasks; without it an empty list draws nothing. */
  empty?: React.ReactNode;
  quiet?: boolean;
  /** Today's day: in the calmer looks, the list folds after five, and unfolded stays so for this day. */
  foldKey?: string;
}) {
  const { colors } = useTheme();
  const lastAdded = useSage((state) => state.lastAdded);
  const calm = calmRows(variant);
  const journal = calm && rowLook === "journal";
  const [unfolded, setUnfolded] = useState(() => (foldKey ? unfoldedDays.has(foldKey) : false));
  if (tasks.length === 0 && !empty) return null;
  const ordered = calm && rowLook === "sequence" ? byTime(tasks) : tasks;
  const folded = calm && variant === "today" && !!foldKey && !unfolded && ordered.length > FOLD_AT;
  const shown = folded ? ordered.slice(0, FOLD_AT) : ordered;
  // Hairlines start where the words do (in the calmer looks), and on the page they're a touch firmer.
  const rule = [styles.rule, { backgroundColor: journal ? colors.line : colors.hairline }, calm && rowLook === "card" ? { marginLeft: pad } : calm && rowLook === "sequence" ? { marginLeft: pad + TIME_COLUMN + space[2] } : null];
  return (
    <Animated.View layout={quiet ? undefined : settle} style={journal ? styles.sheet : [styles.card, { backgroundColor: colors.card, boxShadow: colors.cardShadow }]}>
      <LayoutAnimationConfig skipEntering>
        {shown.map((task, i) => (
          <Animated.View key={task.id} layout={quiet ? undefined : settle} entering={quiet ? undefined : arrive} exiting={quiet ? undefined : leave}>
            {i > 0 ? <View style={rule} /> : null}
            <TaskRow task={task} variant={variant} showArea={showArea} noteId={noteId} highlight={task.id === (highlightId ?? lastAdded)} />
          </Animated.View>
        ))}
      </LayoutAnimationConfig>
      {folded ? (
        <Animated.View layout={settle} exiting={leave}>
          <View style={rule} />
          <Pressable
            onPress={() => {
              tick();
              if (foldKey) unfoldedDays.add(foldKey);
              setUnfolded(true);
            }}
            accessibilityRole="button"
            accessibilityLabel="Show the rest of today"
            style={({ pressed }) => [styles.more, journal && styles.moreOnPage, { opacity: pressed ? 0.55 : 1 }]}
          >
            <Txt variant="footnote" tone="ink2" weight="semibold">
              The rest of today
            </Txt>
            <Icon name="down" size={11} color={colors.ink2} weight="bold" />
          </Pressable>
        </Animated.View>
      ) : null}
      {tasks.length === 0 ? (
        <Animated.View entering={arriveSlow} exiting={leave} style={styles.empty}>
          {typeof empty === "string" ? (
            <Txt variant="subhead" tone="ink3" center>
              {empty}
            </Txt>
          ) : (
            empty
          )}
        </Animated.View>
      ) : null}
    </Animated.View>
  );
}

// How far a slice's card reaches past its clip above and below, so the shadow
// down its sides runs on into the next slice with no seam; and the room kept
// for the shadow above the first slice and below the last.
const REACH = 32;
const SHADOW_ROOM = 20;

/**
 * One task as a slice of a card, for long lists drawn as they scroll (Life):
 * each row is its own item, and the slices together look like one card. Each
 * slice's card reaches past its clip above and below (except where the real
 * card starts and ends), so its side shadow never thins at a join; the first
 * and last slices carry the corners. A row that leaves fades out, unless
 * the list is changing quietly (an area chosen, see useQuietFilter).
 */
export const TaskSlice = React.memo(function TaskSlice({
  task,
  variant,
  first,
  last,
  showArea,
  quiet = false,
  fresh = false,
}: {
  task: Task;
  variant: TaskVariant;
  first: boolean;
  last: boolean;
  showArea: boolean;
  quiet?: boolean;
  /** New to the list (unticked, added, back from elsewhere): it fades in where it lands. */
  fresh?: boolean;
}) {
  const { colors } = useTheme();
  const highlight = useSage((state) => state.lastAdded === task.id);
  // Leaving, it fades while the rows below close up. In the web build a fading list row holds its
  // place for a frame, so the rows below dropped by a row before gliding up: there it simply goes.
  const fadeOut = quiet || process.env.EXPO_OS === "web" ? undefined : leave;
  return (
    <Animated.View entering={fresh && !quiet ? arrive : undefined} exiting={fadeOut} style={[styles.sliceClip, first && styles.sliceFirst, last && styles.sliceLast]}>
      <View style={[styles.sliceCard, { backgroundColor: colors.card, boxShadow: colors.cardShadow }, first ? styles.cardTop : styles.reachUp, last ? styles.cardBottom : styles.reachDown]}>
        {first ? null : <View style={[styles.rule, { backgroundColor: colors.hairline }]} />}
        <TaskRow task={task} variant={variant} showArea={showArea} highlight={highlight} />
      </View>
    </Animated.View>
  );
});

/**
 * What's been finished, folded under a small centred "Done": no count, a
 * check and a chevron. When a task arrives here the word gives a small
 * bump, so you can see where it went. A filter changing what it holds
 * (`scope`) isn't a task arriving: no bump, and while the list changes
 * quietly (`quiet`) it doesn't slide into its new place either.
 */
export function DoneFold({
  tasks,
  label = "Done",
  showArea = true,
  onClear,
  quiet = false,
  scope = "",
  inList = false,
  open: openGiven,
  onOpen,
}: {
  tasks: Task[];
  label?: string;
  showArea?: boolean;
  onClear?: () => void;
  quiet?: boolean;
  scope?: string;
  inList?: boolean;
  /** Open or folded, kept by the page (so what follows on it moves as it opens); otherwise kept here. */
  open?: boolean;
  onOpen?: (open: boolean) => void;
}) {
  const { colors } = useTheme();
  const reduced = useReducedMotion();
  const [openHere, setOpenHere] = useState(false);
  const open = openGiven ?? openHere;
  const setOpen = (next: (was: boolean) => boolean) => (onOpen ? onOpen(next(open)) : setOpenHere(next));
  const bump = useSharedValue(1);
  const turn = useSharedValue(0);
  const before = useRef({ count: tasks.length, scope });
  useEffect(() => {
    const arrived = tasks.length > before.current.count && scope === before.current.scope;
    if (arrived && !reduced) {
      bump.value = withSequence(withTiming(1.14, { duration: duration.bump, easing: easeOut }), withSpring(1, spring.pop));
    }
    before.current = { count: tasks.length, scope };
  }, [tasks.length, scope, bump, reduced]);
  useEffect(() => {
    turn.value = withTiming(open ? 1 : 0, { duration: duration.base, easing: easeOut });
  }, [open, turn]);
  const bumpStyle = useAnimatedStyle(() => ({ transform: [{ scale: bump.value }] }));
  const chevron = useAnimatedStyle(() => ({ transform: [{ rotate: `${turn.value * 180}deg` }] }));
  if (tasks.length === 0) return null;
  return (
    // Emptied (the last finished task unticked or cleared): it fades, rather than cutting out beside rows that do.
    // A row of a list (`inList`) is moved by the list: a second movement of its own would double it.
    <Animated.View layout={quiet || inList ? undefined : settle} entering={arrive} exiting={leave}>
      <View style={styles.foldHead}>
        <Pressable onPress={() => setOpen((v) => !v)} accessibilityRole="button" accessibilityLabel={open ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`} aria-expanded={open} hitSlop={10}>
          {({ pressed }) => (
            <Animated.View style={[styles.foldToggle, { backgroundColor: colors.card, opacity: pressed ? 0.6 : 1 }, bumpStyle]}>
              <Icon name="checkCircle" size={15} color={colors.ink2} weight="semibold" />
              <Txt variant="footnote" tone="ink2" weight="semibold">
                {label}
              </Txt>
              <Animated.View style={chevron}>
                <Icon name="down" size={12} color={colors.ink2} weight="bold" />
              </Animated.View>
            </Animated.View>
          )}
        </Pressable>
        {open && onClear ? (
          <Animated.View entering={arrive} exiting={leave} style={styles.clear}>
            <Pressable onPress={onClear} accessibilityRole="button" accessibilityLabel="Clear finished tasks" hitSlop={10}>
              {({ pressed }) => (
                <View style={[styles.foldToggle, { backgroundColor: colors.card, opacity: pressed ? 0.6 : 1 }]}>
                  <Icon name="trash" size={14} color={colors.ink2} weight="semibold" />
                  <Txt variant="footnote" tone="ink2" weight="semibold">
                    Clear
                  </Txt>
                </View>
              )}
            </Pressable>
          </Animated.View>
        ) : null}
      </View>
      {open ? (
        <Animated.View entering={arrive} exiting={leave}>
          <TaskCard tasks={tasks} showArea={showArea} quiet={quiet} />
        </Animated.View>
      ) : null}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: { marginHorizontal: edge, borderRadius: radius.card, borderCurve: "continuous", overflow: "hidden" },
  sheet: { marginHorizontal: edge + 4 },
  more: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, height: 46 },
  moreOnPage: { justifyContent: "flex-start", paddingLeft: 20 + space[3] },
  sliceClip: { overflow: "hidden", paddingHorizontal: edge },
  sliceFirst: { paddingTop: SHADOW_ROOM, marginTop: -SHADOW_ROOM },
  sliceLast: { paddingBottom: SHADOW_ROOM, marginBottom: -SHADOW_ROOM },
  sliceCard: { borderCurve: "continuous", overflow: "hidden" },
  reachUp: { marginTop: -REACH, paddingTop: REACH },
  reachDown: { marginBottom: -REACH, paddingBottom: REACH },
  cardTop: { borderTopLeftRadius: radius.card, borderTopRightRadius: radius.card },
  cardBottom: { borderBottomLeftRadius: radius.card, borderBottomRightRadius: radius.card },
  rule: { height: 1 },
  empty: { paddingHorizontal: pad, paddingVertical: space[6], alignItems: "center", gap: space[3] },
  foldHead: { flexDirection: "row", justifyContent: "center", alignItems: "center", gap: space[2], paddingTop: space[4], paddingBottom: space[3] },
  foldToggle: { flexDirection: "row", alignItems: "center", gap: 6, height: 32, paddingHorizontal: 14, borderRadius: radius.pill, borderCurve: "continuous" },
  clear: {},
});
