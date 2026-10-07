import { useLocalSearchParams, useRouter } from "expo-router";
import { useAiOn, useAiReady } from "../../src/data/ai";
import { useTaskSummary } from "../../src/core/hooks/useTasks";
import React, { useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, TextInput, View } from "react-native";
import Animated, { LayoutAnimationConfig } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { addDays, dayLabel, durationLabel, today } from "../../src/lib/dates";
import { useFocusHistory, useTask } from "../../src/data/hooks";
import type { FocusHistory, Note, Task } from "../../src/store/model";
import { clockLabel, noteGroup, reminderLabel, repeatLabels, shortDate, sinceLabel } from "../../src/store/selectors";
import { useSage, useUnsent, useDataMode } from "../../src/data/sage";
import { arrive, leave, riseIn, settle } from "../../src/theme/motion";
import { useTheme } from "../../src/theme/ThemeProvider";
import { edge, pad, radius, space } from "../../src/theme/tokens";
import { useAcknowledge } from "../../src/ui/Acknowledgement";
import { Button, ButtonPair } from "../../src/ui/Button";
import { Card, CardGroup, CardRow } from "../../src/ui/Card";
import { CircleCheck } from "../../src/ui/CircleCheck";
import { done as doneHaptic, tap, tick } from "../../src/ui/haptics";
import { Icon, type IconName } from "../../src/ui/Icon";
import { IconButton } from "../../src/ui/IconButton";
import { NoteCard } from "../../src/ui/NoteCard";
import { SectionTitle } from "../../src/ui/SectionTitle";
import { StreamText, ThinkingDots } from "../../src/ui/Thinking";
import { Txt, useType } from "../../src/ui/Txt";

/** Summaries already "read" this session: coming back shows them at once. */
const summarised = new Set<string>();

/**
 * A task on a page of its own, laid out like Rosebud's goal editor: the
 * words in a white field with the check beside them, what you've said
 * about it under that, then one card of settings (area, day, time,
 * reminder), each a label and its value. Focus is the one big button.
 * "How it's going" reads the task's notes and focus time and writes back,
 * word by word, the way Rosebud's reflections arrive. Deleting asks in
 * place: the button splits into Keep and Delete.
 */
