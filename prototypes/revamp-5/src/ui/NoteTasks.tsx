import { useRouter } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import Animated from "react-native-reanimated";
import { useShallow } from "zustand/react/shallow";
import type { Suggestion } from "../store/model";
import { whenLabel } from "../store/selectors";
import { useAiOn, useAiReady } from "../data/ai";
import { useSage, useWhenEditable } from "../data/sage";
import { arrive, arriveSlow, leave, settle } from "../theme/motion";
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
  // Finding tasks is AI help: only when it's on, and for an account, online.
  const aiOn = useAiOn();
  const aiReady = useAiReady();
  // Opened for the first time with AI help: it's reading from the first frame,
  // rather than "Reading…" pushing everything down as the sheet comes up.
  const [looking, setLooking] = useState(() => !searched && aiReady);
  const [nothing, setNothing] = useState(false);
  const busy = useRef(false);

  const look = async () => {
    if (busy.current) return;
    if (!aiReady) {
      acknowledge("Finding tasks needs a connection", "cloudOff");
      return;
    }
    busy.current = true;
    setNothing(false);
    setLooking(true);
    const started = Date.now();
    const result = await findTasks(noteId);
    // The dots stay a moment either way, so reading never flickers.
    await new Promise((resolve) => setTimeout(resolve, Math.max(0, 1_400 - (Date.now() - started))));
    busy.current = false;
    setLooking(false);
    if (result === "none") setNothing(true);
    if (result === "nothing-new") acknowledge("Nothing new since the last look", "sparkles");
    if (result === "failed") acknowledge("Couldn't read this note just now. Try again in a moment.", "sparkles");
  };
  // The first time a note's tasks are opened, look for some (with AI help on).
  useEffect(() => {
    if (!searched && aiReady) void look();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const open = tasks.filter((task) => !task.done);
  const done = tasks.filter((task) => task.done);
  const waiting = found ?? [];

  return (
    <View>
      {looking ? (
        <Animated.View entering={arrive} exiting={leave} style={styles.looking}>
          <ThinkingDots />
          <Txt variant="subhead" tone="ink3" center>
            Reading your note for things to do
          </Txt>
        </Animated.View>
      ) : null}

      {!looking && waiting.length ? (
        <Animated.View entering={arriveSlow} exiting={leave} layout={settle}>
          <SectionTitle title="Found in this note" icon="sparkles" first />
          <View style={styles.found}>
            {waiting.map((item) => (
              <Animated.View key={item.key} layout={settle} entering={arrive} exiting={leave}>
                <FoundCard noteId={noteId} item={item} />
              </Animated.View>
            ))}
          </View>
        </Animated.View>
      ) : null}

      {!looking && nothing ? (
        <Animated.View entering={arrive} exiting={leave} style={styles.nothing}>
          <Txt variant="subhead" tone="ink3" center>
            No new tasks in this note.
          </Txt>
        </Animated.View>
      ) : null}

      {/* What follows the found cards moves with them, rather than jumping as they come and go. */}
      <Animated.View layout={settle}>
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
        {aiOn ? (
          <Button label={looking ? "Reading" : "Find tasks"} icon="sparkles" variant="secondary" size="md" flex state={looking ? "busy" : "idle"} onPress={() => void look()} accessibilityLabel="Find tasks in this note" />
        ) : null}
      </ButtonPair>
      {aiOn ? null : (
        <Pressable onPress={() => router.push("/settings")} accessibilityRole="button" accessibilityLabel="Finding tasks needs AI help. Open Settings" hitSlop={8} style={styles.link}>
          {({ pressed }) => (
            <Txt variant="footnote" tone="ink3" center style={{ opacity: pressed ? 0.5 : 1 }}>
              Finding tasks in a note needs AI help, which is off. Turn it on in Settings.
            </Txt>
          )}
        </Pressable>
      )}
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
      </Animated.View>
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
            <Animated.View entering={arrive}>
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
