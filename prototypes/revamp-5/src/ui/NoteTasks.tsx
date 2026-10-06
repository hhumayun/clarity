import { useRouter } from "expo-router";
import React, { useEffect, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import Animated, { FadeIn, FadeOut, LinearTransition } from "react-native-reanimated";
import { useShallow } from "zustand/react/shallow";
import type { Suggestion } from "../store/model";
import { whenLabel } from "../store/selectors";
import { useSage, useWhenEditable } from "../data/sage";
import { duration, easeOut } from "../theme/motion";
import { useTheme } from "../theme/ThemeProvider";
import { edge, pad, radius, space } from "../theme/tokens";
import { useAcknowledge } from "./Acknowledgement";
import { Button, ButtonPair } from "./Button";
import { CircleCheck } from "./CircleCheck";
import { done as doneHaptic, tick } from "./haptics";
import { Icon } from "./Icon";
import { SectionTitle } from "./SectionTitle";
import { DoneFold, TaskCard } from "./TaskCard";
import { ThinkingDots } from "./Thinking";
import { Txt } from "./Txt";

const settle = LinearTransition.duration(duration.enter).easing(easeOut);

/**
 * A note's tasks: what you've added or linked, on a card, and what "Find
 * tasks" turns up in its words. Found tasks come as Rosebud's suggestion
 * cards: the task, where and when, and two halves underneath. "Not now"
 * lets the card go; "Add" adds it there and then and turns into a check.
 * Nothing is added until you say so.
 */
export function NoteTasks({ noteId }: { noteId: string }) {
  const router = useRouter();
  const whenEditable = useWhenEditable();
  const acknowledge = useAcknowledge();
  const tasks = useSage(useShallow((state) => state.tasks.filter((task) => task.noteIds.includes(noteId))));
  const found = useSage((state) => state.suggestions[noteId]);
  const searched = useSage((state) => state.searched[noteId]);
  const findTasks = useSage((state) => state.findTasks);
  const [looking, setLooking] = useState(false);
  const [nothing, setNothing] = useState(false);

  const look = () => {
    if (looking) return;
    setNothing(false);
    setLooking(true);
    setTimeout(() => {
      const result = findTasks(noteId);
      setLooking(false);
      if (result === "none") setNothing(true);
      if (result === "nothing-new") acknowledge("Nothing new since the last look", "sparkles");
    }, 1_400);
  };
  // The first time a note's tasks are opened, look for some.
  useEffect(() => {
    if (!searched) look();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const open = tasks.filter((task) => !task.done);
  const done = tasks.filter((task) => task.done);
  const waiting = found ?? [];

  return (
    <View>
      {looking ? (
        <Animated.View entering={FadeIn.duration(duration.base)} exiting={FadeOut.duration(duration.quick)} style={styles.looking}>
          <ThinkingDots />
          <Txt variant="subhead" tone="ink3" center>
            Reading your note for things to do
          </Txt>
        </Animated.View>
      ) : null}

      {!looking && waiting.length ? (
        <Animated.View entering={FadeIn.duration(duration.enter)} layout={settle}>
          <SectionTitle title="Found in this note" icon="sparkles" first />
          <View style={styles.found}>
            {waiting.map((item) => (
              <Animated.View key={item.key} layout={settle} entering={FadeIn.duration(duration.base)} exiting={FadeOut.duration(duration.quick)}>
                <FoundCard noteId={noteId} item={item} />
              </Animated.View>
            ))}
          </View>
        </Animated.View>
      ) : null}

      {!looking && nothing ? (
        <Animated.View entering={FadeIn.duration(duration.base)} exiting={FadeOut.duration(duration.quick)} style={styles.nothing}>
          <Txt variant="subhead" tone="ink3" center>
            No new tasks in this note.
          </Txt>
        </Animated.View>
      ) : null}

      <SectionTitle title="Tasks" first={looking || (!waiting.length && !nothing)} />
      <TaskCard
        tasks={open}
        variant="note"
        noteId={noteId}
        empty={
          <Txt variant="subhead" tone="ink3" center>
            No tasks yet.
          </Txt>
        }
      />
      <ButtonPair style={styles.actions}>
        <Button label="Add task" icon="plus" variant="secondary" size="md" flex onPress={() => whenEditable(() => router.push(`/quick-add?day=none&note=${noteId}`))} />
        <Button label={looking ? "Reading" : "Find tasks"} icon="sparkles" variant="secondary" size="md" flex state={looking ? "busy" : "idle"} onPress={look} accessibilityLabel="Find tasks in this note" />
      </ButtonPair>
      <Pressable onPress={() => router.push(`/sheet/link-task?note=${noteId}`)} accessibilityRole="button" accessibilityLabel="Link an existing task" hitSlop={8} style={styles.link}>
        {({ pressed }) => (
          <View style={[styles.linkRow, { opacity: pressed ? 0.5 : 1 }]}>
            <LinkGlyph />
            <Txt variant="footnote" tone="ink2" weight="semibold">
              Link a task you already have
            </Txt>
          </View>
        )}
      </Pressable>
      <DoneFold tasks={done} />
    </View>
  );
}

function LinkGlyph() {
  const { colors } = useTheme();
  return <Icon name="link" size={14} color={colors.ink2} weight="semibold" />;
}

/** One found task as a card with two halves underneath, after Rosebud's goal suggestions. */
function FoundCard({ noteId, item }: { noteId: string; item: Suggestion }) {
  const { colors, accent } = useTheme();
  const addSuggestion = useSage((state) => state.addSuggestion);
  const skipSuggestion = useSage((state) => state.skipSuggestion);
  return (
    <View style={[styles.card, { backgroundColor: colors.card, boxShadow: colors.cardShadow }]}>
      <View style={styles.cardBody}>
        <Txt variant="cardTitle">{item.title}</Txt>
        <View style={styles.meta}>
          <Txt variant="footnote" tone="ink3">
            {item.area}
          </Txt>
          {item.day ? (
            <>
              <Icon name="calendar" size={13} color={colors.ink3} weight="medium" />
              <Txt variant="footnote" tone="ink3">
                {whenLabel(item)}
              </Txt>
            </>
          ) : null}
        </View>
      </View>
      <View style={[styles.halves, { borderTopColor: colors.hairline }]}>
        <Pressable
          onPress={() => {
            tick();
            skipSuggestion(noteId, item.key);
          }}
          disabled={item.added}
          accessibilityRole="button"
          accessibilityLabel={`Not now: ${item.title}`}
          style={({ pressed }) => [styles.half, { backgroundColor: pressed ? colors.sunken : "transparent", opacity: item.added ? 0.35 : 1 }]}
        >
          <Txt variant="headline" tone="ink2">
            Not now
          </Txt>
        </Pressable>
        <View style={[styles.divider, { backgroundColor: colors.hairline }]} />
        <Pressable
          onPress={() => {
            if (item.added) return;
            doneHaptic();
            addSuggestion(noteId, item.key);
          }}
          accessibilityRole="button"
          accessibilityLabel={item.added ? `${item.title} added` : `Add ${item.title}`}
          style={({ pressed }) => [styles.half, { backgroundColor: pressed && !item.added ? colors.sunken : "transparent" }]}
        >
          {item.added ? (
            <Animated.View entering={FadeIn.duration(duration.quick)}>
              <AddedCheck />
            </Animated.View>
          ) : (
            <View style={styles.addRow}>
              <Icon name="plus" size={16} color={accent.text} weight="bold" />
              <Txt variant="headline" tone="accent">
                Add
              </Txt>
            </View>
          )}
        </Pressable>
      </View>
    </View>
  );
}

/** The check that "Add" becomes: it mounts open and ticks itself, so it pops where the word was. */
function AddedCheck() {
  const [on, setOn] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setOn(true), 30);
    return () => clearTimeout(timer);
  }, []);
  return <CircleCheck on={on} size={26} />;
}

const styles = StyleSheet.create({
  looking: { alignItems: "center", gap: space[3], paddingTop: space[6], paddingBottom: space[2] },
  found: { gap: space[3] },
  nothing: { paddingTop: space[6] },
  actions: { marginHorizontal: edge, marginTop: space[3] },
  link: { alignSelf: "center", marginTop: space[4] },
  linkRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  card: { marginHorizontal: edge, borderRadius: radius.card, borderCurve: "continuous", overflow: "hidden" },
  cardBody: { padding: pad, gap: 4 },
  meta: { flexDirection: "row", alignItems: "center", gap: 6 },
  halves: { flexDirection: "row", borderTopWidth: 1, height: 50 },
  half: { flex: 1, alignItems: "center", justifyContent: "center" },
  divider: { width: 1 },
  addRow: { flexDirection: "row", alignItems: "center", gap: 6 },
});
