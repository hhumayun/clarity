import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
import { KeyboardAvoidingView, Pressable, ScrollView, StyleSheet, TextInput, View } from "react-native";
import Animated, { FadeInDown, FadeOut, LinearTransition } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { deeper, deeperFallback, questions } from "../../src/data/prompts";
import { longDay, today } from "../../src/lib/dates";
import { useNote } from "../../src/data/hooks";
import type { Block } from "../../src/store/model";
import { noteTime } from "../../src/store/selectors";
import { useSage } from "../../src/data/sage";
import { duration, easeOut } from "../../src/theme/motion";
import { useTheme } from "../../src/theme/ThemeProvider";
import { edge, pad, radius, space } from "../../src/theme/tokens";
import { useAcknowledge } from "../../src/ui/Acknowledgement";
import { Button, ButtonPair, type ButtonState } from "../../src/ui/Button";
import { CircleCheck } from "../../src/ui/CircleCheck";
import { done as doneHaptic, tap, tick } from "../../src/ui/haptics";
import { Icon, type IconName } from "../../src/ui/Icon";
import { IconButton } from "../../src/ui/IconButton";
import { PressableScale } from "../../src/ui/PressableScale";
import { Roll } from "../../src/ui/Roll";
import { Txt, useType } from "../../src/ui/Txt";

const TOOLS: { icon: IconName; label: string }[] = [
  { icon: "format", label: "Text styles" },
  { icon: "checklist", label: "Checklist" },
  { icon: "list", label: "Bulleted list" },
  { icon: "link", label: "Link" },
  { icon: "image", label: "Photo" },
];
const settle = LinearTransition.duration(duration.enter).easing(easeOut);

type Segment = { key: number; question: string | null };

/**
 * A note is a white page, like Rosebud's writing screen: the area as a
 * small chip at the top, the date in small capitals, the title, then the
 * words. A question you're writing to stands in the accent above your
 * answer; "Next question" adds another under it, so a page can be written
 * one question at a time. On a note you've written, "Go deeper" offers a
 * question about it, which can join the note. At the bottom: the tools,
 * then two buttons (the note's tasks, and Done, which turns into a check
 * as the page closes).
 */
