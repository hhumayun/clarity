import { useLocalSearchParams, useNavigation, useRouter } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { Alert, AppState, Pressable, ScrollView, StyleSheet, TextInput, View } from "react-native";
import Animated, { FadeIn, FadeInDown, FadeOut, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { useKeyboardState } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { deeper, deeperFallback, questions } from "../../src/data/prompts";
import { useNote } from "../../src/data/hooks";
import { useDataMode, useSage } from "../../src/data/sage";
import { useQuietSyncNotices } from "../../src/data/quiet";
import { blocksOf } from "../../src/data/adapt";
import type { NoteEditorHandle } from "../../src/editor/bridge";
import { useEditorLook } from "../../src/editor/look";
import { NoteEditorView } from "../../src/editor/NoteEditorView";
import type { EditorCommand, EditorFormats } from "../../src/editor/protocol";
import { questionPage, useAccountNoteSession, useDemoNoteSession, type NoteParams, type NoteSession } from "../../src/editor/useNoteSession";
import { longDay, today } from "../../src/lib/dates";
import { noteTime } from "../../src/store/selectors";
import type { Block } from "../../src/store/model";
import { duration, easeOut } from "../../src/theme/motion";
import { useTheme } from "../../src/theme/ThemeProvider";
import { edge, pad, radius, space } from "../../src/theme/tokens";
import { useAcknowledge } from "../../src/ui/Acknowledgement";
import { AskInPlace } from "../../src/ui/AskInPlace";
import { Button, ButtonPair, type ButtonState } from "../../src/ui/Button";
import { CircleCheck } from "../../src/ui/CircleCheck";
import { GentleKeyboardAvoidingView } from "../../src/ui/GentleKeyboardAvoidingView";
import { done as doneHaptic, tap, tick } from "../../src/ui/haptics";
import { Icon, type IconName } from "../../src/ui/Icon";
import { IconButton } from "../../src/ui/IconButton";
import { PressableScale } from "../../src/ui/PressableScale";
import { Roll } from "../../src/ui/Roll";
import { Txt, useType } from "../../src/ui/Txt";

/** The tools while writing: every one the main app has, in its order. */
const TOOLS: { name: EditorCommand; icon: IconName; label: string; on?: (formats: EditorFormats) => boolean }[] = [
  { name: "task", icon: "checklist", label: "Checklist", on: (f) => f.task },
  { name: "bullet", icon: "list", label: "Bulleted list", on: (f) => f.bullet },
  { name: "ordered", icon: "numbered", label: "Numbered list", on: (f) => f.ordered },
  { name: "indent", icon: "indent", label: "Indent" },
  { name: "outdent", icon: "outdent", label: "Outdent" },
  { name: "bold", icon: "bold", label: "Bold", on: (f) => f.bold },
  { name: "italic", icon: "italic", label: "Italic", on: (f) => f.italic },
  { name: "strike", icon: "strike", label: "Strikethrough", on: (f) => f.strike },
  { name: "heading", icon: "heading", label: "Heading", on: (f) => f.heading },
  { name: "quote", icon: "quote", label: "Quote", on: (f) => f.quote },
  { name: "link", icon: "link", label: "Link", on: (f) => f.link != null },
];

const PLACEHOLDER = "Write freely. Nothing here has to be finished.";

type PageProps = { id: string; prompt?: string; page: boolean };

/**
 * A note is a white page, like Rosebud's writing screen: the area as a
 * small chip at the top, the date in small capitals, the title, then the
 * words, rich (the editor page, built into the app). A question stands in
 * the accent as a quote, with the answer under it; "Next question" adds
 * another. On a note you've written, "Go deeper" offers a question about it.
 * Writing, the tools ride on the keyboard; otherwise two buttons: the
 * note's tasks, and Done, which turns into a check as the page closes.
 */
export default function NoteScreen() {
  const { id, prompt, page } = useLocalSearchParams<{ id: string; prompt?: string; page?: string }>();
  const mode = useDataMode((state) => state.mode);
  const props: PageProps = { id: id ?? "new", prompt: prompt || undefined, page: page === "1" };
  return mode === "account" ? <AccountNote key={`account:${props.id}`} {...props} /> : <DemoNote key={`demo:${props.id}`} {...props} />;
}

/** The questions put on a page so far: a page with only these on it isn't written yet. */
function useAsked(prompt: string | undefined) {
  const list = useRef<string[]>(prompt ? [prompt] : []);
  return { list: () => list.current, add: (question: string) => void list.current.push(question) };
}

function AccountNote(props: PageProps) {
  const asked = useAsked(props.prompt);
  const session = useAccountNoteSession({ ...props, asked: asked.list } satisfies NoteParams);
  return <NotePage {...props} session={session} asked={asked} />;
}

function DemoNote(props: PageProps) {
  const asked = useAsked(props.prompt);
  const session = useDemoNoteSession({ ...props, asked: asked.list } satisfies NoteParams);
  return <NotePage {...props} session={session} asked={asked} />;
}

function NotePage({ id, prompt, page, session, asked }: PageProps & { session: NoteSession; asked: ReturnType<typeof useAsked> }) {
  const isNew = id === "new";
  const { colors, accent, phase } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const navigation = useNavigation();
  const acknowledge = useAcknowledge();
  const titleType = useType("title1");
  const look = useEditorLook(PLACEHOLDER);
  // No word about syncing while writing: saving is quiet here.
  useQuietSyncNotices();
  // With the keyboard up (the title or the words), Tasks and Done stay down.
  const keyboardUp = useKeyboardState((state) => state.isVisible);

  const note = useNote(session.noteId ?? (isNew ? undefined : id));
  const draftArea = useSage((state) => state.draftArea);
  const setDraftArea = useSage((state) => state.setDraftArea);
  const archiveNote = useSage((state) => state.archiveNote);
  const deleteNote = useSage((state) => state.deleteNote);
  const area = note ? note.area : draftArea;

  // A new page starts with no area of its own.
  useEffect(() => {
    if (isNew) setDraftArea(null);
  }, [isNew, setDraftArea]);

  const editor = useRef<NoteEditorHandle>(null);
  const [formats, setFormats] = useState<EditorFormats | null>(null);
  const formatsRef = useRef(formats);
  formatsRef.current = formats;
  const [focused, setFocused] = useState(false);
  const [shown, setShown] = useState(false);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<ButtonState>("idle");
  const [menu, setMenu] = useState(false);
  // A page opened from Today's question: "Next question" asks another.
  const [guided, setGuided] = useState(isNew && !!prompt);

  const sessionRef = useRef(session);
  sessionRef.current = session;

  // The note couldn't be found (deleted elsewhere, or never on this phone).
  useEffect(() => {
    if (!session.missing) return;
    acknowledge("This note isn't on this phone yet");
    router.back();
  }, [session.missing, acknowledge, router]);

  // The words fade in and rise a little once the editor has them.
  const reveal = useSharedValue(0);
  useEffect(() => {
    reveal.value = shown ? withTiming(1, { duration: duration.enter, easing: easeOut }) : 0;
  }, [shown, reveal]);
  const revealStyle = useAnimatedStyle(() => ({ opacity: reveal.value, transform: [{ translateY: (1 - reveal.value) * 8 }] }));

  // Leaving, however it happens (Done, back, the swipe back): words typed in
  // the last moment come over from the editor, and everything is saved.
  const leftRef = useRef(false);
  const leave = useCallback(() => {
    if (leftRef.current) return;
    leftRef.current = true;
    editor.current?.run("flush");
    sessionRef.current.leave();
  }, []);
  const leaveRef = useRef(leave);
  leaveRef.current = leave;
  useEffect(() => navigation.addListener("beforeRemove", () => leaveRef.current()), [navigation]);

  // Going to the background: the editor sends what it hasn't, and it's saved now.
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (next) => {
      if (next === "active") return;
      editor.current?.run("flush");
      sessionRef.current.saveNow();
    });
    return () => subscription.remove();
  }, []);

  const onChange = useCallback((markdown: string, doc: unknown) => {
    sessionRef.current.change(markdown, doc);
    // The last words, sent as the app went to the background: saved now too.
    if (AppState.currentState !== "active") sessionRef.current.saveNow();
  }, []);

  const nextQuestion = () => {
    const pool = [...questions[phase], ...deeperFallback];
    const seen = asked.list();
    return pool.find((question) => !seen.includes(question)) ?? pool[seen.length % pool.length];
  };

  const finish = () => {
    if (state !== "idle") return;
    doneHaptic();
    setState("done");
    leave();
    // The check on Done says it; nothing more about saving.
    setTimeout(() => router.back(), 300);
  };

  const askNext = () => {
    tap();
    const question = nextQuestion();
    asked.add(question);
    setGuided(true);
    editor.current?.run("insertQuestion", JSON.stringify({ text: question, atEnd: true }));
  };

  // On a page not yet written on: another question in its place, or none.
  const anotherFirst = () => {
    tick();
    const question = nextQuestion();
    asked.add(question);
    const start = questionPage(question);
    session.restart(start.markdown, start.doc);
  };
  const withoutQuestion = () => {
    tick();
    setGuided(false);
    session.restart("", null);
  };

  // Links: a web address as typed or pasted. In a link: open, change or take it off.
  const withProtocol = (url: string) => (/^[a-z][a-z0-9+.-]*:/i.test(url) ? url : `https://${url}`);
  const askForLink = (current: string) => {
    const save = (value?: string) => {
      const url = (value ?? "").trim();
      if (url) editor.current?.run("link", withProtocol(url));
    };
    if (process.env.EXPO_OS === "web") {
      save(window.prompt("Type or paste a web address.", current || "https://") ?? undefined);
      return;
    }
    Alert.prompt("Link", "Type or paste a web address.", [{ text: "Cancel", style: "cancel" }, { text: "Save", onPress: save }], "plain-text", current || "https://", "url");
  };
  const onLink = () => {
    const href = formatsRef.current?.link;
    if (href == null) {
      askForLink("");
      return;
    }
    Alert.alert(href || "Link", undefined, [
      { text: "Open", onPress: () => void WebBrowser.openBrowserAsync(withProtocol(href)) },
      { text: "Change", onPress: () => askForLink(href) },
      { text: "Remove", style: "destructive", onPress: () => editor.current?.run("link", "") },
      { text: "Cancel", style: "cancel" },
    ]);
  };

  const archive = () => {
    if (!session.noteId) return;
    tick();
    leave();
    archiveNote(session.noteId);
    router.back();
    acknowledge("Archived");
  };
  const remove = () => {
    if (!session.noteId) return;
    leftRef.current = true;
    session.discard();
    deleteNote(session.noteId);
    router.back();
    acknowledge("Deleted");
  };

  const meta = (note ? `${longDay(note.day)} · ${noteTime(note.time)}` : longDay(today())).toUpperCase();
  const fresh = isNew && !session.written;

  return (
    <View style={[styles.screen, { backgroundColor: colors.card }]}>
      <View style={[styles.top, { paddingTop: insets.top + 2 }]}>
        <IconButton
          icon="back"
          label="Back"
          tone="ink"
          onPress={() => {
            leave();
            router.back();
          }}
        />
        <PressableScale
          onPress={() => router.push(session.noteId && note ? `/sheet/area?note=${session.noteId}` : "/sheet/area?draft=1")}
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
        {session.noteId ? (
          <IconButton
            icon="more"
            label={menu ? "Close the note's menu" : "More: archive or delete this note"}
            onPress={() => {
              tick();
              setMenu((open) => !open);
            }}
          />
        ) : null}
      </View>

      {menu && session.noteId ? (
        <Animated.View entering={FadeInDown.duration(duration.enter).easing(easeOut)} style={[styles.menu, { top: insets.top + 48, backgroundColor: colors.sunken }]}>
          <Button label="Archive" icon="archive" variant="outline" size="md" onPress={archive} accessibilityLabel="Archive this note" />
          <AskInPlace label="Delete" icon="trash" variant="outline" danger steps={[{ question: "Delete this note? It can't be undone.", confirm: "Delete", icon: "trash" }]} onConfirm={remove} />
        </Animated.View>
      ) : null}

      <GentleKeyboardAvoidingView style={styles.flex}>
        <View style={styles.head}>
          <Txt variant="eyebrow" tone="ink3">
            {meta}
          </Txt>
          <TextInput
            value={session.title}
            onChangeText={session.setTitle}
            placeholder="Title"
            placeholderTextColor={colors.ink3}
            selectionColor={accent.solid}
            cursorColor={accent.solid}
            returnKeyType="next"
            submitBehavior="submit"
            onSubmitEditing={() => editor.current?.run("focus")}
            onFocus={() => setMenu(false)}
            style={[titleType, styles.title, styles.field, { color: colors.ink }]}
            accessibilityLabel="Title"
          />
          {fresh && guided ? (
            <Animated.View entering={FadeIn.duration(duration.enter)} exiting={FadeOut.duration(duration.quick)} style={styles.questionTools}>
              <QuestionTool icon="another" label="Another question" onPress={anotherFirst} />
              <QuestionTool icon="close" label="Write without a question" onPress={withoutQuestion} />
            </Animated.View>
          ) : null}
        </View>

        <View style={styles.flex}>
          {session.loaded && !failed ? (
            <Animated.View style={[styles.flex, revealStyle]}>
              <NoteEditorView
                key={attempt}
                ref={editor}
                look={look}
                seed={session.seed}
                onChange={onChange}
                onFormats={setFormats}
                onFocusChange={(next) => {
                  setFocused(next);
                  if (next) setMenu(false);
                }}
                onShown={() => setShown(true)}
                // A slow start is tried once more before the words are shown to read.
                onFailed={() => (attempt === 0 ? setAttempt(1) : setFailed(true))}
              />
            </Animated.View>
          ) : null}
          {failed ? (
            <ReadOnly
              markdown={session.seed.markdown}
              onRetry={() => {
                setFailed(false);
                setShown(false);
                setAttempt((n) => n + 1);
              }}
            />
          ) : null}
          {!shown && !failed ? <WordsLoading /> : null}
        </View>

        {focused ? (
          <View style={[styles.toolbar, { borderTopColor: colors.hairline }]}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="always" contentContainerStyle={styles.tools}>
              {TOOLS.map((tool) => {
                const on = !!(formats && tool.on?.(formats));
                return (
                  <Pressable
                    key={tool.name}
                    onPress={() => {
                      tick();
                      if (tool.name === "link") onLink();
                      else editor.current?.run(tool.name);
                    }}
                    accessibilityRole="button"
                    accessibilityLabel={tool.name === "link" && formats?.link != null ? "Link: open, change or remove" : tool.label}
                    accessibilityState={{ selected: on }}
                    style={({ pressed }) => [styles.tool, on && { backgroundColor: accent.soft }, { opacity: pressed ? 0.5 : 1 }]}
                  >
                    <Icon name={tool.icon} size={20} color={on ? accent.text : colors.ink2} weight="medium" />
                  </Pressable>
                );
              })}
            </ScrollView>
            <View style={[styles.rule, { backgroundColor: colors.hairline }]} />
            {guided ? (
              <Pressable onPress={askNext} accessibilityRole="button" accessibilityLabel="Next question" style={({ pressed }) => [styles.tool, { opacity: pressed ? 0.5 : 1 }]}>
                <Icon name="another" size={20} color={accent.text} weight="semibold" />
              </Pressable>
            ) : null}
            <Pressable
              onPress={() => editor.current?.run("blur")}
              accessibilityRole="button"
              accessibilityLabel="Put the keyboard away"
              style={({ pressed }) => [styles.tool, { opacity: pressed ? 0.5 : 1 }]}
            >
              <Icon name="keyboardDown" size={20} color={colors.ink3} weight="medium" />
            </Pressable>
          </View>
        ) : keyboardUp ? null : (
          <View style={[styles.bottom, { borderTopColor: colors.hairline, paddingBottom: Math.max(insets.bottom, space[3]) }]}>
            {!isNew && session.noteId && shown ? (
              <GoDeeper
                noteId={session.noteId}
                onAdd={(question) => {
                  asked.add(question);
                  editor.current?.run("insertQuestion", JSON.stringify({ text: question, atEnd: true }));
                }}
              />
            ) : null}
            <ButtonPair style={styles.buttons}>
              {guided ? (
                <>
                  <Button label="Done" variant="outline" size="md" flex state={state} onPress={finish} />
                  <Button label="Next question" icon="another" size="md" flex onPress={askNext} disabled={state !== "idle"} />
                </>
              ) : (
                <>
                  <Button
                    label="Tasks"
                    icon="checklist"
                    variant="outline"
                    size="md"
                    flex
                    disabled={!session.noteId}
                    onPress={() => {
                      if (!session.noteId) return;
                      // Its tasks are kept with it on the server: the latest words go first.
                      editor.current?.run("flush");
                      session.saveNow();
                      router.push(`/note-tasks?note=${session.noteId}`);
                    }}
                    accessibilityLabel="This note's tasks"
                  />
                  <Button label="Done" icon="check" size="md" flex state={state} onPress={finish} />
                </>
              )}
            </ButtonPair>
          </View>
        )}
      </GentleKeyboardAvoidingView>
    </View>
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
 * "Go deeper": a question about the note, which can join it at the end, as
 * a quote with room for the answer under it. "Not now" puts it away for this
 * visit.
 */
function GoDeeper({ noteId, onAdd }: { noteId: string; onAdd: (question: string) => void }) {
  const { colors } = useTheme();
  const pool = deeper[noteId] ?? deeperFallback;
  const [n, setN] = useState(0);
  const [open, setOpen] = useState(true);
  if (!open) return null;
  const question = pool[n % pool.length];
  return (
    <Animated.View exiting={FadeOut.duration(duration.quick)} style={[styles.deeper, { backgroundColor: colors.sunken }]}>
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
      <Roll value={question} variant="prompt" color={colors.ink} />
      <ButtonPair style={styles.deeperButtons}>
        <Button label="Not now" variant="outline" size="sm" flex onPress={() => setOpen(false)} />
        <Button
          label="Add to note"
          icon="plus"
          variant="soft"
          size="sm"
          flex
          onPress={() => {
            tick();
            onAdd(question);
            setOpen(false);
          }}
        />
      </ButtonPair>
    </Animated.View>
  );
}

/** While the editor page starts: three quiet lines where the words will be. */
function WordsLoading() {
  const { colors } = useTheme();
  return (
    <Animated.View exiting={FadeOut.duration(duration.quick)} style={styles.loading} pointerEvents="none">
      {[1, 0.92, 0.6].map((width, i) => (
        <View key={i} style={[styles.loadingLine, { width: `${width * 100}%`, backgroundColor: colors.sunken }]} />
      ))}
    </Animated.View>
  );
}

/**
 * The editor didn't start: the note's words to read, as Sage drew them before
 * the editor came, and a way to try again. Nothing here can save, so nothing
 * written is lost.
 */
function ReadOnly({ markdown, onRetry }: { markdown: string; onRetry: () => void }) {
  const { accent } = useTheme();
  const blocks: Block[] = blocksOf(markdown);
  return (
    <ScrollView contentContainerStyle={styles.readOnly}>
      <View style={styles.readOnlyNote}>
        <Icon name="eye" size={14} color={accent.text} weight="semibold" />
        <Txt variant="footnote" tone="ink3" style={styles.flex}>
          Showing this note to read. Editing didn't start.
        </Txt>
        <Pressable onPress={onRetry} accessibilityRole="button" hitSlop={8}>
          <Txt variant="footnote" tone="accent" weight="semibold">
            Try again
          </Txt>
        </Pressable>
      </View>
      {blocks.map((block, i) =>
        block.kind === "check" ? (
          <View key={i} style={styles.check}>
            <CircleCheck on={!!block.done} size={24} />
            <Txt variant="body" tone={block.done ? "ink3" : "ink"} style={[styles.flex, block.done ? styles.struck : null]}>
              {block.text}
            </Txt>
          </View>
        ) : block.kind === "quote" ? (
          <View key={i} style={[styles.quote, { borderLeftColor: accent.solid }]}>
            <Txt variant="prompt" tone="accent">
              {block.text}
            </Txt>
          </View>
        ) : (
          <Txt key={i} variant="body" selectable>
            {block.text}
          </Txt>
        ),
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  flex: { flex: 1 },
  top: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: edge - 10, paddingBottom: space[1] },
  chip: { flexDirection: "row", alignItems: "center", gap: 6, height: 36, paddingHorizontal: 14, borderRadius: radius.pill, borderCurve: "continuous", borderWidth: 1.5 },
  parked: { flexDirection: "row", alignItems: "center", gap: 5, marginRight: 4 },
  menu: { position: "absolute", right: edge, left: edge, zIndex: 10, borderRadius: radius.card, borderCurve: "continuous", padding: pad, gap: space[2] },
  head: { paddingHorizontal: edge + 4, paddingTop: space[3], gap: space[1] },
  title: { marginTop: space[1], marginBottom: space[1] },
  field: { padding: 0, margin: 0, outlineWidth: 0 },
  questionTools: { flexDirection: "row", gap: space[4], paddingBottom: space[1] },
  qtool: { paddingVertical: 2 },
  toolbar: { flexDirection: "row", alignItems: "center", borderTopWidth: StyleSheet.hairlineWidth, paddingHorizontal: edge - 10, paddingVertical: 2 },
  tools: { alignItems: "center", gap: 2 },
  tool: { width: 44, height: 44, alignItems: "center", justifyContent: "center", borderRadius: radius.button, borderCurve: "continuous" },
  rule: { width: StyleSheet.hairlineWidth, height: 24, marginHorizontal: 4 },
  bottom: { borderTopWidth: StyleSheet.hairlineWidth, paddingHorizontal: edge, paddingTop: space[2], gap: space[2] },
  buttons: {},
  deeper: { borderRadius: radius.card, borderCurve: "continuous", padding: pad, gap: space[2] },
  deeperHead: { flexDirection: "row", alignItems: "center", gap: 6 },
  deeperButtons: { marginTop: space[1] },
  loading: { position: "absolute", top: 6, left: edge + 4, right: edge + 4, gap: 12 },
  loadingLine: { height: 14, borderRadius: 7 },
  readOnly: { paddingHorizontal: edge + 4, paddingTop: space[1], paddingBottom: space[12], gap: space[4] },
  readOnlyNote: { flexDirection: "row", alignItems: "center", gap: 6 },
  check: { flexDirection: "row", alignItems: "flex-start", gap: space[3], paddingVertical: 2 },
  struck: { textDecorationLine: "line-through" },
  quote: { borderLeftWidth: 3, paddingLeft: space[4], marginVertical: space[1] },
});
