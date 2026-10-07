import { useRouter, useScrollToTop } from "expo-router";
import React, { useCallback, useEffect, useMemo, useRef } from "react";
import { StyleSheet, View, type ListRenderItem } from "react-native";
import Animated, { useAnimatedRef } from "react-native-reanimated";
import type { Task } from "../../src/store/model";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Sprout } from "../../src/art/Pictures";
import { groupTasks } from "../../src/store/selectors";
import { useSage, useSageStatus } from "../../src/data/sage";
import { LoadProblem, SkeletonCards, usePullToRefresh } from "../../src/ui/Loading";
import { arriveSlow, leave, settle } from "../../src/theme/motion";
import { useTheme } from "../../src/theme/ThemeProvider";
import { edge, pad, radius, space } from "../../src/theme/tokens";
import { useAcknowledge } from "../../src/ui/Acknowledgement";
import { Button } from "../../src/ui/Button";
import { Card } from "../../src/ui/Card";
import { useScrollY } from "../../src/ui/chrome";
import { confirm } from "../../src/ui/confirm";
import { Icon } from "../../src/ui/Icon";
import { IconButton } from "../../src/ui/IconButton";
import { SectionTitle } from "../../src/ui/SectionTitle";
import { ChipRow } from "../../src/ui/ChipRow";
import { useFilterSwap } from "../../src/ui/filterSwap";
import { DoneFold, TaskSlice } from "../../src/ui/TaskCard";
import type { TaskVariant } from "../../src/ui/TaskRow";
import { TopBar } from "../../src/ui/TopBar";
import { Txt } from "../../src/ui/Txt";

const SECTIONS = [
  { key: "today", title: "Today" },
  { key: "week", title: "This week" },
  { key: "later", title: "Later" },
  { key: "undated", title: "Someday" },
] as const;

/**
 * The list, flat: what slipped, then each section's name and its tasks, one
 * slice of the card each, then "All clear" or Done. Done and the empty state
 * are rows too, so they move with the rest (as the list's footer they jumped
 * while the rows glided).
 */
type Row =
  | { kind: "slipped"; key: string }
  | { kind: "title"; key: string; title: string; first: boolean }
  | { kind: "task"; key: string; task: Task; variant: TaskVariant; first: boolean; last: boolean }
  | { kind: "empty"; key: string }
  | { kind: "done"; key: string };

/**
 * Life Center: every task in one calm place, sorted by when, the way
 * Rosebud lists goals: a centred word for each section and the tasks on a
 * card under it. Areas filter the list from one row of chips under the bar.
 * What slipped is a single card with one way forward. Nothing counts.
 *
 * Only the rows on screen are drawn: each task is a slice of its section's
 * card (TaskSlice), so a long list opens as fast as a short one. With 80
 * tasks, drawing every row made opening this tab take seconds.
 */
