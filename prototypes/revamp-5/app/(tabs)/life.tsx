import { useRouter, useScrollToTop } from "expo-router";
import React, { useCallback, useEffect, useMemo } from "react";
import { StyleSheet, View, type ListRenderItem } from "react-native";
import Animated, { useAnimatedRef } from "react-native-reanimated";
import type { Task } from "../../src/store/model";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Sprout } from "../../src/art/Pictures";
import { groupTasks } from "../../src/store/selectors";
import { useSage, useSageStatus } from "../../src/data/sage";
import { LoadProblem, SkeletonCards, usePullToRefresh } from "../../src/ui/Loading";
import { arriveSlow, settle } from "../../src/theme/motion";
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

/** The list, flat: what slipped, then each section's name and its tasks, one slice of the card each. */
type Row =
  | { kind: "slipped"; key: string }
  | { kind: "title"; key: string; title: string; first: boolean }
  | { kind: "task"; key: string; task: Task; variant: TaskVariant; first: boolean; last: boolean };

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
  const anySlipped = useMemo(() => groupTasks(tasks, null).slipped.length > 0, [tasks]);
  const anyOpen = groups.today.length + groups.week.length + groups.later.length + groups.undated.length > 0;

  const rows = useMemo(() => {
    const list: Row[] = [];
    if (anySlipped) list.push({ kind: "slipped", key: "slipped" });
    SECTIONS.forEach((section, i) => {
      const tasks = groups[section.key];
      if (!tasks.length) return;
      list.push({ kind: "title", key: `title:${section.key}`, title: section.title, first: i === 0 && !anySlipped });
      const variant: TaskVariant = section.key === "today" ? "day" : "list";
      tasks.forEach((task, n) => list.push({ kind: "task", key: task.id, task, variant, first: n === 0, last: n === tasks.length - 1 }));
    });
    return list;
  }, [groups, anySlipped]);

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
      if (item.kind === "title") return <SectionTitle title={item.title} first={item.first} />;
      if (item.kind === "task") return <TaskSlice task={item.task} variant={item.variant} first={item.first} last={item.last} showArea={!area} quiet={quiet} />;
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
    [area, quiet, colors, router],
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
        ListFooterComponent={
          <>
            {ready && !anyOpen ? (
              <Animated.View entering={arriveSlow} style={styles.empty}>
                <Sprout size={104} />
                <Txt variant="headline" center>
                  {tasks.length === 0 ? "Nothing here yet" : area ? `Nothing waiting in ${area}` : "All clear"}
                </Txt>
                <Txt variant="subhead" tone="ink3" center style={styles.emptyText}>
                  {tasks.length === 0 ? "Tasks you add, or find in your notes, gather here." : "Enjoy the quiet."}
                </Txt>
              </Animated.View>
            ) : null}
            <View style={styles.fold}>
              <DoneFold tasks={groups.done} onClear={clear} showArea={!area} quiet={quiet} scope={area ?? ""} />
            </View>
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
