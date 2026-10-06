import { useLocalSearchParams, useNavigation, useRouter } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Alert, AppState, Pressable, ScrollView, StyleSheet, TextInput, View } from "react-native";
import Animated, { cancelAnimation, LayoutAnimationConfig, useAnimatedStyle, useReducedMotion, useSharedValue, withRepeat, withTiming } from "react-native-reanimated";
import { KeyboardController, useKeyboardHandler, useReanimatedKeyboardAnimation } from "react-native-keyboard-controller";
import { scheduleOnRN } from "react-native-worklets";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { deeper, deeperFallback, questions } from "../../src/data/prompts";
import { useNote } from "../../src/data/hooks";
import { useDataMode, useSage } from "../../src/data/sage";
import { useQuietSyncNotices } from "../../src/data/quiet";
import { useAiReady } from "../../src/data/ai";
import { blocksOf } from "../../src/data/adapt";
import { NO_SEED_YET, type NoteEditorHandle } from "../../src/editor/bridge";
import { useEditorLook } from "../../src/editor/look";
import { NoteEditorView } from "../../src/editor/NoteEditorView";
import type { EditorCommand, EditorFormats } from "../../src/editor/protocol";
import { questionPage, useAccountNoteSession, useDemoNoteSession, type NoteParams, type NoteSession } from "../../src/editor/useNoteSession";
import { useDeeperQuestions, useWritingHelp, type WordIdea } from "../../src/editor/useWritingHelp";
import { longDay, today } from "../../src/lib/dates";
import { noteTime } from "../../src/store/selectors";
import type { Block } from "../../src/store/model";
import { arrive, breathe, duration, easeOut, fadeTiming, leave as fadeOut, riseIn, settle } from "../../src/theme/motion";
import { useTheme } from "../../src/theme/ThemeProvider";
import { edge, pad, radius, space } from "../../src/theme/tokens";
import { useAcknowledge } from "../../src/ui/Acknowledgement";
import { AskInPlace } from "../../src/ui/AskInPlace";
import { Button, ButtonPair, type ButtonState } from "../../src/ui/Button";
import { CircleCheck } from "../../src/ui/CircleCheck";
import { done as doneHaptic, tap, tick } from "../../src/ui/haptics";
import { Icon, type IconName } from "../../src/ui/Icon";
import { IconButton } from "../../src/ui/IconButton";
import { PressableScale } from "../../src/ui/PressableScale";
import { Roll } from "../../src/ui/Roll";
import { ThinkingDots } from "../../src/ui/Thinking";
import { Txt, useType } from "../../src/ui/Txt";
import { WORD_STRIP_HEIGHT, WordStrip } from "../../src/ui/WordStrip";

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

/** The tools' row on the keyboard: one 44-point button high, with a little room. */
const TOOLS_HEIGHT = 48;
/** A new page whose keyboard never comes up (a hardware keyboard, say) shows its buttons after this. */
const HOLD_LIMIT_MS = 1_200;

type PageProps = { id: string; prompt?: string; page: boolean };