export default function LifeCenter() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const acknowledge = useAcknowledge();
  const tasks = useSage((state) => state.tasks);
  const areas = useSage((state) => state.areas);
  const clearCompleted = useSage((state) => state.clearCompleted);
  const { onScroll, scrollY } = useScrollY();
  const scroller = useAnimatedRef<Animated.FlatList<Row>>();
  const { ready } = useSageStatus();
  const pull = usePullToRefresh();
  useScrollToTop(scroller as never);
  // An area chosen: the chip answers at once, the list dips, changes out of sight and rises (useFilterSwap).
  const { chosen, shown: area, quiet, choose, reset, listStyle } = useFilterSwap<string | null>(null, {
    scrollToTop: () => scroller.current?.scrollToOffset({ offset: 0, animated: false }),
    ready,
  });
  // Tapping the chosen area again goes back to every area.
  const pickArea = (value: string | null) => {
    const next = value !== null && value === chosen ? null : value;
    if (next !== chosen) choose(next);
  };
  // The chosen area renamed or removed (in Manage areas): back to every area,
  // rather than a filter on a name that's gone ("Nothing waiting in …").
  useEffect(() => {
    if (chosen !== null && !areas.some((item) => item.name === chosen)) reset(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [areas, chosen]);
  const groups = useMemo(() => groupTasks(tasks, area), [tasks, area]);
  const everywhere = useMemo(() => groupTasks(tasks, null), [tasks]);
  const anySlipped = everywhere.slipped.length > 0;
  const anyOpen = groups.today.length + groups.week.length + groups.later.length + groups.undated.length > 0;
  // Tasks that come back (unticked, added, back from elsewhere) fade in where they land; not on
  // first sight, nor when they're only scrolled into view or shown by choosing an area.
  const open = useMemo(() => new Set([...everywhere.today, ...everywhere.week, ...everywhere.later, ...everywhere.undated].map((task) => task.id)), [everywhere]);
  const knownOpen = useRef<Set<string> | null>(null);
  // When each came back: it fades in only then (drawn again later, scrolled back into view, it doesn't).
  const cameBack = useRef(new Map<string, number>());
  useEffect(() => {
    if (ready) knownOpen.current = open;
  }, [open, ready]);

  const rows = useMemo(() => {
    const list: Row[] = [];
    if (anySlipped) list.push({ kind: "slipped", key: "slipped" });
    SECTIONS.forEach((section, i) => {
      const tasks = groups[section.key];
      if (!tasks.length) return;
      list.push({ kind: "title", key: `title:${section.key}`, title: section.title, first: i === 0 && !anySlipped });
      const variant: TaskVariant = section.key === "today" ? "day" : "list";
      const known = knownOpen.current;
      tasks.forEach((task, n) => {
        if (known && !known.has(task.id)) cameBack.current.set(task.id, Date.now());
        list.push({ kind: "task", key: task.id, task, variant, first: n === 0, last: n === tasks.length - 1 });
      });
    });
    if (ready && !anyOpen) list.push({ kind: "empty", key: "empty" });
    if (groups.done.length) list.push({ kind: "done", key: "done" });
    return list;
  }, [groups, anySlipped, anyOpen, ready]);

  const clear = async () => {
    const ok = await confirm({
      title: area ? `Clear finished tasks in ${area}?` : "Clear finished tasks?",
      message: "They will be removed. Your notes are not affected.",
      action: "Clear",
    });
    if (!ok) return;
    clearCompleted(area);
    acknowledge("Cleared", "trash");
  };

  const renderRow = useCallback<ListRenderItem<Row>>(
    ({ item }) => {
      // A section emptied: its name leaves with its last task, not in one frame before it.
      if (item.kind === "title")
        return (
          <Animated.View exiting={quiet ? undefined : leave}>
            <SectionTitle title={item.title} first={item.first} />
          </Animated.View>
        );
      if (item.kind === "task") {
        const at = cameBack.current.get(item.task.id);
        const fresh = at !== undefined && Date.now() - at < 800;
        if (at !== undefined && !fresh) cameBack.current.delete(item.task.id);
        return <TaskSlice task={item.task} variant={item.variant} first={item.first} last={item.last} showArea={!area} quiet={quiet} fresh={fresh} />;
      }
      if (item.kind === "empty")
        return (
          <Animated.View entering={arriveSlow} exiting={quiet ? undefined : leave} style={styles.empty}>
            <Sprout size={104} />
            <Txt variant="headline" center>
              {tasks.length === 0 ? "Nothing here yet" : area ? `Nothing waiting in ${area}` : "All clear"}
            </Txt>
            <Txt variant="subhead" tone="ink3" center style={styles.emptyText}>
              {tasks.length === 0 ? "Tasks you add, or find in your notes, gather here." : "Enjoy the quiet."}
            </Txt>
          </Animated.View>
        );
      if (item.kind === "done")
        return (
          <View style={styles.fold}>
            <DoneFold tasks={groups.done} onClear={clear} showArea={!area} quiet={quiet} scope={area ?? ""} inList />
          </View>
        );
      return (
        <Card style={styles.slipped}>
          <View style={[styles.slippedIcon, { backgroundColor: colors.warmSoft }]}>
            <Icon name="rotate" size={18} color={colors.warm} weight="bold" />
          </View>
          <View style={styles.flex}>
            <Txt variant="headline">A few things slipped</Txt>
            <Txt variant="subhead" tone="ink2">
              Pick them up, move them, or let them go.
            </Txt>
          </View>
          <Button label="Catch up" variant="soft" size="sm" onPress={() => router.push("/catch-up")} accessibilityLabel="Catch up on what slipped" />
        </Card>
      );
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [area, quiet, colors, router, groups.done, tasks.length],
  );

  return (
    <View style={[styles.screen, { backgroundColor: colors.page }]}>
      <TopBar title="Life Center" scrollY={scrollY} right={<IconButton icon="sliders" label="Manage areas" onPress={() => router.push("/sheet/areas")} />}>
        <ChipRow choices={[{ label: "All", value: null }, ...areas.map((item) => ({ label: item.name, value: item.name as string | null }))]} chosen={chosen} onChoose={pickArea} contentStyle={styles.chips} testID="life-chips" />
      </TopBar>

      {/* The list as one layer: it dips and rises when an area is chosen (on the list itself the fade didn't apply on web). */}
      <Animated.View style={[styles.screen, listStyle]}>
      <Animated.FlatList
        ref={scroller}
        data={rows}
        keyExtractor={(row) => row.key}
        renderItem={renderRow}
        // Rows that stay close the gap a leaving one leaves; not while an area is chosen.
        itemLayoutAnimation={quiet ? undefined : settle}
        testID="life-list"
        onScroll={onScroll}
        scrollEventThrottle={16}
        contentInsetAdjustmentBehavior="never"
        showsVerticalScrollIndicator={false}
        refreshControl={pull}
        contentContainerStyle={{ paddingBottom: insets.bottom + 120, paddingTop: space[4] }}
        // A screenful first, then the rest as it comes into view. Two screens
        // either side are kept drawn, not four: choosing an area takes down
        // and puts up every drawn row, and each carries a swipe and its own
        // animations.
        initialNumToRender={10}
        maxToRenderPerBatch={8}
        windowSize={5}
        ListHeaderComponent={
          <>
            <LoadProblem />
            {ready ? null : <SkeletonCards cards={2} rows={3} label="Loading your tasks" />}
          </>
        }
      />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  flex: { flex: 1, gap: 2 },
  chips: { gap: space[2], paddingHorizontal: edge, paddingBottom: space[3], alignItems: "center" },
  slipped: { flexDirection: "row", alignItems: "center", gap: space[3], padding: pad, marginTop: space[1] },
  slippedIcon: { width: 36, height: 36, borderRadius: radius.pill, alignItems: "center", justifyContent: "center" },
  empty: { alignItems: "center", gap: space[2], paddingTop: space[10], paddingHorizontal: edge },
  emptyText: { maxWidth: 280 },
  fold: { marginTop: space[3] },
});