export default function TaskScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const unsent = useUnsent(`task:${id}`);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors, accent } = useTheme();
  const acknowledge = useAcknowledge();
  const live = useTask(id);
  // Deleted here, the page slides away showing the task as it was, not
  // "could not be found" (2026-10-06).
  const deleting = useRef(false);
  const last = useRef(live);
  if (live) last.current = live;
  const task = live ?? (deleting.current ? last.current : undefined);
  const history = useFocusHistory(id);
  const notes = useSage((state) => state.notes);
  const updateTask = useSage((state) => state.updateTask);
  const setDone = useSage((state) => state.setDone);
  const deleteTask = useSage((state) => state.deleteTask);
  const titleType = useType("title2");
  const bodyType = useType("callout");
  const [asking, setAsking] = useState(false);
  // Ticked here, the check fills at once and stays so until the change lands (an account's answer
  // comes a moment later); a repeating task's check fills too, then eases back as it moves to its
  // next day.
  const [ticked, setTicked] = useState(false);
  const [checkDown, setCheckDown] = useState(false);
  useEffect(() => {
    if (live?.done) setTicked(false);
  }, [live?.done]);

  if (!task) {
    return (
      <View style={[styles.missing, { backgroundColor: colors.page }]}>
        <Txt variant="title3" tone="ink2" center>
          This task could not be found.
        </Txt>
        <Button label="Go back" variant="secondary" size="md" onPress={() => router.back()} />
      </View>
    );
  }

  const linked = task.noteIds.map((noteId) => notes.find((note) => note.id === noteId)).filter((note): note is Note => Boolean(note));
  const foundIn = task.foundIn ? notes.find((note) => note.id === task.foundIn) : undefined;
  const reminder = (() => {
    const label = reminderLabel(task.remind, task.time !== null);
    // A repeating task's reminder for this time only says so.
    return label && task.repeat && task.remindOnce ? `${label}, this time` : label;
  })();

  const toggle = () => {
    if (task.done) {
      tap();
      setDone(task.id, false);
      return;
    }
    doneHaptic();
    setTicked(true);
    const next = setDone(task.id, true);
    if (next) acknowledge(`Next: ${dayLabel(next)}`, "repeat");
    // A repeating task stays open (at its next day): its check eases back after a beat. Otherwise
    // it waits for the change, at most a moment (if it failed and was put back, it shows as it is).
    setTimeout(() => setTicked(false), next ? 900 : 2_500);
  };

  // A delete isn't a success: a light tap, not the done haptic.
  const remove = () => {
    tap();
    deleting.current = true;
    router.back();
    deleteTask(task.id);
    acknowledge("Task deleted", "trash");
  };

  const rows: { key: string; icon: IconName; label: string; value: string; empty?: boolean; href: string }[] = [
    { key: "area", icon: "tag", label: "Area", value: task.area, href: `/sheet/area?task=${task.id}` },
    { key: "date", icon: "calendar", label: "Day", value: task.day ? dayLabel(task.day) : "Someday", empty: !task.day, href: `/sheet/date?task=${task.id}` },
    { key: "time", icon: "clock", label: "Time", value: task.time !== null ? clockLabel(task.time) : "Any time", empty: task.time === null, href: `/sheet/time?task=${task.id}` },
    { key: "reminder", icon: "bell", label: "Reminder", value: reminder ?? "Off", empty: !reminder, href: `/sheet/reminder?task=${task.id}` },
    { key: "repeat", icon: "repeat", label: "Repeats", value: task.repeat ? repeatLabels[task.repeat] : "Off", empty: !task.repeat, href: `/sheet/repeat?task=${task.id}` },
  ];

  const leftOff = history?.leftOff && history.outcome !== "finished" ? history : null;
  const provenance = [foundIn ? `Found in “${foundIn.title}”` : null, `Added ${shortDate(task.createdAt)}`, task.movedFrom ? `moved from ${shortDate(task.movedFrom)}` : null, unsent ? "saved on this phone" : null].filter(Boolean).join(" · ");

  return (
    <View style={[styles.screen, { backgroundColor: colors.page }]}>
      <View style={[styles.top, { paddingTop: insets.top }]}>
        <IconButton icon="back" label="Back" tone="ink" onPress={() => router.back()} />
        <Txt variant="headline" style={styles.topTitle}>
          Task
        </Txt>
        <View style={styles.topSide} />
      </View>
      <ScrollView automaticallyAdjustKeyboardInsets keyboardDismissMode="interactive" keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: insets.bottom + space[12], paddingTop: space[2] }}>
        <Card style={styles.titleCard}>
          <TextInput
            key={task.id}
            defaultValue={task.title}
            multiline
            submitBehavior="blurAndSubmit"
            returnKeyType="done"
            placeholder="What is the task?"
            placeholderTextColor={colors.ink3}
            selectionColor={accent.solid}
            cursorColor={accent.solid}
            onEndEditing={(event) => {
              const text = event.nativeEvent.text.trim();
              if (text && text !== task.title) updateTask(task.id, { title: text });
            }}
            style={[titleType, styles.title, { color: task.done ? colors.ink3 : colors.ink, textDecorationLine: task.done ? "line-through" : "none" }]}
            accessibilityLabel="Task"
          />
          <Pressable
            onPress={toggle}
            onPressIn={() => setCheckDown(true)}
            onPressOut={() => setCheckDown(false)}
            hitSlop={10}
            accessibilityRole="checkbox"
            aria-checked={task.done || ticked}
            accessibilityLabel={task.done ? "Mark not done" : "Mark done"}
            style={styles.check}
          >
            <CircleCheck on={task.done || ticked} pressed={checkDown} size={32} />
          </Pressable>
        </Card>
        <Card style={styles.detailsCard}>
          <TextInput
            key={`${task.id}-details`}
            defaultValue={task.details}
            multiline
            placeholder="Why does it matter? Anything to remember?"
            placeholderTextColor={colors.ink3}
            selectionColor={accent.solid}
            cursorColor={accent.solid}
            onEndEditing={(event) => updateTask(task.id, { details: event.nativeEvent.text })}
            style={[bodyType, styles.details, { color: colors.ink }]}
            accessibilityLabel="Details"
          />
        </Card>

        <CardGroup style={styles.group}>
          {rows.map((row) => (
            <CardRow key={row.key} onPress={() => router.push(row.href as never)} accessibilityRole="button" accessibilityLabel={`${row.label}: ${row.value}. Change`} style={styles.row}>
              <View style={styles.slot}>
                <Icon name={row.icon} size={19} color={colors.ink2} weight="medium" />
              </View>
              <Txt variant="row" tone="ink2" style={styles.flex}>
                {row.label}
              </Txt>
              <Txt variant="row" tone={row.empty ? "ink3" : "ink"} numberOfLines={1} style={styles.value}>
                {row.value}
              </Txt>
              <Icon name="updown" size={14} color={colors.ink3} weight="semibold" />
            </CardRow>
          ))}
        </CardGroup>

        {/* What follows the settings moves together: ticked, Start focus fades and the blocks below
            glide up (they jumped while one card glided). Each block moves on its own, at one level:
            moving boxes inside moving boxes doubled their movement in the web build. */}
        <LayoutAnimationConfig skipEntering>
          {!task.done ? (
            <Animated.View entering={arrive} exiting={leave} style={styles.focus}>
              {leftOff ? (
                <Card style={styles.leftOff}>
                  <Txt variant="eyebrow" tone="ink3">
                    {leftOff.outcome === "stuck" ? "Where you got stuck" : "Where you left off"}
                  </Txt>
                  <Txt variant="callout">{leftOff.leftOff}</Txt>
                </Card>
              ) : null}
              <Button label="Start focus" icon="play" onPress={() => (tap(), router.push(`/focus/${task.id}`))} style={styles.focusButton} />
            </Animated.View>
          ) : null}

          <HowItsGoing task={task} history={history} notes={linked} />

          <Animated.View layout={settle}>
            <SectionTitle title="Notes" />
            {linked.length ? (
              <View style={styles.notes}>
                {linked.map((note) => (
                  <NoteCard key={note.id} note={note} lines={2} onPress={() => router.push(`/note/${note.id}`)} />
                ))}
              </View>
            ) : null}
            <View style={styles.linkWrap}>
              <Button label="Link a note" icon="link" variant="secondary" size="md" onPress={() => router.push(`/sheet/link-note?task=${task.id}`)} />
            </View>

            <View style={styles.footer}>
              <Txt variant="footnote" tone="ink3" center>
                {provenance}
              </Txt>
              <Animated.View layout={settle} style={styles.deleteWrap}>
                {asking ? (
                  <Animated.View key="ask" entering={arrive} style={styles.ask}>
                    <Txt variant="subhead" tone="ink2" center>
                      Delete it? It won't come back, even if its note is read again.
                    </Txt>
                    <ButtonPair>
                      <Button label="Keep" variant="secondary" size="md" flex onPress={() => (tick(), setAsking(false))} />
                      <Button label="Delete" icon="trash" variant="danger" size="md" flex onPress={remove} />
                    </ButtonPair>
                  </Animated.View>
                ) : (
                  <Animated.View key="delete" entering={arrive} exiting={leave}>
                    <Button label="Delete task" icon="trash" variant="danger" size="sm" onPress={() => (tick(), setAsking(true))} style={styles.deleteButton} />
                  </Animated.View>
                )}
              </Animated.View>
            </View>
          </Animated.View>
        </LayoutAnimationConfig>
      </ScrollView>
    </View>
  );
}

