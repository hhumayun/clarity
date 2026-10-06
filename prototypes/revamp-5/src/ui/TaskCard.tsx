import React, { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import Animated, {
  FadeIn,
  FadeOut,
  LayoutAnimationConfig,
  LinearTransition,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import type { Task } from "../store/model";
import { useSage } from "../data/sage";
import { duration, easeOut, spring } from "../theme/motion";
import { useTheme } from "../theme/ThemeProvider";
import { edge, pad, radius, space } from "../theme/tokens";
import { Icon } from "./Icon";
import { TaskRow, type TaskVariant } from "./TaskRow";
import { Txt } from "./Txt";

const settle = LinearTransition.duration(duration.enter).easing(easeOut);
// Made once: a new builder each render would set the animation up again each time.
const leave = FadeOut.duration(duration.quick);
const arrive = FadeIn.duration(duration.base);

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
}: {
  tasks: Task[];
  variant?: TaskVariant;
  showArea?: boolean;
  noteId?: string;
  highlightId?: string | null;
  /** Said inside the card when there are no tasks; without it an empty list draws nothing. */
  empty?: React.ReactNode;
  quiet?: boolean;
}) {
  const { colors } = useTheme();
  const lastAdded = useSage((state) => state.lastAdded);
  if (tasks.length === 0 && !empty) return null;
  return (
    <Animated.View layout={quiet ? undefined : settle} style={[styles.card, { backgroundColor: colors.card, boxShadow: colors.cardShadow }]}>
      <LayoutAnimationConfig skipEntering>
        {tasks.map((task, i) => (
          <Animated.View key={task.id} layout={quiet ? undefined : settle} entering={quiet ? undefined : arrive} exiting={quiet ? undefined : leave}>
            {i > 0 ? <View style={[styles.rule, { backgroundColor: colors.hairline }]} /> : null}
            <TaskRow task={task} variant={variant} showArea={showArea} noteId={noteId} highlight={task.id === (highlightId ?? lastAdded)} />
          </Animated.View>
        ))}
      </LayoutAnimationConfig>
      {tasks.length === 0 ? (
        <Animated.View entering={FadeIn.duration(duration.enter)} style={styles.empty}>
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
}: {
  task: Task;
  variant: TaskVariant;
  first: boolean;
  last: boolean;
  showArea: boolean;
  quiet?: boolean;
}) {
  const { colors } = useTheme();
  const highlight = useSage((state) => state.lastAdded === task.id);
  return (
    <Animated.View exiting={quiet ? undefined : leave} style={[styles.sliceClip, first && styles.sliceFirst, last && styles.sliceLast]}>
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
export function DoneFold({ tasks, label = "Done", showArea = true, onClear, quiet = false, scope = "" }: { tasks: Task[]; label?: string; showArea?: boolean; onClear?: () => void; quiet?: boolean; scope?: string }) {
  const { colors } = useTheme();
  const reduced = useReducedMotion();
  const [open, setOpen] = useState(false);
  const bump = useSharedValue(1);
  const turn = useSharedValue(0);
  const before = useRef({ count: tasks.length, scope });
  useEffect(() => {
    const arrived = tasks.length > before.current.count && scope === before.current.scope;
    if (arrived && !reduced) {
      bump.value = withSequence(withTiming(1.14, { duration: 140, easing: easeOut }), withSpring(1, spring.pop));
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
    <Animated.View layout={quiet ? undefined : settle} entering={FadeIn.duration(duration.base)}>
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
          <Animated.View entering={FadeIn.duration(duration.base)} exiting={FadeOut.duration(duration.quick)} style={styles.clear}>
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
        <Animated.View entering={FadeIn.duration(duration.base)} exiting={FadeOut.duration(duration.quick)}>
          <TaskCard tasks={tasks} showArea={showArea} quiet={quiet} />
        </Animated.View>
      ) : null}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: { marginHorizontal: edge, borderRadius: radius.card, borderCurve: "continuous", overflow: "hidden" },
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
