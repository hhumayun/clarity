import { useLocalSearchParams, useRouter } from "expo-router";
import { ChevronLeft, Mic, RotateCcw } from "lucide-react-native";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { getNote, postNoteCreate, postNoteUpdate } from "../../../src/api/notes";
import { useReindexNotes } from "../../../src/hooks/useNotes";
import { useSuggestions } from "../../../src/hooks/useSuggestions";
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
import { Segmented } from "../../../src/ui/Segmented";

type SaveStatus = "idle" | "saving" | "saved" | "offline";

const SERVER_SAVE_DELAY_MS = 900;
const REINDEX_DELAY_MS = 4_000;
const UNDO_VISIBLE_MS = 7_000;

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
  const styles = makeStyles(colors, scale);

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

  const contentRef = useRef(content);
  contentRef.current = content;
  const titleRef = useRef(title);
  titleRef.current = title;
  const noteIdRef = useRef(noteId);
  noteIdRef.current = noteId;
  const creatingRef = useRef(false);
  const undoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const draftKey = isNew ? "new" : (routeId ?? "new");
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
            // The buffer now belongs to the created note, so the redirect below reuses it
            // instead of re-fetching.
            loadedKeyRef.current = note.id;
            router.replace(`/note/${note.id}`);
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
    [draftKey, router],
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
    accept,
    dismiss,
  } = useSuggestions({
    noteId: noteId ?? undefined,
    title,
    textBeforeCursor,
    enabled: loaded && editorTab === "note",
  });

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
    router.replace("/");
  }, [persist, router]);

  const statusLabel =
    status === "saving"
      ? "Saving…"
      : status === "saved"
        ? "Saved"
        : status === "offline"
          ? "Saved on this device"
          : "";

  if (!loaded) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

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
          placeholder="Title"
          placeholderTextColor={colors.mutedForeground}
          maxLength={300}
          style={styles.titleInput}
          accessibilityLabel="Note title"
        />

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

        {editorTab === "note" ? (
          <>
            <ScrollView
              style={styles.flex}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={styles.notePanel}
            >
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
                style={styles.body}
                textAlignVertical="top"
              />
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
                <Button variant="secondary" size="sm" onPress={undoInsert} style={styles.undo}>
                  <RotateCcw size={16} color={colors.secondaryForeground} />
                  <Text style={styles.undoText}>Undo</Text>
                </Button>
              ) : null}
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
    loading: { flex: 1, alignItems: "center", justifyContent: "center" },
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
    notePanel: { paddingHorizontal: spacing[4], paddingBottom: spacing[8], gap: spacing[3] },
    body: {
      minHeight: 220,
      fontFamily: fonts.base,
      fontSize: 18 * scale,
      lineHeight: 28 * scale,
      color: colors.foreground,
    },
    undo: { alignSelf: "flex-start" },
    undoText: {
      fontFamily: fonts.baseSemi,
      fontSize: 15 * scale,
      color: colors.secondaryForeground,
    },
    footer: { paddingHorizontal: spacing[4], paddingBottom: spacing[3] },
  });
}