/**
 * How a task is going, read from its notes and focus time. With AI help on
 * (an account), the AI's summary, which the server keeps until the notes or
 * focus time change; otherwise Sage's own reading of them. Either way it
 * "reads" first (three dots), then the words stream in and the steps that
 * led here follow, once; coming back, it's simply there. With nothing to
 * read, the card isn't there.
 */
function HowItsGoing({ task, history, notes }: { task: Task; history: FocusHistory | undefined; notes: Note[] }) {
  const account = useDataMode((state) => state.mode) === "account";
  const aiOn = useAiOn();
  const own = summarise(task, history, notes);
  // Nothing to read (no notes, no focus time): no card, and nothing asked of the AI.
  if (!own) return null;
  if (account && aiOn) return <AiHowItsGoing task={task} own={own} />;
  return <SummaryCard id={task.id} text={own.text} steps={own.steps} pace />;
}

/** The AI's summary, with Sage's own standing in offline (nothing kept yet) or if it can't be had. */
function AiHowItsGoing({ task, own }: { task: Task; own: ReturnType<typeof summarise> }) {
  const ready = useAiReady();
  const query = useTaskSummary(task.id, ready);
  if (query.data) {
    if (!query.data.summary) return null;
    const steps = query.data.progress.map((step) => ({ when: dayLabel(step.date), text: step.text }));
    return <SummaryCard id={task.id} text={query.data.summary} steps={steps} />;
  }
  if (query.isFetching) return <SummaryCard id={task.id} text={null} steps={[]} />;
  return own ? <SummaryCard id={task.id} text={own.text} steps={own.steps} pace /> : null;
}

