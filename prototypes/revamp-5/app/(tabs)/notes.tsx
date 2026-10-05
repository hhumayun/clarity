import { useRouter, useScrollToTop } from "expo-router";
import React, { useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import Animated, { FadeIn, FadeOut, LinearTransition, useAnimatedRef } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Notebook } from "../../src/art/Pictures";
import { noteGroup } from "../../src/store/selectors";
import { useStore } from "../../src/store/store";
import { duration, easeOut } from "../../src/theme/motion";
import { useTheme } from "../../src/theme/ThemeProvider";
import { edge, space } from "../../src/theme/tokens";
import { Chip } from "../../src/ui/Chip";
import { useScrollY } from "../../src/ui/chrome";
import { tap } from "../../src/ui/haptics";
import { IconButton } from "../../src/ui/IconButton";
import { NoteCard } from "../../src/ui/NoteCard";
import { SectionTitle } from "../../src/ui/SectionTitle";
import { TopBar } from "../../src/ui/TopBar";
import { Txt } from "../../src/ui/Txt";

const settle = LinearTransition.duration(duration.enter).easing(easeOut);
const enter = FadeIn.duration(duration.enter).easing(easeOut);
const exit = FadeOut.duration(duration.quick);

/**
 * Every note, newest first, the way Rosebud keeps its history: a quiet
 * centred heading for each day and each note on its own card. The area
 * filter is one icon that unfolds a row of chips under the bar and folds
 * it away again. Nothing here counts anything.
 */
export default function Notes() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const notes = useStore((state) => state.notes);
  const areaList = useStore((state) => state.areas);
  const { onScroll, scrollY } = useScrollY();
  const scroller = useAnimatedRef<Animated.ScrollView>();
  useScrollToTop(scroller as never);
  const [filtering, setFiltering] = useState(false);
  const [area, setArea] = useState<string | null>(null);

  const sorted = [...notes].sort((a, b) => (a.day === b.day ? b.time.localeCompare(a.time, undefined, { numeric: true }) : a.day < b.day ? 1 : -1));
  const shown = sorted.filter((note) => !area || note.area === area);
  const groups = [...new Set(shown.map((note) => noteGroup(note.day)))];

  const toggleFilter = () => {
    tap();
    if (filtering) setArea(null);
    setFiltering(!filtering);
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
              <Chip label="All" selected={area === null} onPress={() => setArea(null)} />
              {areaList.map(({ name }) => (
                <Chip key={name} label={name} selected={area === name} onPress={() => setArea(area === name ? null : name)} />
              ))}
            </ScrollView>
          </Animated.View>
        ) : null}
      </TopBar>

      <Animated.ScrollView
        ref={scroller}
        onScroll={onScroll}
        scrollEventThrottle={16}
        contentInsetAdjustmentBehavior="never"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: insets.bottom + 120 }}
      >
        <Animated.View layout={settle}>
          {groups.map((group, g) => (
            <Animated.View key={group} layout={settle} entering={enter} exiting={exit}>
              <SectionTitle title={group} first={g === 0} />
              <View style={styles.cards}>
                {shown
                  .filter((note) => noteGroup(note.day) === group)
                  .map((note) => (
                    <Animated.View key={note.id} layout={settle} entering={enter} exiting={exit}>
                      <NoteCard note={note} showArea={!area} onPress={() => router.push(`/note/${note.id}`)} />
                    </Animated.View>
                  ))}
              </View>
            </Animated.View>
          ))}
        </Animated.View>

        {shown.length === 0 ? (
          <Animated.View entering={enter} style={styles.empty}>
            <Notebook size={84} />
            <Txt variant="subhead" tone="ink3" center style={styles.emptyText}>
              {area ? `Nothing is tagged ${area} yet.` : "Your notes will gather here, newest first."}
            </Txt>
          </Animated.View>
        ) : null}
      </Animated.ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  chips: { gap: space[2], paddingHorizontal: edge, paddingBottom: space[3] },
  cards: { gap: space[3] },
  empty: { alignItems: "center", paddingTop: space[12], gap: space[4] },
  emptyText: { maxWidth: 260 },
});
