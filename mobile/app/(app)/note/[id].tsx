import { useLocalSearchParams, useRouter } from "expo-router";
import { ChevronLeft, Mic, RotateCcw, Sparkles } from "lucide-react-native";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import Animated, {
  FadeIn,
  FadeOut,
  LinearTransition,
} from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";
import { getNote, postNoteCreate, postNoteUpdate } from "../../../src/api/notes";
import { useReindexNotes } from "../../../src/hooks/useNotes";
import { useSuggestions } from "../../../src/hooks/useSuggestions";
import { TASKS_ENABLED } from "../../../src/featureFlags";
import { localDrafts } from "../../../src/lib/localDrafts";
import { useAppTheme } from "../../../src/providers/AppThemeProvider";
import { useToast } from "../../../src/providers/ToastProvider";
import { fonts, spacing, type Colors } from "../../../src/theme";
import {
  isCompletionSuggestion,
  type BubbleSuggestion,
} from "../../../src/types";
import { Button } from "../../../src/ui/Button";
import { InlineSuggestions } from "../../../src/ui/InlineSuggestions";
import { NoteTasks } from "../../../src/ui/NoteTasks";
import { ReflectionStrip } from "../../../src/ui/ReflectionStrip";
import { Skeleton } from "../../../src/ui/Skeleton";
import { Segmented } from "../../../src/ui/Segmented";

type SaveStatus = "idle" | "saving" | "saved" | "offline";

const SERVER_SAVE_DELAY_MS = 900;
const REINDEX_DELAY_MS = 4_000;
const UNDO_VISIBLE_MS = 7_000;
// Keeps a comfortable tap target on an empty note; past this the body grows
// with the text so the suggestions sit just under what you wrote.
const MIN_BODY_HEIGHT = 96;
// Short enough to feel like a settle rather than a wait, while writing.
const LAYOUT_MS = 180;

function shouldCapitalize(before: string): boolean {
  const trimmed = before.trimEnd();
  return trimmed.length === 0 || /[.!?]$/.test(trimmed);
}