/**
 * A note is a white page, like Rosebud's writing screen: the area as a
 * small chip at the top, the date in small capitals, the title, then the
 * words, rich (the editor page, built into the app). A question stands in
 * the accent as a quote, with the answer under it; "Next question" adds
 * another. On a note you've written, "Go deeper" offers a question about it.
 * Writing, the tools ride on the keyboard; otherwise two buttons: the
 * note's tasks, and Done, which turns into a check as the page closes.
 * Both are always there and follow the keyboard's own motion: the tools
 * rise with it, and the buttons fade as it covers them.
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

  const note = useNote(session.noteId ?? (isNew ? undefined : id));
  const draftArea = useSage((state) => state.draftArea);
  const setDraftArea = useSage((state) => state.setDraftArea);
  const archiveNote = useSage((state) => state.archiveNote);
  const deleteNote = useSage((state) => state.deleteNote);
  const area = note ? note.area : draftArea;

  // A new page starts with no area of its own, from its first frame (the last page's never shows).
  useLayoutEffect(() => {
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
  // Go deeper's place: kept here, so the keyboard coming up and going doesn't reset it or bring back what was put away.
  const [deeperMemory, rememberDeeper] = useState<DeeperMemory>({ n: 0, open: true, askedAbout: null });
  // A page opened from Today's question: "Next question" asks another.
  const [guided, setGuided] = useState(isNew && !!prompt);
  // Its row of question tools keeps its place for the visit (see QuestionRow).
  const [askedAtOpen] = useState(isNew && !!prompt);
  // A new page's time is when it was opened, there from the start (the note itself is made a moment later).
  const [openedAt] = useState(() => {
    const now = new Date();
    return `${now.getHours()}:${String(now.getMinutes()).padStart(2, "0")}`;
  });

  const sessionRef = useRef(session);
  sessionRef.current = session;
  // How long the words take to show, in the development build's log: whether
  // an editor prepared ahead would be worth it is measured on the phone first.
  const openedMs = useRef(Date.now());

  // Word help and the AI's questions, with AI help on (see useWritingHelp).
  const demo = useDataMode((state) => state.mode) === "demo";
  const aiReady = useAiReady();
  const help = useWritingHelp({ noteId: session.noteId, title: session.title, seed: session.seed.markdown, writing: focused, demo, aiReady });
  const helpRef = useRef(help);
  helpRef.current = help;

  // —— The keyboard ——
  // The keyboard as it moves, frame by frame on its own curve: how far up it
  // is (0 to 1) and how high (negative, upwards).
  const keyboard = useReanimatedKeyboardAnimation();
  // Where it's heading: up as soon as it starts to come, down as soon as it starts to go.
  const [keyboardUp, setKeyboardUp] = useState(() => KeyboardController.isVisible());
  // The tools belong to the words: they come up with the keyboard when it's
  // for the words (not the title), and go down with it.
  const toolsOn = useSharedValue(0);
  useKeyboardHandler(
    {
      onStart: (event) => {
        "worklet";
        scheduleOnRN(setKeyboardUp, event.height > 0);
      },
      onEnd: (event) => {
        "worklet";
        if (event.height === 0) toolsOn.value = 0;
      },
    },
    [],
  );
  // The web build has no keyboard: writing in the words counts as up.
  const web = process.env.EXPO_OS === "web";
  const webUp = useSharedValue(0);
  useEffect(() => {
    if (web) webUp.value = withTiming(focused ? 1 : 0, fadeTiming(focused ? duration.base : duration.quick));
  }, [web, focused, webUp]);
  const progress = web ? webUp : keyboard.progress;
  const up = web ? focused : keyboardUp;

  // A new page opens to write: the keyboard comes up as the words arrive, so
  // the buttons under them wait instead of showing for a moment first. They
  // come once the keyboard first goes down (or if it never comes up).
  const [held, setHeld] = useState(isNew);
  const wasUp = useRef(false);
  useEffect(() => {
    if (!held) return;
    if (up) {
      wasUp.current = true;
      return;
    }
    if (wasUp.current || failed) {
      setHeld(false);
      return;
    }
    if (!shown) return;
    const timer = setTimeout(() => setHeld(false), HOLD_LIMIT_MS);
    return () => clearTimeout(timer);
  }, [held, up, shown, failed]);
  const blockOn = useSharedValue(isNew ? 0 : 1);
  useEffect(() => {
    if (!held) blockOn.value = withTiming(1, fadeTiming(duration.base));
  }, [held, blockOn]);

  // What's under the words while reading (Go deeper, the buttons): measured,
  // so the words end where it begins. It fades as the keyboard covers it.
  const blockRoom = useSharedValue(0);
  const blockMeasured = useRef(false);
  const blockStyle = useAnimatedStyle(() => ({ opacity: blockOn.value * (1 - progress.value) }));
  // The tools ride on the keyboard (as KeyboardStickyView does), fading in as it rises.
  const toolsStyle = useAnimatedStyle(() => ({ opacity: toolsOn.value * progress.value, transform: [{ translateY: keyboard.height.value }] }));
  // The words end above whichever is higher: what's under them, or the tools on the keyboard.
  const roomStyle = useAnimatedStyle(() => ({ paddingBottom: Math.max(blockRoom.value, -keyboard.height.value + TOOLS_HEIGHT * progress.value) }));
  const blockLive = !up && !held;
  const toolsLive = up && focused;

  // With word help on, its strip's room is kept at the bottom of the words
  // while writing: the editor keeps the line being written above it, so
  // nothing moves when the strip comes or goes. The strip lies over the words.
  useEffect(() => {
    editor.current?.run("inset", String(focused && aiReady ? WORD_STRIP_HEIGHT : 0));
  }, [focused, aiReady]);
  // The words as the editor last sent them.
  const textRef = useRef<string | null>(null);

  // The note couldn't be found (deleted elsewhere, or never on this phone).
  useEffect(() => {
    if (!session.missing) return;
    acknowledge("This note isn't on this phone yet");
    router.back();
  }, [session.missing, acknowledge, router]);

  // The words fade in where they'll stay once the editor has drawn them (in
  // Sage's face, see editor/main.ts), as the lines standing in for them fade
  // out. Nothing moves: words being read don't slide.
  const reveal = useSharedValue(0);
  useEffect(() => {
    reveal.value = shown ? withTiming(1, fadeTiming(duration.base)) : 0;
  }, [shown, reveal]);
  const revealStyle = useAnimatedStyle(() => ({ opacity: reveal.value }));

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
    textRef.current = markdown;
    sessionRef.current.change(markdown, doc);
    helpRef.current.onText(markdown);
    // The last words, sent as the app went to the background: saved now too.
    if (AppState.currentState !== "active") sessionRef.current.saveNow();
  }, []);

  // The AI's questions about what's been written, if it has any; otherwise Sage's own for the time of day.
  const nextQuestion = () => {
    const seen = asked.list();
    const fromAi = help.questions.find((question) => !seen.includes(question));
    if (fromAi) return fromAi;
    const pool = [...questions[phase], ...deeperFallback];
    return pool.find((question) => !seen.includes(question)) ?? pool[seen.length % pool.length];
  };

  const takeWords = (word: WordIdea) => {
    const fitted = help.take(word);
    if (!fitted) return;
    tick();
    editor.current?.run("insertText", JSON.stringify(fitted));
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

  // What Go deeper asks the AI about: the note as it stands when asked.
  const noteText = () => textRef.current ?? session.seed.markdown;

  const meta = (isNew ? `${longDay(today())} · ${noteTime(openedAt)}` : note ? `${longDay(note.day)} · ${noteTime(note.time)}` : longDay(today())).toUpperCase();
  const fresh = isNew && !session.written;

  return (
    <View style={[styles.screen, { backgroundColor: colors.card }]}>
      {/* Drawn as the page opens; ⋯ fades in when a new note is first saved. */}
      <LayoutAnimationConfig skipEntering>
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
            <Animated.View entering={arrive} testID="note-more">
              <IconButton
                icon="more"
                label={menu ? "Close the note's menu" : "More: archive or delete this note"}
                onPress={() => {
                  tick();
                  setMenu((open) => !open);
                }}
              />
            </Animated.View>
          ) : null}
        </View>
      </LayoutAnimationConfig>

      <View style={styles.head}>
        <Txt variant="eyebrow" tone="ink3" testID="note-meta">
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
          onFocus={() => {
            setMenu(false);
            // The keyboard is for the title now: the tools aren't.
            toolsOn.value = withTiming(0, fadeTiming(duration.quick));
          }}
          style={[titleType, styles.title, styles.field, { color: colors.ink }]}
          accessibilityLabel="Title"
        />
        {askedAtOpen ? <QuestionRow on={fresh && guided} onAnother={anotherFirst} onWithout={withoutQuestion} /> : null}
      </View>

      <Animated.View style={[styles.flex, roomStyle]} testID="note-words">
        {!failed ? (
          <Animated.View style={[styles.flex, revealStyle]}>
            {/* There as the page opens, so the editor starts while the note is read; it takes the note once it's there. */}
            <NoteEditorView
              key={attempt}
              ref={editor}
              look={look}
              seed={session.loaded ? session.seed : NO_SEED_YET}
              onChange={onChange}
              onFormats={setFormats}
              onCursor={help.onCursor}
              onFocusChange={(next) => {
                setFocused(next);
                if (!next) return;
                setMenu(false);
                toolsOn.value = withTiming(1, fadeTiming(duration.quick));
              }}
              onTicked={(on) => (on ? doneHaptic() : tick())}
              onShown={() => {
                setShown(true);
                if (__DEV__) console.log(`[note] ${isNew ? "new page" : "note"} shown ${Date.now() - openedMs.current} ms after opening`);
              }}
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
      </Animated.View>

      {/* Under the words while reading. Always there: the keyboard covers it as it fades, and it comes back as the keyboard goes. */}
      <Animated.View
        layout={settle}
        onLayout={(event) => {
          const height = event.nativeEvent.layout.height;
          // Its size changing (Go deeper put away, a longer question): the words follow its edge.
          blockRoom.value = blockMeasured.current ? withTiming(height, { duration: duration.enter, easing: easeOut }) : height;
          blockMeasured.current = true;
        }}
        pointerEvents={blockLive ? "box-none" : "none"}
        aria-hidden={!blockLive}
        testID="note-bottom"
        style={[styles.bottom, { backgroundColor: colors.card, borderTopColor: colors.hairline, paddingBottom: Math.max(insets.bottom, space[3]) }, blockStyle]}
      >
        {/* On a note with words, new ones too once written. A page answering Today's question has Next question instead. */}
        {session.noteId && session.written && !guided && !failed ? (
          <GoDeeper
            noteId={session.noteId}
            title={session.title}
            text={noteText}
            visit={help.questions}
            asked={asked.list()}
            memory={deeperMemory}
            remember={rememberDeeper}
            onAdd={(question) => {
              asked.add(question);
              editor.current?.run("insertQuestion", JSON.stringify({ text: question, atEnd: true }));
            }}
          />
        ) : null}
        <Animated.View layout={settle}>
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
        </Animated.View>
      </Animated.View>

      {/* The tools, riding on the keyboard while writing the words; word help's strip lies above them, over the words. */}
      <Animated.View
        pointerEvents={toolsLive ? "box-none" : "none"}
        aria-hidden={!toolsLive}
        testID="note-tools"
        style={[styles.dock, toolsStyle]}
      >
        {focused && help.strip ? <WordStrip words={help.strip} onTake={takeWords} /> : null}
        <View style={[styles.toolbar, { backgroundColor: colors.card, borderTopColor: colors.hairline }]}>
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
            onPress={() => {
              tick();
              editor.current?.run("blur");
            }}
            accessibilityRole="button"
            accessibilityLabel="Put the keyboard away"
            style={({ pressed }) => [styles.tool, { opacity: pressed ? 0.5 : 1 }]}
          >
            <Icon name="keyboardDown" size={20} color={colors.ink3} weight="medium" />
          </Pressable>
        </View>
      </Animated.View>

      {/* Over everything, last: a tap anywhere outside closes it. */}
      {menu && session.noteId ? (
        <>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setMenu(false)} accessible={false} />
          <Animated.View entering={riseIn} exiting={fadeOut} testID="note-menu" style={[styles.menu, { top: insets.top + 48, backgroundColor: colors.raised, boxShadow: colors.shadow }]}>
            <Button label="Archive" icon="archive" variant="outline" size="md" onPress={archive} accessibilityLabel="Archive this note" />
            <AskInPlace label="Delete" icon="trash" variant="outline" danger steps={[{ question: "Delete this note? It can't be undone.", confirm: "Delete", icon: "trash" }]} onConfirm={remove} />
          </Animated.View>
        </>
      ) : null}
    </View>
  );
}

