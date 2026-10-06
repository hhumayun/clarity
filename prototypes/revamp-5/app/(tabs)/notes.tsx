import { useRouter, useScrollToTop } from "expo-router";
import React, { useCallback, useMemo, useState } from "react";
import { ScrollView, StyleSheet, View, type ListRenderItem } from "react-native";
import Animated, { FadeIn, FadeOut, useAnimatedRef } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Notebook } from "../../src/art/Pictures";
import type { Note } from "../../src/store/model";
import { noteGroup } from "../../src/store/selectors";
import { useSage, useSageStatus } from "../../src/data/sage";
import { LoadProblem, SkeletonCards, usePullToRefresh } from "../../src/ui/Loading";
import { duration, easeOut } from "../../src/theme/motion";
import { useTheme } from "../../src/theme/ThemeProvider";
import { edge, space } from "../../src/theme/tokens";
import { Chip } from "../../src/ui/Chip";
import { useScrollY } from "../../src/ui/chrome";
import { tap, tick } from "../../src/ui/haptics";
import { IconButton } from "../../src/ui/IconButton";
import { NoteCard } from "../../src/ui/NoteCard";
import { SectionTitle } from "../../src/ui/SectionTitle";
import { TopBar } from "../../src/ui/TopBar";
import { Txt } from "../../src/ui/Txt";

const enter = FadeIn.duration(duration.enter).easing(easeOut);
const exit = FadeOut.duration(duration.quick);

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
  const [area, setArea] = useState<string | null>(null);

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

  const toggleFilter = () => {
    tap();
    if (filtering) setArea(null);
    setFiltering(!filtering);
  };
  // Choosing an area answers with a tick, as a choice should.
  const choose = (next: string | null) => {
    tick();
    setArea(next);
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
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
              <Chip label="All" selected={area === null} onPress={() => choose(null)} />
              {areaList.map(({ name }) => (
                <Chip key={name} label={name} selected={area === name} onPress={() => choose(area === name ? null : name)} />
              ))}
            </ScrollView>
          </Animated.View>
        ) : null}
      </TopBar>

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