/** The card: dots while reading, then the words streaming in, then the steps. `pace` reads a moment first (Sage's own is instant). */
function SummaryCard({ id, text, steps, pace = false }: { id: string; text: string | null; steps: { when: string; text: string }[]; pace?: boolean }) {
  const { colors, accent } = useTheme();
  const seen = summarised.has(id);
  const [phase, setPhase] = useState<"reading" | "writing" | "done">(seen ? "done" : "reading");
  useEffect(() => {
    if (phase !== "reading" || text === null) return;
    const timer = setTimeout(() => setPhase("writing"), pace ? 1_300 : 0);
    return () => clearTimeout(timer);
  }, [phase, text, pace]);
  return (
    // It comes and goes softly (the AI may have nothing to say), never in one frame, and moves with what's above it.
    <Animated.View layout={settle} entering={arrive} exiting={leave}>
      <SectionTitle title="How it's going" icon="sparkles" />
      <View style={[styles.reflection, { backgroundColor: colors.card, boxShadow: colors.cardShadow }]}>
        {phase === "reading" || text === null ? (
          <Animated.View exiting={leave} style={styles.reading}>
            <ThinkingDots />
          </Animated.View>
        ) : phase === "writing" ? (
          <StreamText
            text={text}
            variant="callout"
            onDone={() => {
              summarised.add(id);
              setTimeout(() => setPhase("done"), 120);
            }}
          />
        ) : (
          // A newer summary (asked again since) fades in rather than swapping in one frame.
          <LayoutAnimationConfig skipEntering>
            <Animated.View key={text} entering={arrive}>
              <Txt variant="callout">{text}</Txt>
            </Animated.View>
          </LayoutAnimationConfig>
        )}
        {phase === "done" && text !== null && steps.length ? (
          <Animated.View entering={seen ? undefined : riseIn} style={[styles.steps, { borderTopColor: colors.hairline }]}>
            {steps.map((step, i) => (
              <View key={i} style={styles.step}>
                <View style={styles.rail}>
                  <View style={[styles.stepDot, { backgroundColor: i === steps.length - 1 ? accent.solid : colors.line }]} />
                  {i < steps.length - 1 ? <View style={[styles.stepLine, { backgroundColor: colors.line }]} /> : null}
                </View>
                <View style={styles.flex}>
                  <Txt variant="footnote" tone="ink3">
                    {step.when}
                  </Txt>
                  <Txt variant="subhead">{step.text}</Txt>
                </View>
              </View>
            ))}
          </Animated.View>
        ) : null}
      </View>
    </Animated.View>
  );
}