export default function NoteScreen() {
  const { id, prompt, page } = useLocalSearchParams<{ id: string; prompt?: string; page?: string }>();
  const { colors, accent, phase } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const acknowledge = useAcknowledge();
  const note = useNote(id === "new" ? undefined : id);
  const isNew = !note;
  const addNote = useSage((state) => state.addNote);
  const draftArea = useSage((state) => state.draftArea);
  const setDraftArea = useSage((state) => state.setDraftArea);
  const titleType = useType("title1");
  const bodyType = useType("body");
  const scroller = useRef<ScrollView>(null);
  const [state, setState] = useState<ButtonState>("idle");

  // A new page starts with no area of its own.
  useEffect(() => {
    if (isNew) setDraftArea(null);
  }, [isNew, setDraftArea]);

  // Uncontrolled: typing never re-renders the page.
  const title = useRef("");
  const answers = useRef<Record<number, string>>({});
  const asked = useRef(prompt ? [prompt] : []);
  const [segments, setSegments] = useState<Segment[]>([{ key: 0, question: prompt ?? null }]);
  const nextQuestion = () => {
    const pool = [...questions[phase], ...deeperFallback];
    const fresh = pool.find((q) => !asked.current.includes(q)) ?? pool[asked.current.length % pool.length];
    asked.current.push(fresh);
    return fresh;
  };

  const area = note ? note.area : draftArea;
  const written = () => title.current.trim() || Object.values(answers.current).some((text) => text.trim());

  const finish = () => {
    if (state !== "idle") return;
    doneHaptic();
    setState("done");
    const saved = !!note || (isNew && !!written());
    if (isNew && written()) {
      addNote({
        title: title.current,
        segments: segments.map((segment) => ({ question: segment.question, answer: answers.current[segment.key] ?? "" })),
        area,
        page: page === "1",
      });
    }
    setTimeout(() => {
      router.back();
      if (saved) acknowledge("Saved");
    }, 300);
  };

  const askNext = () => {
    tap();
    setSegments((list) => [...list, { key: list.length, question: nextQuestion() }]);
    setTimeout(() => scroller.current?.scrollToEnd({ animated: true }), 120);
  };

  const anotherFirst = () => {
    tick();
    setSegments((list) => list.map((segment, i) => (i === 0 ? { ...segment, question: nextQuestion() } : segment)));
  };

  const meta = (note ? `${longDay(note.day)} · ${noteTime(note.time)}` : longDay(today())).toUpperCase();
  const guided = isNew && segments.some((segment) => segment.question);

  return (
    <KeyboardAvoidingView behavior={process.env.EXPO_OS === "ios" ? "padding" : undefined} style={[styles.screen, { backgroundColor: colors.card }]}>
      <View style={[styles.top, { paddingTop: insets.top + 2 }]}>
        <IconButton icon="back" label="Back" tone="ink" onPress={() => router.back()} />
        <PressableScale
          onPress={() => router.push(note ? `/sheet/area?note=${note.id}` : "/sheet/area?draft=1")}
          accessibilityRole="button"
          accessibilityLabel={area ? `Area: ${area}. Change` : "Choose an area"}
          scaleTo={0.95}
          style={[styles.chip, { borderColor: colors.line }]}
        >
          <Icon name="tag" size={14} color={colors.ink2} weight="semibold" />
          <Txt variant="subhead" weight="semibold">
            {area ?? "Area"}
          </Txt>
          <Icon name="down" size={12} color={colors.ink2} weight="bold" />
        </PressableScale>
        <View style={styles.flex} />
        {note?.source === "focus" ? (
          <View style={styles.parked}>
            <Icon name="timer" size={14} color={colors.ink3} weight="semibold" />
            <Txt variant="footnote" tone="ink3">
              Parked during focus
            </Txt>
          </View>
        ) : null}
      </View>

      <ScrollView ref={scroller} keyboardDismissMode="interactive" keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        <Txt variant="eyebrow" tone="ink3">
          {meta}
        </Txt>
        {note ? (
          <Txt variant="title1" accessibilityRole="header" style={styles.title}>
            {note.title}
          </Txt>
        ) : (
          <TextInput
            placeholder="Title"
            placeholderTextColor={colors.ink3}
            selectionColor={accent.solid}
            cursorColor={accent.solid}
            onChangeText={(text) => (title.current = text)}
            style={[titleType, styles.title, styles.field, { color: colors.ink }]}
            accessibilityLabel="Title"
          />
        )}

        {note ? (
          <ExistingBody noteId={note.id} blocks={note.blocks?.length ? note.blocks : [{ kind: "p", text: note.excerpt }]} />
        ) : (
          <Animated.View layout={settle} style={styles.segments}>
            {segments.map((segment, i) => (
              <Animated.View key={segment.key} entering={i > 0 ? FadeInDown.duration(duration.enter).easing(easeOut) : undefined} layout={settle} style={styles.segment}>
                {segment.question ? (
                  <View style={styles.question}>
                    <Roll value={segment.question} variant="prompt" color={accent.text} />
                    {i === 0 ? (
                      <View style={styles.questionTools}>
                        <QuestionTool icon="another" label="Another question" onPress={anotherFirst} />
                        <QuestionTool
                          icon="close"
                          label="Write without a question"
                          onPress={() => {
                            tick();
                            setSegments((list) => list.map((item, n) => (n === 0 ? { ...item, question: null } : item)));
                          }}
                        />
                      </View>
                    ) : null}
                  </View>
                ) : null}
                <TextInput
                  autoFocus={i === segments.length - 1}
                  multiline
                  scrollEnabled={false}
                  onChangeText={(text) => (answers.current[segment.key] = text)}
                  placeholder={segment.question ? "Write" : "Write freely. Nothing here has to be finished."}
                  placeholderTextColor={colors.ink3}
                  selectionColor={accent.solid}
                  cursorColor={accent.solid}
                  style={[bodyType, styles.field, styles.answer, { color: colors.ink }]}
                  textAlignVertical="top"
                  accessibilityLabel={segment.question ? `Answer: ${segment.question}` : "Note"}
                />
              </Animated.View>
            ))}
          </Animated.View>
        )}
      </ScrollView>

      <View style={[styles.bottom, { borderTopColor: colors.hairline, paddingBottom: Math.max(insets.bottom, space[3]) }]}>
        <View style={styles.tools}>
          {TOOLS.map((tool) => (
            <Pressable key={tool.icon} onPress={tick} accessibilityRole="button" accessibilityLabel={tool.label} style={({ pressed }) => [styles.tool, { opacity: pressed ? 0.45 : 1 }]}>
              <Icon name={tool.icon} size={21} color={colors.ink2} weight="medium" />
            </Pressable>
          ))}
          <View style={styles.flex} />
          <Pressable onPress={tick} accessibilityRole="button" accessibilityLabel="Dictate" style={({ pressed }) => [styles.tool, { opacity: pressed ? 0.45 : 1 }]}>
            <Icon name="mic" size={21} color={colors.ink2} weight="medium" />
          </Pressable>
        </View>
        <ButtonPair style={styles.buttons}>
          {guided ? (
            <>
              <Button label="Done" variant="outline" size="md" flex state={state} onPress={finish} />
              <Button label="Next question" icon="another" size="md" flex onPress={askNext} disabled={state !== "idle"} />
            </>
          ) : (
            <>
              <Button label="Tasks" icon="checklist" variant="outline" size="md" flex disabled={isNew} onPress={() => note && router.push(`/note-tasks?note=${note.id}`)} accessibilityLabel="This note's tasks" />
              <Button label="Done" icon="check" size="md" flex state={state} onPress={finish} />
            </>
          )}
        </ButtonPair>
      </View>
    </KeyboardAvoidingView>
  );
}

