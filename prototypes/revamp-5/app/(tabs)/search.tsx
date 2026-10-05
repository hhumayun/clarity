import { useRouter, useScrollToTop } from "expo-router";
import React, { useMemo, useState } from "react";
import { Pressable, StyleSheet, TextInput, View } from "react-native";
import Animated, { FadeIn, FadeOut, LinearTransition, useAnimatedRef } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Magnifier } from "../../src/art/Pictures";
import { byPlan } from "../../src/store/selectors";
import { useStore } from "../../src/store/store";
import { duration, easeOut } from "../../src/theme/motion";
import { useTheme } from "../../src/theme/ThemeProvider";
import { edge, radius, space } from "../../src/theme/tokens";
import { Chip } from "../../src/ui/Chip";
import { useScrollY } from "../../src/ui/chrome";
import { tick } from "../../src/ui/haptics";
import { Icon } from "../../src/ui/Icon";
import { NoteCard } from "../../src/ui/NoteCard";
import { SectionTitle } from "../../src/ui/SectionTitle";
import { TaskCard } from "../../src/ui/TaskCard";
import { TopBar } from "../../src/ui/TopBar";
import { Txt, useType } from "../../src/ui/Txt";

const settle = LinearTransition.duration(duration.enter).easing(easeOut);
const enter = FadeIn.duration(duration.enter).easing(easeOut);
const exit = FadeOut.duration(duration.quick);

/**
 * One place to find anything: a white field under the bar, and as you type
 * the notes and the tasks that mention it, on cards, with the words you
 * typed picked out in the accent. Before you type, a magnifier drifts over
 * a page and the areas offer a way in. No counts of results.
 */
export default function Search() {
  const { colors, accent } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const notes = useStore((state) => state.notes);
  const tasks = useStore((state) => state.tasks);
  const areas = useStore((state) => state.areas);
  const { onScroll, scrollY } = useScrollY();
  const scroller = useAnimatedRef<Animated.ScrollView>();
  useScrollToTop(scroller as never);
  const inputType = useType("callout");
  const [query, setQuery] = useState("");
  const [area, setArea] = useState<string | null>(null);
  const q = query.trim().toLowerCase();

  const foundNotes = useMemo(
    () =>
      notes
        .filter((note) => (!area || note.area === area) && (!q || `${note.title} ${note.excerpt} ${(note.blocks ?? []).map((b) => b.text).join(" ")}`.toLowerCase().includes(q)))
        .sort((a, b) => (a.day === b.day ? b.time.localeCompare(a.time, undefined, { numeric: true }) : a.day < b.day ? 1 : -1)),
    [notes, q, area],
  );
  const foundTasks = useMemo(
    () => tasks.filter((task) => !task.done && (!area || task.area === area) && (!q || `${task.title} ${task.details}`.toLowerCase().includes(q))).sort(byPlan),
    [tasks, q, area],
  );
  const looking = q.length > 0 || area !== null;

  return (
    <View style={[styles.screen, { backgroundColor: colors.page }]}>
      <TopBar title="Search" scrollY={scrollY}>
        <View style={[styles.field, { backgroundColor: colors.card }]}>
          <Icon name="search" size={18} color={colors.ink3} weight="semibold" />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Notes and tasks"
            placeholderTextColor={colors.ink3}
            selectionColor={accent.solid}
            cursorColor={accent.solid}
            returnKeyType="search"
            autoCorrect={false}
            style={[inputType, styles.input, { color: colors.ink }]}
            accessibilityLabel="Search notes and tasks"
          />
          {query ? (
            <Pressable onPress={() => setQuery("")} accessibilityRole="button" accessibilityLabel="Clear search" hitSlop={10}>
              <View style={[styles.clear, { backgroundColor: colors.ink3 }]}>
                <Icon name="close" size={10} color={colors.card} weight="bold" />
              </View>
            </Pressable>
          ) : null}
        </View>
      </TopBar>

      <Animated.ScrollView
        ref={scroller}
        onScroll={onScroll}
        scrollEventThrottle={16}
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        contentInsetAdjustmentBehavior="never"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: insets.bottom + 120 }}
      >
        <View style={styles.areas}>
          {areas.map(({ name }) => (
            <Chip
              key={name}
              label={name}
              selected={area === name}
              onPress={() => {
                tick();
                setArea(area === name ? null : name);
              }}
            />
          ))}
        </View>

        {!looking ? (
          <Animated.View entering={enter} exiting={exit} style={styles.empty}>
            <Magnifier size={96} />
            <Txt variant="headline" center>
              Find anything you wrote
            </Txt>
            <Txt variant="subhead" tone="ink3" center style={styles.emptyText}>
              Search every note and task, or start from an area.
            </Txt>
          </Animated.View>
        ) : (
          <Animated.View layout={settle}>
            {foundNotes.length ? (
              <Animated.View layout={settle} entering={enter} exiting={exit}>
                <SectionTitle title="Notes" first />
                <View style={styles.cards}>
                  {foundNotes.slice(0, 12).map((note) => (
                    <NoteCard key={note.id} note={note} match={q} lines={2} onPress={() => router.push(`/note/${note.id}`)} />
                  ))}
                </View>
              </Animated.View>
            ) : null}
            {foundTasks.length ? (
              <Animated.View layout={settle} entering={enter} exiting={exit}>
                <SectionTitle title="Tasks" first={!foundNotes.length} />
                <TaskCard tasks={foundTasks.slice(0, 12)} />
              </Animated.View>
            ) : null}
            {!foundNotes.length && !foundTasks.length ? (
              <Animated.View entering={enter} style={styles.none}>
                <Txt variant="subhead" tone="ink3" center>
                  {q ? `Nothing mentions “${query.trim()}”${area ? ` in ${area}` : ""}.` : `Nothing in ${area} yet.`}
                </Txt>
              </Animated.View>
            ) : null}
          </Animated.View>
        )}
      </Animated.ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  field: { flexDirection: "row", alignItems: "center", gap: space[2], height: 48, marginHorizontal: edge, marginBottom: space[3], paddingHorizontal: space[4], borderRadius: radius.button, borderCurve: "continuous" },
  input: { flex: 1, height: 48, paddingVertical: 0, outlineWidth: 0 },
  clear: { width: 18, height: 18, borderRadius: 9, alignItems: "center", justifyContent: "center" },
  areas: { flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: space[2], paddingHorizontal: edge, paddingTop: space[4] },
  empty: { alignItems: "center", gap: space[2], paddingTop: space[10], paddingHorizontal: edge },
  emptyText: { maxWidth: 260 },
  cards: { gap: space[3] },
  none: { paddingTop: space[10], paddingHorizontal: edge },
});