function summarise(task: Task, history: FocusHistory | undefined, notes: Note[]): { text: string; steps: { when: string; text: string }[] } | null {
  if (!notes.length && !(history && history.sessions)) return null;
  const t = today();
  const written: Record<string, { text: string; steps: { when: string; text: string }[] }> = {
    "Send the brief to Ana": {
      text: "The outline is done and the budget section is next. A thought you parked asks whether the quote includes VAT, which would move the budget line, so check that first. Your note on the quarter says to keep it short, with the budget up front.",
      steps: [
        { when: shortDate(addDays(t, -1)), text: "Decided: short, with the budget up front" },
        { when: shortDate(addDays(t, -1)), text: "Outlined the brief in a focus session" },
        { when: "Today", text: "Parked a question: does the quote include VAT?" },
      ],
    },
    "Renew the passport": {
      text: "You gave it ten minutes and got stuck on which form is the right one. The photo isn't the problem: the booth at the station takes cards now. Finding the form is the first small step.",
      steps: [{ when: shortDate(addDays(t, -3)), text: "Got stuck choosing the form" }],
    },
    "Call Mum back": {
      text: "It came from this morning's page. Your notes from the last call say she's thinking about the move again, and to listen first rather than fix.",
      steps: [
        { when: shortDate(addDays(t, -2)), text: "Noted: listen first; don't fix" },
        { when: "Today", text: "Planned the call for before seven" },
      ],
    },
    "Finish the editor spec": {
      text: "Finished this morning, in two focus sessions. It was the first of three things that would make today feel well spent.",
      steps: [
        { when: "Today", text: "Worked on the spec in focus" },
        { when: "Today", text: "Finished it" },
      ],
    },
  };
  if (written[task.title]) return written[task.title];
  const parts: string[] = [];
  if (notes.length) parts.push(notes.length === 1 ? `It came from “${notes[0].title}”.` : `It's linked to “${notes[0].title}” and other notes.`);
  if (history && history.sessions) {
    parts.push(`You've spent ${durationLabel(history.minutes)} on it in focus.`);
    if (history.leftOff) parts.push(history.outcome === "stuck" ? `Last time you got stuck: “${history.leftOff}”` : `Last time you left off at: “${history.leftOff}”`);
  }
  const steps = notes.map((note) => ({ when: noteGroup(note.day), text: note.title }));
  if (history?.lastAt) steps.push({ when: sinceLabel(history.lastAt).replace(/^on /, ""), text: history.outcome === "finished" ? "Finished it in focus" : "Worked on it in focus" });
  return { text: parts.join(" "), steps: steps.slice(-6) };
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  flex: { flex: 1 },
  missing: { flex: 1, alignItems: "center", justifyContent: "center", gap: space[4], padding: edge },
  top: { flexDirection: "row", alignItems: "center", paddingHorizontal: edge - 10, height: undefined, paddingBottom: space[1] },
  topTitle: { flex: 1, textAlign: "center" },
  topSide: { width: 44 },
  titleCard: { flexDirection: "row", alignItems: "flex-start", gap: space[3], paddingLeft: pad, paddingRight: pad - 6, paddingVertical: 14 },
  title: { flex: 1, padding: 0, margin: 0, outlineWidth: 0 },
  check: { marginTop: -2 },
  detailsCard: { marginTop: space[3], paddingHorizontal: pad, paddingVertical: 14, minHeight: 92 },
  details: { padding: 0, margin: 0, outlineWidth: 0 },
  group: { marginTop: space[3] },
  row: { flexDirection: "row", alignItems: "center", gap: space[3], paddingVertical: 15 },
  slot: { width: 24, alignItems: "center", justifyContent: "center" },
  value: { maxWidth: "50%" },
  focus: { marginTop: space[3], gap: space[3] },
  leftOff: { padding: pad, gap: 6 },
  focusButton: { marginHorizontal: edge },
  reflection: { marginHorizontal: edge, borderRadius: radius.card, borderCurve: "continuous", padding: pad, gap: space[4] },
  reading: { paddingVertical: space[2] },
  steps: { borderTopWidth: 1, paddingTop: space[4] },
  step: { flexDirection: "row", gap: space[3] },
  rail: { width: 10, alignItems: "center" },
  stepDot: { width: 8, height: 8, borderRadius: 4, marginTop: 5 },
  stepLine: { width: 1.5, flex: 1, marginTop: 4, marginBottom: -2, minHeight: 22 },
  notes: { gap: space[3] },
  linkWrap: { marginHorizontal: edge, marginTop: space[3] },
  footer: { paddingHorizontal: edge, marginTop: space[10], gap: space[4] },
  deleteWrap: { alignItems: "stretch" },
  ask: { gap: space[3] },
  deleteButton: { alignSelf: "center" },
});