function QuestionTool({ icon, label, onPress }: { icon: IconName; label: string; onPress: () => void }) {
  const { accent } = useTheme();
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} hitSlop={8} style={({ pressed }) => [styles.qtool, { opacity: pressed ? 0.45 : 1 }]}>
      <Icon name={icon} size={18} color={accent.text} weight="semibold" />
    </Pressable>
  );
}

/**
 * A written note's words: paragraphs, checklists you can tick, and quotes,
 * which stand in the accent like a question. "Go deeper" waits at the end.
 */
function ExistingBody({ noteId, blocks }: { noteId: string; blocks: Block[] }) {
  const { colors, accent } = useTheme();
  const bodyType = useType("body");
  const [checks, setChecks] = useState<Record<number, boolean>>({});
  const pool = deeper[noteId] ?? deeperFallback;
  const [n, setN] = useState(0);
  const [offer, setOffer] = useState(true);
  const [added, setAdded] = useState<string[]>([]);
  return (
    <View style={styles.blocks}>
      {blocks.map((block, i) => {
        if (block.kind === "check") {
          const on = checks[i] ?? !!block.done;
          return (
            <Pressable
              key={i}
              onPress={() => {
                if (!on) doneHaptic();
                else tap();
                setChecks((all) => ({ ...all, [i]: !on }));
              }}
              accessibilityRole="checkbox"
              aria-checked={on}
              style={styles.check}
            >
              <CircleCheck on={on} size={24} />
              <Txt variant="body" tone={on ? "ink3" : "ink"} style={[styles.flex, on ? styles.struck : null]}>
                {block.text}
              </Txt>
            </Pressable>
          );
        }
        if (block.kind === "quote") {
          return (
            <View key={i} style={[styles.quote, { borderLeftColor: accent.solid }]}>
              <Txt variant="prompt" tone="accent">
                {block.text}
              </Txt>
            </View>
          );
        }
        return (
          <Txt key={i} variant="body" selectable>
            {block.text}
          </Txt>
        );
      })}

      {added.map((question) => (
        <Animated.View key={question} entering={FadeInDown.duration(duration.enter).easing(easeOut)} style={styles.segment}>
          <Txt variant="prompt" tone="accent">
            {question}
          </Txt>
          <TextInput
            autoFocus
            multiline
            scrollEnabled={false}
            placeholder="Write"
            placeholderTextColor={colors.ink3}
            selectionColor={accent.solid}
            cursorColor={accent.solid}
            style={[bodyType, styles.field, styles.answerShort, { color: colors.ink }]}
            textAlignVertical="top"
            accessibilityLabel={`Answer: ${question}`}
          />
        </Animated.View>
      ))}

      {offer ? (
        <Animated.View layout={settle} exiting={FadeOut.duration(duration.quick)} style={[styles.deeper, { backgroundColor: colors.sunken }]}>
          <View style={styles.deeperHead}>
            <Icon name="idea" size={16} color={colors.ink3} weight="semibold" />
            <Txt variant="footnote" tone="ink3" weight="semibold" style={styles.flex}>
              Go deeper
            </Txt>
            {pool.length > 1 ? (
              <Pressable
                onPress={() => {
                  tick();
                  setN((v) => v + 1);
                }}
                accessibilityRole="button"
                accessibilityLabel="Another question"
                hitSlop={10}
              >
                {({ pressed }) => <Icon name="another" size={16} color={pressed ? colors.ink3 : colors.ink2} weight="semibold" />}
              </Pressable>
            ) : null}
          </View>
          <Roll value={pool[n % pool.length]} variant="prompt" color={colors.ink} />
          <ButtonPair style={styles.deeperButtons}>
            <Button label="Not now" variant="outline" size="sm" flex onPress={() => setOffer(false)} />
            <Button
              label="Add to note"
              icon="plus"
              variant="soft"
              size="sm"
              flex
              onPress={() => {
                tick();
                setAdded((list) => [...list, pool[n % pool.length]]);
                setOffer(false);
              }}
            />
          </ButtonPair>
        </Animated.View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  flex: { flex: 1 },
  top: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: edge - 10, paddingBottom: space[1] },
  chip: { flexDirection: "row", alignItems: "center", gap: 6, height: 36, paddingHorizontal: 14, borderRadius: radius.pill, borderCurve: "continuous", borderWidth: 1.5 },
  parked: { flexDirection: "row", alignItems: "center", gap: 5, marginRight: 10 },
  content: { paddingHorizontal: edge + 4, paddingTop: space[4], paddingBottom: space[12] },
  title: { marginTop: space[2] },
  field: { padding: 0, margin: 0, outlineWidth: 0 },
  segments: { marginTop: space[4], gap: space[6] },
  segment: { gap: space[2] },
  question: { gap: space[2] },
  questionTools: { flexDirection: "row", gap: space[4] },
  qtool: { paddingVertical: 2 },
  answer: { minHeight: 120 },
  answerShort: { minHeight: 60 },
  blocks: { marginTop: space[4], gap: space[4] },
  check: { flexDirection: "row", alignItems: "flex-start", gap: space[3], paddingVertical: 2 },
  struck: { textDecorationLine: "line-through" },
  quote: { borderLeftWidth: 3, paddingLeft: space[4], marginVertical: space[1] },
  deeper: { marginTop: space[6], borderRadius: radius.card, borderCurve: "continuous", padding: pad, gap: space[2] },
  deeperHead: { flexDirection: "row", alignItems: "center", gap: 6 },
  deeperButtons: { marginTop: space[2] },
  bottom: { borderTopWidth: StyleSheet.hairlineWidth, paddingHorizontal: edge, paddingTop: space[1] },
  tools: { flexDirection: "row", alignItems: "center", marginHorizontal: -8 },
  tool: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  buttons: { marginTop: space[1] },
});
