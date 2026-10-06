import { useRouter, useScrollToTop } from "expo-router";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, TextInput, View } from "react-native";
import Animated, { useAnimatedRef } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Magnifier } from "../../src/art/Pictures";
import { byPlan } from "../../src/store/selectors";
import { useSage, useSageStatus } from "../../src/data/sage";
import { LoadProblem, SkeletonCards } from "../../src/ui/Loading";
import { leave } from "../../src/theme/motion";
import { useTheme } from "../../src/theme/ThemeProvider";
import { edge, radius, space } from "../../src/theme/tokens";
import { Button } from "../../src/ui/Button";
import { ChipRow } from "../../src/ui/ChipRow";
import { useFilterSwap } from "../../src/ui/filterSwap";
import { useScrollY } from "../../src/ui/chrome";
import { Icon } from "../../src/ui/Icon";
import { NoteCard } from "../../src/ui/NoteCard";
import { SectionTitle } from "../../src/ui/SectionTitle";
import { TaskCard } from "../../src/ui/TaskCard";
import { TopBar } from "../../src/ui/TopBar";
import { Txt, useType } from "../../src/ui/Txt";

/**
 * One place to find anything: a white field under the bar, and as you type
 * the notes and the tasks that mention it, on cards, with the words you
 * typed picked out in the accent. Before you type, a magnifier drifts over
 * a page, and the areas, in the same row of chips as Life's, offer a way in.
 * No counts of results.
 */
export default function Search() {
  const { colors, accent } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const notes = useSage((state) => state.notes);
  const tasks = useSage((state) => state.tasks);
  const areas = useSage((state) => state.areas);
  const { onScroll, scrollY } = useScrollY();
  const scroller = useAnimatedRef<Animated.ScrollView>();
  const { ready } = useSageStatus();
  useScrollToTop(scroller as never);
  const inputType = useType("callout");
  const [query, setQuery] = useState("");
  const typed = query.trim().toLowerCase();

  // What's searched for (the words, as typed once typing pauses, and the area) changes the results as
  // one calm swap (useFilterSwap): they dip, change out of sight and rise. They used to rebuild on every
  // key, cards swapping and rows sliding.
  const { chosen, shown, quiet, choose, reset, listStyle } = useFilterSwap<Scope>(EVERYTHING, {
    same: sameScope,
    scrollToTop: () => scroller.current?.scrollTo({ y: 0, animated: false }),
  });
  const chosenRef = useRef(chosen);
  chosenRef.current = chosen;
  useEffect(() => {
    const timer = setTimeout(() => {
      const next = { q: typed, area: chosenRef.current.area };
      if (!sameScope(next, chosenRef.current)) choose(next, { silent: true });
    }, TYPING_PAUSE_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [typed]);
  // Tapping the chosen area again goes back to every area.
  const pickArea = (value: string | null) => {
    const area = value !== null && value === chosen.area ? null : value;
    const next = { q: typed, area };
    if (!sameScope(next, chosen)) choose(next);
  };
  // The chosen area renamed or removed: back to every area.
  useEffect(() => {
    if (chosen.area !== null && !areas.some((item) => item.name === chosen.area)) reset({ q: chosen.q, area: null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [areas, chosen]);

  const { q, area } = shown;
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
  // A few at a time, and a quiet way to more (it used to stop at 12, saying nothing). No counts.
  const [notesShown, setNotesShown] = useState(PAGE);
  const [tasksShown, setTasksShown] = useState(PAGE);
  useEffect(() => {
    setNotesShown(PAGE);
    setTasksShown(PAGE);
  }, [q, area]);

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
        <ChipRow
          choices={[{ label: "All", value: null }, ...areas.map(({ name }) => ({ label: name, value: name as string | null }))]}
          chosen={chosen.area}
          onChoose={pickArea}
          contentStyle={styles.chips}
          testID="search-chips"
        />
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
        <LoadProblem />
        {/* The results as one layer: they dip and rise as what's searched for changes. */}
        <Animated.View style={listStyle} testID="search-results">
          {!looking ? (
            <View style={styles.empty}>
              <Magnifier size={96} />
              <Txt variant="headline" center>
                Find anything you wrote
              </Txt>
              <Txt variant="subhead" tone="ink3" center style={styles.emptyText}>
                Search every note and task, or start from an area.
              </Txt>
            </View>
          ) : (
            <View>
              {ready ? null : (
                <Animated.View exiting={leave}>
                  <SkeletonCards cards={1} rows={2} label="Loading" />
                </Animated.View>
              )}
              {foundNotes.length ? (
                <View>
                  <SectionTitle title="Notes" first />
                  <View style={styles.cards}>
                    {foundNotes.slice(0, notesShown).map((note) => (
                      <NoteCard key={note.id} note={note} match={q} lines={2} onPress={() => router.push(`/note/${note.id}`)} />
                    ))}
                  </View>
                  {foundNotes.length > notesShown ? <Button label="Show more notes" variant="plain" size="sm" onPress={() => setNotesShown((n) => n + PAGE)} style={styles.more} /> : null}
                </View>
              ) : null}
              {foundTasks.length ? (
                <View>
                  <SectionTitle title="Tasks" first={!foundNotes.length} />
                  <TaskCard tasks={foundTasks.slice(0, tasksShown)} quiet={quiet} />
                  {foundTasks.length > tasksShown ? <Button label="Show more tasks" variant="plain" size="sm" onPress={() => setTasksShown((n) => n + PAGE)} style={styles.more} /> : null}
                </View>
              ) : null}
              {ready && !foundNotes.length && !foundTasks.length ? (
                <View style={styles.none}>
                  <Txt variant="subhead" tone="ink3" center>
                    {q ? `Nothing mentions “${q}”${area ? ` in ${area}` : ""}.` : `Nothing in ${area} yet.`}
                  </Txt>
                </View>
              ) : null}
            </View>
          )}
        </Animated.View>
      </Animated.ScrollView>
    </View>
  );
}

/** What's searched for: the words (lower case, trimmed) and the area. */
type Scope = { q: string; area: string | null };
const EVERYTHING: Scope = { q: "", area: null };
const sameScope = (a: Scope, b: Scope) => a.q === b.q && a.area === b.area;
// The results change once typing pauses this long, not on every key.
const TYPING_PAUSE_MS = 120;

// How many notes, and tasks, show before "Show more".
const PAGE = 12;

const styles = StyleSheet.create({
  screen: { flex: 1 },
  more: { alignSelf: "center", marginTop: space[2] },
  field: { flexDirection: "row", alignItems: "center", gap: space[2], height: 48, marginHorizontal: edge, marginBottom: space[3], paddingHorizontal: space[4], borderRadius: radius.button, borderCurve: "continuous" },
  input: { flex: 1, height: 48, paddingVertical: 0, outlineWidth: 0 },
  clear: { width: 18, height: 18, borderRadius: 9, alignItems: "center", justifyContent: "center" },
  chips: { gap: space[2], paddingHorizontal: edge, paddingBottom: space[3], alignItems: "center" },
  empty: { alignItems: "center", gap: space[2], paddingTop: space[10], paddingHorizontal: edge },
  emptyText: { maxWidth: 260 },
  cards: { gap: space[3] },
  none: { paddingTop: space[10], paddingHorizontal: edge },
});