/**
 * Another question, or none, on a page answering Today's question, while it
 * isn't written on. The row keeps its place for the visit: once there are
 * words its icons fade, and the words under them never move up.
 */
function QuestionRow({ on, onAnother, onWithout }: { on: boolean; onAnother: () => void; onWithout: () => void }) {
  const shown = useSharedValue(on ? 1 : 0);
  useEffect(() => {
    shown.value = withTiming(on ? 1 : 0, fadeTiming(on ? duration.base : duration.quick));
  }, [on, shown]);
  const style = useAnimatedStyle(() => ({ opacity: shown.value }));
  return (
    <Animated.View
      pointerEvents={on ? "auto" : "none"}
      aria-hidden={!on}
      testID="question-row"
      style={[styles.questionTools, style]}
    >
      <QuestionTool icon="another" label="Another question" onPress={onAnother} />
      <QuestionTool icon="close" label="Write without a question" onPress={onWithout} />
    </Animated.View>
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
 * visit. With AI help on: the AI's questions about what was just written, if
 * word help asked while writing (no extra ask); otherwise Sage's own first,
 * and the AI is asked about the whole note only when another question is
 * wanted (once per version of the note), so opening a note to read costs
 * nothing.
 */
/** Go deeper's place on a visit: which question, whether it was put away, what the AI was asked about. */
type DeeperMemory = { n: number; open: boolean; askedAbout: string | null };

function GoDeeper({
  noteId,
  title,
  text,
  visit,
  asked,
  memory,
  remember,
  onAdd,
}: {
  noteId: string;
  title: string;
  text: () => string;
  visit: string[];
  asked: string[];
  memory: DeeperMemory;
  remember: React.Dispatch<React.SetStateAction<DeeperMemory>>;
  onAdd: (question: string) => void;
}) {
  const { colors } = useTheme();
  const demo = useDataMode((state) => state.mode) === "demo";
  const aiReady = useAiReady();
  const promptType = useType("prompt");
  // `askedAbout`: the note as it stood when another question was wanted (null: not asked).
  const { n, open, askedAbout } = memory;
  const askAi = askedAbout !== null;
  const canAsk = !demo && aiReady && visit.length === 0;
  const fromNote = useDeeperQuestions({ noteId, title, markdown: askedAbout ?? "", enabled: canAsk && askAi });
  if (!open) return null;
  const own = demo ? (deeper[noteId] ?? deeperFallback) : deeperFallback;
  const ai = visit.length ? visit : (fromNote ?? null);
  const fresh = (ai ?? own).filter((question) => !asked.includes(question));
  const pool = fresh.length ? fresh : own;
  // The AI couldn't answer: Sage's next question, not the one already seen.
  const offset = askAi && !ai ? 1 : 0;
  // Asking: the card stays, reading, at its usual size.
  const question = askAi && fromNote === undefined ? null : pool[(n + offset) % pool.length];
  const more = question !== null && (pool.length > 1 || (canAsk && !askAi));
  const another = () => {
    tick();
    if (canAsk && !askAi && !ai) {
      remember((m) => ({ ...m, askedAbout: text(), n: 0 }));
      return;
    }
    remember((m) => ({ ...m, n: m.n + 1 }));
  };
  return (
    <Animated.View entering={arrive} exiting={fadeOut} layout={settle} style={[styles.deeper, { backgroundColor: colors.sunken }]}>
      <View style={styles.deeperHead}>
        <Icon name="idea" size={16} color={colors.ink3} weight="semibold" />
        <Txt variant="footnote" tone="ink3" weight="semibold" style={styles.flex}>
          Go deeper
        </Txt>
        {more ? (
          <Animated.View entering={arrive} exiting={fadeOut}>
          <Pressable
            onPress={another}
            accessibilityRole="button"
            accessibilityLabel="Another question"
            hitSlop={10}
          >
            {({ pressed }) => <Icon name="another" size={16} color={pressed ? colors.ink3 : colors.ink2} weight="semibold" />}
          </Pressable>
          </Animated.View>
        ) : null}
      </View>
      <View style={[styles.deeperQuestion, { minHeight: promptType.lineHeight * 2 }]}>
        {/* Reading, then the question: one fades into the other (they swapped in one frame), and the card grows for a longer one. */}
        {question === null ? (
          <Animated.View key="reading" entering={arrive} exiting={fadeOut}>
            <ThinkingDots />
          </Animated.View>
        ) : (
          <Animated.View key="question" entering={askedAbout !== null ? arrive : undefined}>
            <Roll value={question} variant="prompt" color={colors.ink} />
          </Animated.View>
        )}
      </View>
      <ButtonPair style={styles.deeperButtons}>
        <Button label="Not now" variant="outline" size="sm" flex onPress={() => (tick(), remember((m) => ({ ...m, open: false })))} />
        <Button
          label="Add to note"
          icon="plus"
          variant="soft"
          size="sm"
          flex
          disabled={question === null}
          onPress={() => {
            if (question === null) return;
            tick();
            onAdd(question);
            remember((m) => ({ ...m, open: false }));
          }}
        />
      </ButtonPair>
    </Animated.View>
  );
}

/** While the editor page starts: three quiet lines where the words will be, breathing slowly as the lists' placeholders do (resting under Reduce Motion). */
function WordsLoading() {
  const { colors } = useTheme();
  const reduced = useReducedMotion();
  const glow = useSharedValue(1);
  useEffect(() => {
    if (reduced) return;
    glow.value = withRepeat(withTiming(0.55, { duration: duration.breath, easing: breathe }), -1, true);
    return () => cancelAnimation(glow);
  }, [glow, reduced]);
  const pulse = useAnimatedStyle(() => ({ opacity: glow.value }));
  return (
    <Animated.View exiting={fadeOut} style={styles.loading} pointerEvents="none" accessibilityLabel="Opening the note" accessibilityRole="progressbar">
      <Animated.View style={[styles.loadingLines, pulse]}>
        {[1, 0.92, 0.6].map((width, i) => (
          <View key={i} style={[styles.loadingLine, { width: `${width * 100}%`, backgroundColor: colors.sunken }]} />
        ))}
      </Animated.View>
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
  menu: { position: "absolute", right: edge, left: edge, borderRadius: radius.card, borderCurve: "continuous", padding: pad, gap: space[2] },
  head: { paddingHorizontal: edge + 4, paddingTop: space[3], gap: space[1] },
  title: { marginTop: space[1], marginBottom: space[1] },
  field: { padding: 0, margin: 0, outlineWidth: 0 },
  questionTools: { flexDirection: "row", gap: space[4], paddingBottom: space[1] },
  qtool: { paddingVertical: 2 },
  dock: { position: "absolute", left: 0, right: 0, bottom: 0 },
  toolbar: { flexDirection: "row", alignItems: "center", height: TOOLS_HEIGHT, borderTopWidth: StyleSheet.hairlineWidth, paddingHorizontal: edge - 10 },
  tools: { alignItems: "center", gap: 2 },
  tool: { width: 44, height: 44, alignItems: "center", justifyContent: "center", borderRadius: radius.button, borderCurve: "continuous" },
  rule: { width: StyleSheet.hairlineWidth, height: 24, marginHorizontal: 4 },
  bottom: { position: "absolute", left: 0, right: 0, bottom: 0, borderTopWidth: StyleSheet.hairlineWidth, paddingHorizontal: edge, paddingTop: space[2], gap: space[2] },
  buttons: {},
  deeper: { borderRadius: radius.card, borderCurve: "continuous", padding: pad, gap: space[2] },
  deeperHead: { flexDirection: "row", alignItems: "center", gap: 6 },
  deeperButtons: { marginTop: space[1] },
  deeperQuestion: { justifyContent: "center" },
  loading: { position: "absolute", top: 6, left: edge + 4, right: edge + 4 },
  loadingLines: { gap: 12 },
  loadingLine: { height: 14, borderRadius: 7 },
  readOnly: { paddingHorizontal: edge + 4, paddingTop: space[1], paddingBottom: space[12], gap: space[4] },
  readOnlyNote: { flexDirection: "row", alignItems: "center", gap: 6 },
  check: { flexDirection: "row", alignItems: "flex-start", gap: space[3], paddingVertical: 2 },
  struck: { textDecorationLine: "line-through" },
  quote: { borderLeftWidth: 3, paddingLeft: space[4], marginVertical: space[1] },
});
