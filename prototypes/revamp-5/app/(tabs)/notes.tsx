import { useRouter, useScrollToTop } from "expo-router";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { StyleSheet, View, type ListRenderItem } from "react-native";
import Animated, { useAnimatedRef } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Notebook } from "../../src/art/Pictures";
import type { Note } from "../../src/store/model";
import { noteGroup } from "../../src/store/selectors";
import { useSage, useSageStatus } from "../../src/data/sage";
import { LoadProblem, SkeletonCards, usePullToRefresh } from "../../src/ui/Loading";
import { arriveSlow, leave, settle } from "../../src/theme/motion";
import { useTheme } from "../../src/theme/ThemeProvider";
import { edge, space } from "../../src/theme/tokens";
import { ChipRow } from "../../src/ui/ChipRow";
import { useFilterSwap } from "../../src/ui/filterSwap";
import { useScrollY } from "../../src/ui/chrome";
import { tap } from "../../src/ui/haptics";
import { IconButton } from "../../src/ui/IconButton";
import { NoteCard } from "../../src/ui/NoteCard";
import { SectionTitle } from "../../src/ui/SectionTitle";
import { TopBar } from "../../src/ui/TopBar";
import { Txt } from "../../src/ui/Txt";

const enter = arriveSlow;
const exit = leave;

/** The list, flat: a day's heading, then its notes. */
type Row = { kind: "group"; key: string; title: string; first: boolean } | { kind: "note"; key: string; note: Note; spaced: boolean };

/**
 * Every note, newest first, the way Rosebud keeps its history: a quiet
 * heading for each day, lined up with the words in the cards, and each
 * note on its own card. The area
 * filter is one icon that unfolds a row of chips under the bar and folds
 * it away again. Nothing here counts anything.
 *
 * Only the cards on screen are drawn (a list that draws as it scrolls), and
 * none of them animates in: with a real account's notes, drawing and
 * animating every card made opening this tab take seconds.
 */
export default function Notes() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const notes = useSage((state) => state.notes);
  const areaList = useSage((state) => state.areas);
  const { onScroll, scrollY } = useScrollY();
  const scroller = useAnimatedRef<Animated.FlatList<Row>>();
  const { ready } = useSageStatus();
  const pull = usePullToRefresh();
  useScrollToTop(scroller as never);
  const [filtering, setFiltering] = useState(false);
  // An area chosen: the chip answers at once, the list dips, changes out of sight and rises (useFilterSwap).
  const { chosen, shown: area, choose, reset, listStyle } = useFilterSwap<string | null>(null, {
    scrollToTop: () => scroller.current?.scrollToOffset({ offset: 0, animated: false }),
    ready,
  });
  // The chosen area renamed or removed: back to every area.
  useEffect(() => {
    if (chosen !== null && !areaList.some((item) => item.name === chosen)) reset(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [areaList, chosen]);

  // Newest first, sorted once per change to the notes, not again for each area chosen.
  const sorted = useMemo(() => [...notes].sort((a, b) => (a.day === b.day ? b.time.localeCompare(a.time, undefined, { numeric: true }) : a.day < b.day ? 1 : -1)), [notes]);
  // Each day's heading once, before its notes.
  const rows = useMemo(() => {
    const list: Row[] = [];
    let group: string | null = null;
    for (const note of sorted) {
      if (area && note.area !== area) continue;
      const title = noteGroup(note.day);
      const fresh = title !== group;
      if (fresh) list.push({ kind: "group", key: `group:${title}`, title, first: group === null });
      list.push({ kind: "note", key: note.id, note, spaced: !fresh });
      group = title;
    }
    return list;
  }, [sorted, area]);

  const renderRow = useCallback<ListRenderItem<Row>>(
    ({ item }) =>
      item.kind === "group" ? (
        <SectionTitle title={item.title} first={item.first} align="left" />
      ) : (
        <View style={item.spaced ? styles.spaced : null}>
          <NoteCard note={item.note} showArea={!area} onPress={() => router.push(`/note/${item.note.id}`)} />
        </View>
      ),
    [area, router],
  );

  // Folding the chips away goes back to every area, as the same calm swap (the button's tap is the feedback).
  const toggleFilter = () => {
    tap();
    if (filtering && chosen !== null) choose(null, { silent: true });
    setFiltering(!filtering);
  };
  // Tapping the chosen area again goes back to every area.
  const pickArea = (value: string | null) => {
    const next = value !== null && value === chosen ? null : value;
    if (next !== chosen) choose(next);
  };

  return (
    <View style={[styles.screen, { backgroundColor: colors.page }]}>
      <TopBar
        title="Notes"
        scrollY={scrollY}
        right={<IconButton icon="filter" label={filtering ? "Show every area" : "Filter by area"} tone={filtering ? "ink" : "ink2"} onPress={toggleFilter} />}
      >
        {filtering ? (
          <Animated.View entering={enter} exiting={exit}>
            <ChipRow choices={[{ label: "All", value: null }, ...areaList.map(({ name }) => ({ label: name, value: name as string | null }))]} chosen={chosen} onChoose={pickArea} contentStyle={styles.chips} testID="notes-chips" />
          </Animated.View>
        ) : null}
      </TopBar>

      {/* The chips unfolding make room by moving the list down, not by jumping it. */}
      <Animated.View layout={settle} style={styles.screen}>
      {/* The list as one layer: it dips and rises when an area is chosen. */}
      <Animated.View style={[styles.screen, listStyle]}>
      <Animated.FlatList
        ref={scroller}
        testID="notes-list"
        data={rows}
        keyExtractor={(row) => row.key}
        renderItem={renderRow}
        onScroll={onScroll}
        scrollEventThrottle={16}
        contentInsetAdjustmentBehavior="never"
        showsVerticalScrollIndicator={false}
        refreshControl={pull}
        contentContainerStyle={{ paddingBottom: insets.bottom + 120 }}
        // A screenful first, then the rest as it comes into view.
        initialNumToRender={8}
        maxToRenderPerBatch={6}
        windowSize={9}
        ListHeaderComponent={
          <>
            <LoadProblem />
            {ready ? null : (
              <View style={styles.loading}>
                <SkeletonCards cards={3} rows={2} />
              </View>
            )}
          </>
        }
        ListEmptyComponent={
          ready ? (
            <Animated.View entering={enter} style={styles.empty}>
              <Notebook size={84} />
              <Txt variant="subhead" tone="ink3" center style={styles.emptyText}>
                {area ? `Nothing is tagged ${area} yet.` : "Your notes will gather here, newest first."}
              </Txt>
            </Animated.View>
          ) : null
        }
      />
      </Animated.View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  loading: { paddingTop: space[4] },
  screen: { flex: 1 },
  chips: { gap: space[2], paddingHorizontal: edge, paddingBottom: space[3] },
  spaced: { paddingTop: space[3] },
  empty: { alignItems: "center", paddingTop: space[12], gap: space[4] },
  emptyText: { maxWidth: 260 },
});