export default function NoteEditorScreen() {
  const { id: routeId } = useLocalSearchParams<{ id: string }>();
  const isNew = routeId === "new";
  const router = useRouter();
  const toast = useToast();
  const { colors, scale } = useAppTheme();
  const styles = useMemo(() => makeStyles(colors, scale), [colors, scale]);

  const [noteId, setNoteId] = useState<string | null>(isNew ? null : routeId ?? null);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [cursorPos, setCursorPos] = useState(0);
  const [editorTab, setEditorTab] = useState<"note" | "tasks">("note");
  const [suggestionsExpanded, setSuggestionsExpanded] = useState(false);
  const [undoState, setUndoState] = useState<{ text: string; cursor: number } | null>(null);
  const [pendingSelection, setPendingSelection] = useState<number | null>(null);
  const [selection, setSelection] = useState<{ start: number; end: number } | undefined>();
  const [bodyHeight, setBodyHeight] = useState(MIN_BODY_HEIGHT);

  const contentRef = useRef(content);
  contentRef.current = content;
  const titleRef = useRef(title);
  titleRef.current = title;
  const noteIdRef = useRef(noteId);
  noteIdRef.current = noteId;
  const creatingRef = useRef(false);
  const undoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Keyed on the note once it exists, so creating one mid-session moves the
  // draft from "new" to its id without a navigation.
  const draftKey = noteId ?? (isNew ? "new" : (routeId ?? "new"));
  // The key ("new" or a note id) whose text the editor buffer currently holds. Until it
  // matches draftKey the buffer belongs to another note (or to nothing yet), so neither
  // autosave nor persist may write it anywhere.
  const loadedKeyRef = useRef<string | null>(null);
  const reindex = useReindexNotes();
  const reindexRef = useRef(reindex.mutate);
  reindexRef.current = reindex.mutate;
  const routerRef = useRef(router);
  routerRef.current = router;
  const toastRef = useRef(toast);
  toastRef.current = toast;

  useEffect(() => {
    let cancelled = false;

    // Already holding this note's text (e.g. the redirect right after creating it) —
    // re-fetching would discard unsaved edits.
    if (loadedKeyRef.current === draftKey) {
      setLoaded(true);
      return;
    }

    setLoaded(false);
    setUndoState(null);

    const applyDraftOnly = async () => {
      const draft = await localDrafts.load(draftKey);
      if (cancelled) return;
      setNoteId(null);
      noteIdRef.current = null;
      setTitle(draft?.title ?? "");
      setContent(draft?.content ?? "");
      setCursorPos(draft?.content.length ?? 0);
      setStatus("idle");
      loadedKeyRef.current = draftKey;
      setLoaded(true);
    };

    if (isNew) {
      void applyDraftOnly();
      return () => {
        cancelled = true;
      };
    }

    void (async () => {
      try {
        const { note } = await getNote({ id: routeId as string });
        if (cancelled) return;
        const draft = await localDrafts.load(draftKey);
        if (cancelled) return;
        if (draft && draft.at > note.updatedAt.getTime()) {
          setTitle(draft.title);
          setContent(draft.content);
          setCursorPos(draft.content.length);
          setStatus("saving");
        } else {
          setTitle(note.title);
          setContent(note.content);
          setCursorPos(note.content.length);
          setStatus("saved");
        }
        setNoteId(note.id);
        noteIdRef.current = note.id;
        loadedKeyRef.current = draftKey;
        setLoaded(true);
      } catch {
        if (cancelled) return;
        const draft = await localDrafts.load(draftKey);
        if (cancelled) return;
        if (draft) {
          setTitle(draft.title);
          setContent(draft.content);
          setCursorPos(draft.content.length);
          setStatus("offline");
          loadedKeyRef.current = draftKey;
          setLoaded(true);
        } else {
          toastRef.current.show("Couldn't open this note. Please try again.");
          routerRef.current.replace("/");
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [routeId, isNew, draftKey]);

  const persist = useCallback(
    async (nextTitle: string, nextContent: string) => {
      if (loadedKeyRef.current !== draftKey) return;
      if (nextTitle.trim() === "" && nextContent.trim() === "" && !noteIdRef.current) {
        setStatus("idle");
        return;
      }
      setStatus("saving");
      try {
        if (!noteIdRef.current) {
          if (creatingRef.current) return;
          creatingRef.current = true;
          try {
            const { note } = await postNoteCreate({
              title: nextTitle,
              content: nextContent,
            });
            setNoteId(note.id);
            noteIdRef.current = note.id;
            // Deliberately no navigation here. Replacing /note/new with
            // /note/<id> swapped the top of the stack, which animates: the
            // editor slid away and an identical one slid back a beat after
            // the note saved. The id lives in state, and draftKey follows it,
            // so the route can stay where it is.
            loadedKeyRef.current = note.id;
          } finally {
            creatingRef.current = false;
          }
        } else {
          await postNoteUpdate({
            id: noteIdRef.current,
            title: nextTitle,
            content: nextContent,
          });
        }
        await localDrafts.clear(draftKey);
        setStatus("saved");
      } catch {
        setStatus("offline");
      }
    },
    [draftKey],
  );

  useEffect(() => {
    if (!loaded || loadedKeyRef.current !== draftKey) return;
    void localDrafts.save(draftKey, { title, content, at: Date.now() });
    const timer = setTimeout(() => {
      void persist(title, content);
    }, SERVER_SAVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [title, content, loaded, draftKey, persist]);

  useEffect(() => {
    if (!loaded || !noteId) return;
    const timer = setTimeout(() => {
      reindexRef.current({ noteId });
    }, REINDEX_DELAY_MS);
    return () => clearTimeout(timer);
  }, [loaded, noteId, title, content]);

  const textBeforeCursor = useMemo(() => content.slice(0, cursorPos), [content, cursorPos]);
  const {
    suggestions,
    completionSuggestions,
    reflectionQuestion,
    loading,
    refresh,
    accept,
    dismiss,
  } = useSuggestions({
    noteId: noteId ?? undefined,
    title,
    textBeforeCursor,
    enabled: loaded && editorTab === "note",
  });

  const hasSuggestions = suggestions.length > 0 || completionSuggestions.length > 0;

  const requestSuggestions = useCallback(() => {
    void refresh().then((ok) => {
      if (!ok) {
        toast.show("Couldn't get suggestions right now. Please try again in a moment.");
      }
    });
  }, [refresh, toast]);

  useEffect(() => {
    if (pendingSelection === null) return;
    setSelection({ start: pendingSelection, end: pendingSelection });
    setCursorPos(pendingSelection);
    const timer = setTimeout(() => {
      setSelection(undefined);
      setPendingSelection(null);
    }, 0);
    return () => clearTimeout(timer);
  }, [pendingSelection]);

  const scheduleUndoExpiry = useCallback(() => {
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    undoTimerRef.current = setTimeout(() => setUndoState(null), UNDO_VISIBLE_MS);
  }, []);

  useEffect(() => {
    return () => {
      if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    };
  }, []);

  const insertSuggestion = useCallback(
    (suggestion: BubbleSuggestion) => {
      const current = contentRef.current;
      const start = cursorPos;
      let before = current.slice(0, start);
      const after = current.slice(start);
      const trimmedBefore = before.trimEnd();
      const midClause = /[,;:({["'‘“–—-]$/.test(trimmedBefore);

      let text = suggestion.text;
      if (isCompletionSuggestion(suggestion) || shouldCapitalize(before)) {
        text = text.charAt(0).toUpperCase() + text.slice(1);
      } else if (midClause) {
        text = text.charAt(0).toLowerCase() + text.slice(1);
      } else {
        before = trimmedBefore + ".";
        text = text.charAt(0).toUpperCase() + text.slice(1);
      }

      const needsSpaceBefore =
        before.length > 0 && !/\s$/.test(before) && !/^[,.!?;:'")]/.test(text);
      const needsSpaceAfter = after.length === 0 || !/^\s/.test(after);
      const inserted = (needsSpaceBefore ? " " : "") + text + (needsSpaceAfter ? " " : "");

      setUndoState({ text: current, cursor: start });
      scheduleUndoExpiry();

      const next = before + inserted + after;
      contentRef.current = next;
      setContent(next);
      setPendingSelection(before.length + inserted.length);
      setSuggestionsExpanded(false);
      accept(suggestion);
    },
    [accept, cursorPos, scheduleUndoExpiry],
  );

  const answerQuestion = useCallback(() => {
    const current = contentRef.current;
    const trimmed = current.replace(/\s+$/, "");
    const next = (trimmed.length > 0 ? trimmed + "\n\n" : "") + reflectionQuestion + "\n";
    setUndoState({ text: current, cursor: current.length });
    scheduleUndoExpiry();
    contentRef.current = next;
    setContent(next);
    setPendingSelection(next.length);
  }, [reflectionQuestion, scheduleUndoExpiry]);

  const undoInsert = useCallback(() => {
    if (!undoState) return;
    contentRef.current = undoState.text;
    setContent(undoState.text);
    setPendingSelection(undoState.cursor);
    setUndoState(null);
  }, [undoState]);

  const goBack = useCallback(() => {
    void persist(titleRef.current, contentRef.current);
    // Pop the editor off the stack so it animates back out the way it came in.
    // router.replace would push a fresh screen, which slides in from the right again.
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace("/");
    }
  }, [persist, router]);

  const statusLabel =
    status === "saving"
      ? "Saving…"
      : status === "saved"
        ? "Saved"
        : status === "offline"
          ? "Saved on this device"
          : "";

  return (
    <SafeAreaView style={styles.page} edges={["top"]}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <View style={styles.header}>
          <Button variant="ghost" size="icon" accessibilityLabel="Back to your notes" onPress={goBack}>
            <ChevronLeft size={26} color={colors.foreground} />
          </Button>
          <Text style={styles.status}>{statusLabel}</Text>
          <Button
            variant="ghost"
            size="icon"
            accessibilityLabel="Voice typing (coming soon)"
            onPress={() =>
              toast.show("Voice typing is coming soon. For now, type and use the word bubbles below.")
            }
          >
            <Mic size={22} color={colors.foreground} />
          </Button>
        </View>

        <TextInput
          value={title}
          onChangeText={setTitle}
          editable={loaded}
          placeholder={loaded ? "Title" : ""}
          placeholderTextColor={colors.mutedForeground}
          maxLength={300}
          style={styles.titleInput}
          accessibilityLabel="Note title"
        />

        {TASKS_ENABLED ? (
        <Segmented
          accessibilityLabel="Note sections"
          value={editorTab}
          onChange={(value) => {
            if (value === "tasks") {
              void persist(titleRef.current, contentRef.current).then(() => setEditorTab("tasks"));
            } else {
              setEditorTab("note");
            }
          }}
          options={[
            { label: "Note", value: "note" },
            { label: "Tasks", value: "tasks" },
          ]}
        />
        ) : null}

        {!TASKS_ENABLED || editorTab === "note" ? (
          <>
            <ScrollView
              style={styles.flex}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={styles.notePanel}
            >
              {!loaded ? (
                <View style={styles.bodySkeleton}>
                  <Skeleton style={styles.skeletonLine} />
                  <Skeleton style={styles.skeletonLine} />
                  <Skeleton style={styles.skeletonLineShort} />
                </View>
              ) : (
                <>
              <TextInput
                multiline
                autoFocus={isNew}
                value={content}
                onChangeText={(value) => setContent(value)}
                onSelectionChange={(event) => {
                  if (pendingSelection === null) {
                    setCursorPos(event.nativeEvent.selection.start);
                  }
                }}
                selection={selection}
                placeholder="Start writing…"
                placeholderTextColor={colors.mutedForeground}
                accessibilityLabel="Note text"
                style={[styles.body, { height: Math.max(MIN_BODY_HEIGHT, bodyHeight) }]}
                onContentSizeChange={(event) => {
                  const next = event.nativeEvent.contentSize.height;
                  // Ignore sub-pixel reports; feeding them back as height would
                  // bounce between two values forever.
                  setBodyHeight((prev) => (Math.abs(prev - next) < 1 ? prev : next));
                }}
                textAlignVertical="top"
              />
              <Animated.View
                style={styles.suggestionBar}
                layout={LinearTransition.duration(LAYOUT_MS)}
              >
                <Button
                  variant="secondary"
                  size="sm"
                  onPress={requestSuggestions}
                  loading={loading}
                  accessibilityLabel={
                    hasSuggestions
                      ? "Get new word suggestions"
                      : "Get word suggestions for what you are writing"
                  }
                >
                  <Sparkles size={16} color={colors.secondaryForeground} />
                  <Text style={styles.suggestionButtonText}>
                    {hasSuggestions ? "New suggestions" : "Suggestions"}
                  </Text>
                </Button>
              </Animated.View>
              <InlineSuggestions
                suggestions={suggestions}
                completionSuggestions={completionSuggestions}
                loading={loading}
                expanded={suggestionsExpanded}
                onToggleExpanded={() => setSuggestionsExpanded((value) => !value)}
                onAccept={insertSuggestion}
                onDismiss={dismiss}
              />
              {undoState ? (
                <Animated.View
                  entering={FadeIn.duration(150)}
                  exiting={FadeOut.duration(120)}
                  layout={LinearTransition.duration(LAYOUT_MS)}
                >
                  <Button variant="secondary" size="sm" onPress={undoInsert} style={styles.undo}>
                    <RotateCcw size={16} color={colors.secondaryForeground} />
                    <Text style={styles.undoText}>Undo</Text>
                  </Button>
                </Animated.View>
              ) : null}
                </>
              )}
            </ScrollView>
            <View style={styles.footer}>
              <ReflectionStrip question={reflectionQuestion} onPress={answerQuestion} />
            </View>
          </>
        ) : (
          <ScrollView contentContainerStyle={styles.notePanel} keyboardShouldPersistTaps="handled">
            <NoteTasks noteId={noteId} enabled={editorTab === "tasks"} />
          </ScrollView>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function makeStyles(colors: Colors, scale: number) {
  return StyleSheet.create({
    page: { flex: 1, backgroundColor: colors.background },
    flex: { flex: 1 },
    bodySkeleton: { minHeight: MIN_BODY_HEIGHT, gap: spacing[3], paddingTop: spacing[2] },
    skeletonLine: { height: 18 * scale },
    skeletonLineShort: { height: 18 * scale, width: "60%" },
    header: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: spacing[2],
    },
    status: {
      fontFamily: fonts.base,
      fontSize: 14 * scale,
      color: colors.mutedForeground,
    },
    titleInput: {
      fontFamily: fonts.display,
      fontSize: 28 * scale,
      color: colors.foreground,
      paddingHorizontal: spacing[4],
      paddingVertical: spacing[2],
    },
    // Bottom padding clears the pinned reflection strip, so the last row of
    // chips can always be scrolled out from behind it.
    notePanel: { paddingHorizontal: spacing[4], paddingBottom: spacing[16], gap: spacing[3] },
    body: {
      minHeight: MIN_BODY_HEIGHT,
      fontFamily: fonts.base,
      fontSize: 18 * scale,
      lineHeight: 28 * scale,
      color: colors.foreground,
    },
    suggestionBar: { flexDirection: "row", alignItems: "center" },
    suggestionButtonText: {
      fontFamily: fonts.baseSemi,
      fontSize: 15 * scale,
      color: colors.secondaryForeground,
    },
    undo: { alignSelf: "flex-start" },
    undoText: {
      fontFamily: fonts.baseSemi,
      fontSize: 15 * scale,
      color: colors.secondaryForeground,
    },
    footer: {
      paddingHorizontal: spacing[4],
      paddingTop: spacing[2],
      paddingBottom: spacing[3],
      backgroundColor: colors.background,
    },
  });
}
