import { useLocalSearchParams, useNavigation, useRouter } from "expo-router";
import {
  Archive,
  ArchiveRestore,
  Bold,
  ChevronLeft,
  Eye,
  EyeOff,
  Heading2,
  Italic,
  KeyboardOff,
  Link,
  List,
  ListChecks,
  ListIndentDecrease,
  ListIndentIncrease,
  ListOrdered,
  MoreHorizontal,
  Plus,
  Quote,
  RotateCw,
  Sparkles,
  Strikethrough,
  Trash2,
  X,
} from "lucide-react-native";
import React, {
  Profiler,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Alert,
  AppState,
  Keyboard,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { GentleKeyboardAvoidingView } from "../../../src/ui/GentleKeyboardAvoidingView";
import * as WebBrowser from "expo-web-browser";
import NoteEditor, {
  type NoteCursor,
  type NoteEditorHandle,
  type NoteEditorState,
} from "../../../src/editor/NoteEditor";
import { SafeAreaView } from "react-native-safe-area-context";
import { getNote, postSuggestTitle } from "../../../src/api/notes";
import { onlineManager } from "@tanstack/react-query";
import { randomUUID } from "expo-crypto";
import { useOnline } from "../../../src/sync/network";
import { outbox, waitUntilSynced } from "../../../src/sync/store";
import { useIsPending } from "../../../src/sync/SyncProvider";
import { findCachedNote, upsertNoteInLists, useDeleteNote, useReindexNotes, useUpdateNote } from "../../../src/hooks/useNotes";
import { useQueryClient } from "@tanstack/react-query";
import { useSuggestions } from "../../../src/hooks/useSuggestions";
import { TASKS_ENABLED } from "../../../src/featureFlags";
import { localDrafts, type LocalDraft } from "../../../src/lib/localDrafts";
import { noteDocs } from "../../../src/lib/noteDocs";
import { kbOf, perfClock, perfCount, perfMark, perfRecord } from "../../../src/lib/perf";
import { getTasksList } from "../../../src/api/tasks";
import { wantsTitleIdea, wantsTitleOnLeave } from "../../../src/lib/noteTitle";
import { useAppTheme } from "../../../src/providers/AppThemeProvider";
import { useToast } from "../../../src/providers/ToastProvider";
import { fonts, spacing, type Colors, textSize } from "../../../src/theme";
import {
  isCompletionSuggestion,
  type BubbleSuggestion,
  type NoteRecord,
} from "../../../src/types";
import { Button } from "../../../src/ui/Button";
import { Collapse } from "../../../src/ui/Collapse";
import { Sheet } from "../../../src/ui/Sheet";
import Animated, { FadeOut, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { EASE_OUT, MOTION, fadeInFast, fadeOut, layoutTransition } from "../../../src/ui/motion";
import { FadeSwitch } from "../../../src/ui/FadeSwitch";
import { AreaPickerSheet } from "../../../src/ui/AreaPickerSheet";
import { TASKS_QUERY_KEY, useTasks } from "../../../src/hooks/useTasks";
import { areaTag } from "../../../src/lib/lifeCenter";
import { NoteTasks } from "../../../src/ui/NoteTasks";
import { SuggestionTray } from "../../../src/ui/SuggestionTray";
import { Skeleton } from "../../../src/ui/Skeleton";
import { Segmented } from "../../../src/ui/Segmented";

type SaveStatus = "idle" | "saving" | "saved" | "offline";

const SERVER_SAVE_DELAY_MS = 900;
// The area and the Note/Tasks switch come back once writing has stopped for
// this long (see `writing`), and for longer just after coming back to the
// app, while the keyboard returns.
const WRITING_SETTLE_MS = 300;
const RETURN_SETTLE_MS = 1_000;
// A save still under way after this long is shown ("Saving…"); quicker ones,
// the usual, go unsaid.
const SLOW_SAVE_MS = 2_000;
// The draft on the phone is the whole note: written at most this often while
// writing, and at once when the app goes to the background.
const DRAFT_WRITE_MS = 1_000;
const REINDEX_DELAY_MS = 4_000;
// The note's line height, before the text size setting scales it.
const BODY_LINE_HEIGHT = 28;
// An untitled note's title idea waits for a pause in the writing, so it comes
// from a thought rather than half a word.
const TITLE_IDEA_PAUSE_MS = 2_000;

// With the tray open, how long the cursor rests in a new spot before
// suggestions are fetched for it.
const CURSOR_REFRESH_MS = 800;

function shouldCapitalize(before: string): boolean {
  const trimmed = before.trimEnd();
  return trimmed.length === 0 || /[.!?]$/.test(trimmed);
}

export default function NoteEditorScreen() {
  const { id: routeId, area: startArea } = useLocalSearchParams<{ id: string; area?: string }>();
  const isNew = routeId === "new";
  const router = useRouter();
  const toast = useToast();
  const { colors, scale, aiSuggestions, setAiSuggestions, dark } = useAppTheme();
  const styles = useMemo(() => makeStyles(colors, scale), [colors, scale]);

  const [noteId, setNoteId] = useState<string | null>(isNew ? null : routeId ?? null);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [loaded, setLoaded] = useState(false);
  // The note's words settle in as they arrive instead of popping in: a short
  // fade and a few points' rise, the title with them.
  const reveal = useSharedValue(0);
  useEffect(() => {
    reveal.value = loaded ? withTiming(1, { duration: MOTION.slow, easing: EASE_OUT }) : 0;
  }, [loaded, reveal]);
  const titleRevealStyle = useAnimatedStyle(() => ({ opacity: reveal.value }));
  const [status, setStatus] = useState<SaveStatus>("idle");
  // Archive and delete live here now that the notes list has no "…" menu.
  const [archived, setArchived] = useState(false);
  const [menu, setMenu] = useState<"closed" | "open" | "confirmDelete">("closed");
  const updateNote = useUpdateNote();
  const updateNoteRef = useRef(updateNote.mutate);
  updateNoteRef.current = updateNote.mutate;
  const deleteNote = useDeleteNote();
  const queryClient = useQueryClient();
  // Areas this note is tagged with. For a note not yet saved they wait here
  // and go in with its creation.
  // A new note written while the Notes list shows one area starts in it.
  const [tagIds, setTagIds] = useState<string[]>(() => (isNew && startArea ? [startArea] : []));
  const tagIdsRef = useRef(tagIds);
  tagIdsRef.current = tagIds;
  const [areasOpen, setAreasOpen] = useState(false);
  const { query: tasksQuery, createProject } = useTasks(undefined, TASKS_ENABLED);
  const allProjects = tasksQuery.data?.projects ?? [];
  // The words either side of the cursor, as the editor last reported them.
  const [cursor, setCursor] = useState<NoteCursor>({ before: "", after: "" });
  const cursorRef = useRef(cursor);
  cursorRef.current = cursor;
  const [editorTab, setEditorTab] = useState<"note" | "tasks">("note");
  // The suggestion tray, in the keyboard's place. Closing it with the
  // keyboard coming back lets the two swap without the note moving.
  const [trayOpen, setTrayOpen] = useState(false);
  const [trayKeyboardComing, setTrayKeyboardComing] = useState(false);
  const editorRef = useRef<NoteEditorHandle>(null);
  // The formats at the cursor, whether the text has the keyboard, and
  // whether the editor (a web view) has drawn the note yet.
  const [editorState, setEditorState] = useState<NoteEditorState | null>(null);
  const editorStateRef = useRef(editorState);
  editorStateRef.current = editorState;
  const [editorFocused, setEditorFocused] = useState(false);
  const [editorReady, setEditorReady] = useState(false);
  // Writing: the keyboard is up for the note or its title, or the suggestion
  // tray has its place. The area and the Note/Tasks switch then fold away,
  // giving the note their room. They come back once writing has stopped for
  // a moment: handing over between the tray and the keyboard drops focus
  // briefly, and they would flicker in and out.
  const [titleFocused, setTitleFocused] = useState(false);
  const writingNow = editorTab === "note" && (editorFocused || titleFocused || trayOpen);
  const [writing, setWriting] = useState(false);
  // Leaving the app takes the keyboard with it, and coming back brings it
  // back: the header stays as it was meanwhile, rather than unfolding and
  // folding again.
  const [appActive, setAppActive] = useState(AppState.currentState === "active");
  const activeSinceRef = useRef(0);
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") activeSinceRef.current = Date.now();
      setAppActive(state === "active");
    });
    return () => subscription.remove();
  }, []);
  useEffect(() => {
    if (writingNow) {
      setWriting(true);
      return;
    }
    if (!appActive) return;
    const justBack = Date.now() - activeSinceRef.current < RETURN_SETTLE_MS;
    const timer = setTimeout(() => setWriting(false), justBack ? RETURN_SETTLE_MS : WRITING_SETTLE_MS);
    return () => clearTimeout(timer);
  }, [writingNow, appActive]);
  // The note's words fade in and rise a little once the editor has them.
  const bodyReveal = useSharedValue(0);
  useEffect(() => {
    bodyReveal.value = loaded && editorReady ? withTiming(1, { duration: MOTION.slow, easing: EASE_OUT }) : 0;
  }, [loaded, editorReady, bodyReveal]);
  const bodyRevealStyle = useAnimatedStyle(() => ({
    opacity: bodyReveal.value,
    transform: [{ translateY: (1 - bodyReveal.value) * 8 }],
  }));
  // What the editor starts from, and any new copy of the note from outside
  // (the server's newer one): the editor takes the text in when `key` changes.
  const [seedDoc, setSeedDoc] = useState<{ key: number; text: string; doc: unknown }>({ key: 0, text: "", doc: null });
  // The rich text as the editor last reported it (its Markdown is `content`),
  // and a count of its changes, which saving follows along with the words.
  const docRef = useRef<unknown>(null);
  const [docChanges, setDocChanges] = useState(0);
  const titleInputRef = useRef<TextInput>(null);
  // Where the writer was typing, so Keyboard takes them back there.
  const lastFieldRef = useRef<"title" | "body">("body");

  const contentRef = useRef(content);
  contentRef.current = content;
  const titleRef = useRef(title);
  titleRef.current = title;
  const noteIdRef = useRef(noteId);
  noteIdRef.current = noteId;
  // A new note's id, made here as it opens: it is saved (to the outbox) under
  // this id from the first word, online or not.
  const [newId] = useState(() => (isNew ? randomUUID() : null));

  // Titles for notes the writer has not titled. An idea is offered once the
  // note has a little text; leaving applies one if the writer changed the
  // note this visit but never touched the title.
  const [titleIdea, setTitleIdea] = useState<{ title: string; forContent: string } | null>(null);
  const titleIdeaRef = useRef(titleIdea);
  titleIdeaRef.current = titleIdea;
  const [titleIdeaDismissed, setTitleIdeaDismissed] = useState(false);
  const titleIdeaDismissedRef = useRef(titleIdeaDismissed);
  titleIdeaDismissedRef.current = titleIdeaDismissed;
  const titleIdeaAskedRef = useRef(false);
  // Typed in the title field this visit (even if it was cleared again).
  const titleTouchedRef = useRef(false);
  // The text as it was when the note opened: leaving only titles a note
  // whose text changed, so just opening and closing one never edits it.
  const baselineContentRef = useRef<string | null>(null);
  // The title and text as last saved (or loaded) from the server.
  const lastSavedRef = useRef<{ title: string; content: string; doc: string } | null>(null);
  // Words (or a title) changed since the last save: only then is a draft
  // worth writing.
  const unsavedRef = useRef(false);
  const draftTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Saved: nothing unsaved, and no draft write still to come.
  const cancelDraft = () => {
    unsavedRef.current = false;
    if (draftTimerRef.current) clearTimeout(draftTimerRef.current);
    draftTimerRef.current = null;
  };
  const aiSuggestionsRef = useRef(aiSuggestions);
  aiSuggestionsRef.current = aiSuggestions;

  // The note's id: its own, or for a new note the one made as it opened.
  const draftKey = noteId ?? (isNew ? (newId as string) : (routeId ?? "new"));
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

    const applyDraftOnly = async () => {
      // A new note written before notes had their own ids left its text in
      // a shared "new" slot: pick that up once, so it is not lost.
      let draft = await localDrafts.load(draftKey);
      if (!draft) {
        draft = await localDrafts.load("new");
        if (draft) void localDrafts.clear("new");
      }
      if (cancelled) return;
      setNoteId(null);
      noteIdRef.current = null;
      setTitle(draft?.title ?? "");
      setContent(draft?.content ?? "");
      baselineContentRef.current = draft?.content ?? "";
      docRef.current = draft?.doc ?? null;
      setSeedDoc((prev) => ({ key: prev.key + 1, text: draft?.content ?? "", doc: docRef.current }));
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

    // Put a copy of the note on screen: the local draft wins if it is newer.
    // Says whether the draft was used.
    const applyNote = (note: NoteRecord, draft: LocalDraft | null): boolean => {
      const useDraft = Boolean(draft && draft.at > note.updatedAt.getTime());
      if (draft && useDraft) {
        setTitle(draft.title);
        setContent(draft.content);
        baselineContentRef.current = draft.content;
        docRef.current = draft.doc ?? null;
        setSeedDoc((prev) => ({ key: prev.key + 1, text: draft.content, doc: docRef.current }));
        setStatus("saving");
        unsavedRef.current = true;
      } else {
        setTitle(note.title);
        setContent(note.content);
        baselineContentRef.current = note.content;
        docRef.current = note.doc ?? null;
        setSeedDoc((prev) => ({ key: prev.key + 1, text: note.content, doc: docRef.current }));
        setStatus("saved");
      }
      lastSavedRef.current = { title: note.title, content: note.content, doc: JSON.stringify(note.doc ?? null) };
      setNoteId(note.id);
      noteIdRef.current = note.id;
      setArchived(note.archived);
      setTagIds(note.projectIds ?? []);
      loadedKeyRef.current = draftKey;
      setLoaded(true);
      return useDraft;
    };

    void (async () => {
      // Opened from a list: it already holds the note's words, so show them
      // at once and check with the server behind it. The rich text is not in
      // the lists; the phone keeps it for notes opened before (noteDocs).
      const listed = findCachedNote(queryClient, routeId as string);
      let cached: NoteRecord | null = null;
      let openedFromDraft = false;
      if (listed) {
        const [draft, doc] = await Promise.all([localDrafts.load(draftKey), noteDocs.load(listed.id, listed.content)]);
        if (cancelled) return;
        cached = { ...listed, doc };
        openedFromDraft = applyNote(cached, draft);
      }
      try {
        const { note } = await getNote({ id: routeId as string });
        if (cancelled) return;
        // Kept for next time, offline too.
        if (note.doc) void noteDocs.save(note.id, note.doc, note.content);
        else void noteDocs.remove(note.id);
        if (cached) {
          // Only a newer copy matters, and only while the writer has not
          // started; their words are never swapped out under them.
          // An unsaved draft on screen is kept too. The draft written a
          // moment ago is only the list's copy, so it is not consulted.
          const untouched =
            contentRef.current === baselineContentRef.current && !titleTouchedRef.current;
          // Changes made here and still on their way are newer than the server's copy.
          const waiting = outbox.isPending(`note:${note.id}`);
          // Newer, or the same words with the rich text the phone did not
          // have (a note never opened here before).
          const better =
            note.updatedAt.getTime() > cached.updatedAt.getTime() ||
            (cached.doc == null && note.doc != null && note.content === cached.content);
          if (!openedFromDraft && !waiting && untouched && better) {
            applyNote(note, null);
          }
          return;
        }
        const draft = await localDrafts.load(draftKey);
        if (cancelled) return;
        applyNote(note, draft);
      } catch {
        // Already showing the list's copy: stay with it quietly.
        if (cancelled || cached) return;
        const draft = await localDrafts.load(draftKey);
        if (cancelled) return;
        if (draft) {
          setTitle(draft.title);
          setContent(draft.content);
          baselineContentRef.current = draft.content;
          docRef.current = draft.doc ?? null;
          setSeedDoc((prev) => ({ key: prev.key + 1, text: draft.content, doc: docRef.current }));
          setStatus("offline");
          loadedKeyRef.current = draftKey;
          setLoaded(true);
        } else {
          toastRef.current.show(
            onlineManager.isOnline()
              ? "Couldn't open this note. Please try again."
              : "This note isn't on this phone yet. Open it again when you're online.",
          );
          routerRef.current.replace("/");
        }
      }
    })();

    return () => {
      cancelled = true;
    };
    // queryClient is stable; the note is loaded once per route.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeId, isNew, draftKey]);

  const persist = useCallback(
    async (nextTitle: string, nextContent: string) => {
      if (loadedKeyRef.current !== draftKey) return;
      if (nextTitle.trim() === "" && nextContent.trim() === "" && !noteIdRef.current) {
        setStatus("idle");
        return;
      }
      // Nothing changed since it was last saved (or loaded): saving again
      // would only mark the note edited. Opening and closing it never does.
      const saved = lastSavedRef.current;
      const doc = docRef.current ?? undefined;
      const docText = JSON.stringify(doc ?? null);
      if (noteIdRef.current && saved && saved.title === nextTitle && saved.content === nextContent && saved.doc === docText) {
        setStatus("saved");
        cancelDraft();
        void localDrafts.clear(draftKey);
        return;
      }
      // Into the outbox, which sends it now or, offline, when it can; the
      // lists show it straight away either way.
      const now = new Date();
      if (!noteIdRef.current) {
        const id = newId as string;
        outbox.enqueue({
          kind: "note.create",
          body: {
            id,
            createdAt: now,
            title: nextTitle,
            content: nextContent,
            ...(doc ? { doc } : {}),
            ...(tagIdsRef.current.length ? { projectIds: tagIdsRef.current } : {}),
          },
        });
        noteIdRef.current = id;
        setNoteId(id);
        // Deliberately no navigation here. Replacing /note/new with
        // /note/<id> swapped the top of the stack, which animates: the
        // editor slid away and an identical one slid back. The id lives in
        // state, and draftKey is already it, so the route can stay.
        loadedKeyRef.current = id;
        upsertNoteInLists(queryClient, {
          id,
          title: nextTitle,
          content: nextContent,
          doc: doc ?? null,
          archived: false,
          source: null,
          createdAt: now,
          updatedAt: now,
          projectIds: tagIdsRef.current,
        });
      } else {
        const id = noteIdRef.current;
        // The rich text goes with its Markdown, or the server takes the
        // words as a plain edit and drops the rich text.
        outbox.enqueue({ kind: "note.update", body: { id, title: nextTitle, content: nextContent, ...(doc ? { doc } : {}) } });
        const current = findCachedNote(queryClient, id);
        if (current) upsertNoteInLists(queryClient, { ...current, title: nextTitle, content: nextContent, doc: doc ?? null, updatedAt: now });
      }
      lastSavedRef.current = { title: nextTitle, content: nextContent, doc: docText };
      // The rich text, for opening the note again (offline too).
      const savedId = noteIdRef.current;
      if (savedId && doc) void noteDocs.save(savedId, doc, nextContent);
      setStatus("saved");
      cancelDraft();
      await localDrafts.clear(draftKey);
    },
    // cancelDraft only touches refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [draftKey, newId, queryClient],
  );
  const persistRef = useRef(persist);
  persistRef.current = persist;

  /** The draft, now: only if something is unsaved. */
  const writeDraftNow = useCallback(() => {
    if (draftTimerRef.current) clearTimeout(draftTimerRef.current);
    draftTimerRef.current = null;
    if (!unsavedRef.current || loadedKeyRef.current !== draftKey) return;
    void localDrafts.save(draftKey, {
      title: titleRef.current,
      content: contentRef.current,
      doc: docRef.current ?? undefined,
      at: Date.now(),
    });
  }, [draftKey]);
  const writeDraftRef = useRef(writeDraftNow);
  writeDraftRef.current = writeDraftNow;

  useEffect(() => {
    if (!loaded || loadedKeyRef.current !== draftKey) return;
    // The draft: at most once a second (DRAFT_WRITE_MS), not on every change.
    if (unsavedRef.current && !draftTimerRef.current) {
      draftTimerRef.current = setTimeout(() => writeDraftRef.current(), DRAFT_WRITE_MS);
    }
    const timer = setTimeout(() => {
      void persist(title, content);
    }, SERVER_SAVE_DELAY_MS);
    return () => clearTimeout(timer);
    // docChanges: a change only to the rich text (an indent) is saved too.
  }, [title, content, docChanges, loaded, draftKey, persist]);

  // Going to the background: the editor sends what it has not yet, and the
  // draft is written at once, in case the app is closed from there.
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") return;
      editorRef.current?.run("flush");
      writeDraftRef.current();
    });
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    if (!loaded || !noteId) return;
    const timer = setTimeout(() => {
      reindexRef.current({ noteId });
    }, REINDEX_DELAY_MS);
    return () => clearTimeout(timer);
  }, [loaded, noteId, title, content]);

  // Load the note's tasks as soon as its id is known, so the Tasks tab has
  // them ready when it is opened.
  useEffect(() => {
    if (!TASKS_ENABLED || !noteId) return;
    void queryClient.prefetchQuery({
      queryKey: [...TASKS_QUERY_KEY, noteId],
      queryFn: () => getTasksList({ noteId }),
      staleTime: 30_000,
    });
  }, [noteId, queryClient]);

  const textBeforeCursor = cursor.before;
  const editorPalette = useMemo(
    () => ({
      text: colors.foreground,
      muted: colors.mutedForeground,
      accent: colors.primary,
      border: colors.border,
      surface: colors.muted,
    }),
    [colors],
  );
  // The web view: no bar of its own above the keyboard, and the keyboard may
  // come up when the app puts the cursor in the text (after a suggestion).
  const editorDom = useMemo(
    () => ({
      style: { flex: 1, backgroundColor: "transparent" },
      useExpoDOMWebView: false,
      hideKeyboardAccessoryView: true,
      keyboardDisplayRequiresUserAction: false,
      contentInsetAdjustmentBehavior: "never" as const,
      automaticallyAdjustContentInsets: false,
    }),
    [],
  );
  const onEditorChange = useCallback(async (markdown: string, doc: unknown, sentAt?: number) => {
    if (typeof sentAt === "number") perfRecord("change: editor → app", perfClock() - sentAt, kbOf(markdown));
    docRef.current = doc;
    unsavedRef.current = true;
    setDocChanges((count) => count + 1);
    contentRef.current = markdown;
    setContent(markdown);
    // The last words, sent as the note was left: saved straight away, as
    // leaving would have (the page is going, and with it the save timer).
    if (leftRef.current) void persistRef.current(titleRef.current, markdown);
    // Sent as the app went to the background: the draft now.
    else if (AppState.currentState !== "active") writeDraftRef.current();
  }, []);
  const onEditorCursor = useCallback(async (next: NoteCursor) => setCursor(next), []);
  const onEditorState = useCallback(async (next: NoteEditorState, sentAt?: number) => {
    if (typeof sentAt === "number") perfRecord("formats: editor → app", perfClock() - sentAt);
    setEditorState(next);
  }, []);
  const onEditorFocus = useCallback(async (focused: boolean) => {
    setEditorFocused(focused);
    if (focused) lastFieldRef.current = "body";
  }, []);
  const onEditorReady = useCallback(async () => setEditorReady(true), []);
  const {
    suggestions,
    completionSuggestions,
    reflectionQuestions,
    loading,
    refresh,
    refreshIfStale,
    accept,
  } = useSuggestions({
    noteId: noteId ?? undefined,
    title,
    text: content,
    textBeforeCursor,
    enabled: loaded && editorTab === "note" && aiSuggestions,
  });

  const requestSuggestions = useCallback(() => {
    void refresh().then((ok) => {
      if (!ok) {
        toast.show("Couldn't get suggestions right now. Please try again in a moment.");
      }
    });
  }, [refresh, toast]);

  // A suggestion goes in at the cursor, cased and spaced for where it lands.
  const insertSuggestion = useCallback(
    (suggestion: BubbleSuggestion) => {
      const { before, after } = cursorRef.current;
      const trimmedBefore = before.trimEnd();
      // At the start of the note or of a line, a new sentence starts.
      const lineStart = trimmedBefore.length === 0 || /\n\s*$/.test(before);
      const midClause = /[,;:({["'‘“–—-]$/.test(trimmedBefore);

      let text = suggestion.text;
      let endSentence = false;
      if (isCompletionSuggestion(suggestion)) {
        // Finishes the sentence it follows: the model's own casing, unless
        // there is no sentence left to finish.
        if (lineStart || shouldCapitalize(before)) text = text.charAt(0).toUpperCase() + text.slice(1);
      } else if (lineStart || shouldCapitalize(before)) {
        text = text.charAt(0).toUpperCase() + text.slice(1);
      } else if (midClause) {
        text = text.charAt(0).toLowerCase() + text.slice(1);
      } else {
        // The sentence before it ends first.
        endSentence = true;
        text = text.charAt(0).toUpperCase() + text.slice(1);
      }

      const lead = endSentence ? `${trimmedBefore}.` : before;
      const needsSpaceBefore = !lineStart && lead.length > 0 && !/\s$/.test(lead) && !/^[,.!?;:'")]/.test(text);
      const needsSpaceAfter = after.length === 0 || !/^\s/.test(after);
      const inserted = (endSentence ? "." : "") + (needsSpaceBefore ? " " : "") + text + (needsSpaceAfter ? " " : "");
      editorRef.current?.run("insertText", JSON.stringify({ text: inserted, trimBefore: endSentence }));
      accept(suggestion);
    },
    [accept],
  );

  // A question goes in as its own line where the cursor is, with the cursor
  // on the line below it, ready for the answer.
  const insertQuestion = useCallback((question: string) => {
    editorRef.current?.run("insertQuestion", question);
  }, []);

  const openTray = useCallback(() => {
    if (!onlineManager.isOnline()) {
      toast.show("Suggestions need a connection. Your note is saved on this phone.");
      return;
    }
    Keyboard.dismiss();
    setTrayKeyboardComing(false);
    setTrayOpen(true);
    // What is on hand may be for words since written, or another spot.
    void refreshIfStale().then((ok) => {
      if (!ok) toast.show("Couldn't get suggestions right now. Please try again in a moment.");
    });
  }, [refreshIfStale, toast]);

  // The tray takes the keyboard's place: a tap in the note then only moves
  // the cursor.
  useEffect(() => {
    editorRef.current?.run("tray", trayOpen ? "on" : "off");
  }, [trayOpen]);

  /**
   * Back to typing, only ever from Keyboard or an added suggestion: the
   * keyboard comes up as the tray goes down. After an added suggestion the
   * writer goes back to the note, where it went in; otherwise to the field
   * they were in.
   */
  const backToKeyboard = useCallback((toNote = false) => {
    setTrayKeyboardComing(true);
    setTrayOpen(false);
    if (toNote || lastFieldRef.current === "body") {
      editorRef.current?.run("keyboard");
      return;
    }
    // A field tapped while the tray was open is focused with no keyboard;
    // it has to let go and take focus again for the keyboard to come.
    titleInputRef.current?.blur();
    setTimeout(() => titleInputRef.current?.focus(), 60);
  }, []);

  // With the tray open, a tap in the note only moves the cursor (no
  // keyboard); once it rests somewhere new, fetch for that spot.
  useEffect(() => {
    if (!trayOpen) return;
    const timer = setTimeout(() => void refreshIfStale(), CURSOR_REFRESH_MS);
    return () => clearTimeout(timer);
  }, [trayOpen, cursor, refreshIfStale]);

  // Nothing to show it for: the Tasks tab, or suggestions turned off.
  useEffect(() => {
    if (editorTab !== "note" || !aiSuggestions) {
      setTrayKeyboardComing(false);
      setTrayOpen(false);
    }
  }, [editorTab, aiSuggestions]);

  // Offer a title once an untitled note has a little text and the writer
  // pauses. Once per visit: leaving asks again if the text has moved on.
  useEffect(() => {
    if (!loaded || titleIdeaAskedRef.current) return;
    const state = { title, content, titleTouched: titleTouchedRef.current, dismissed: titleIdeaDismissed, aiOn: aiSuggestions };
    if (!wantsTitleIdea(state)) return;
    const timer = setTimeout(() => {
      titleIdeaAskedRef.current = true;
      const forContent = contentRef.current;
      postSuggestTitle({ content: forContent })
        .then(({ title: idea }) => {
          if (idea && !titleRef.current.trim() && !titleTouchedRef.current) {
            setTitleIdea({ title: idea, forContent });
          }
        })
        .catch(() => {
          // No idea this time; an untitled note is fine.
        });
    }, TITLE_IDEA_PAUSE_MS);
    return () => clearTimeout(timer);
  }, [loaded, aiSuggestions, titleIdeaDismissed, title, content]);

  const showTitleIdea =
    titleIdea !== null && aiSuggestions && !titleIdeaDismissed && title.trim() === "" && !titleTouchedRef.current;

  const leftRef = useRef(false);
  // Runs once as the editor goes, however it goes: the back button, the
  // swipe back, or leaving after archiving. It saves, and gives an untitled
  // note a title if the writer changed its text but never touched the title.
  const leave = useCallback(() => {
    if (leftRef.current) return;
    leftRef.current = true;
    // Words typed in the last moment may still be in the editor: it sends
    // them now, and they are saved as they arrive (onEditorChange).
    editorRef.current?.run("flush");
    // Deleted, or never finished loading: nothing to save.
    if (loadedKeyRef.current === null) return;
    const content = contentRef.current;
    void persist(titleRef.current, content);
    // A title idea needs the AI, so only with a connection.
    const wantsTitle = onlineManager.isOnline() && wantsTitleOnLeave({
      title: titleRef.current,
      content,
      contentAtOpen: baselineContentRef.current,
      titleTouched: titleTouchedRef.current,
      dismissed: titleIdeaDismissedRef.current,
      aiOn: aiSuggestionsRef.current,
    });
    if (!wantsTitle) return;
    void (async () => {
      try {
        // The idea on screen if it was made from this same text; otherwise a
        // fresh one from the text as it now stands.
        const idea = titleIdeaRef.current;
        const title =
          idea && idea.forContent === content ? idea.title : (await postSuggestTitle({ content })).title;
        if (!title) return;
        const id = noteIdRef.current;
        if (!id) return;
        updateNoteRef.current({ id, title });
      } catch {
        // The note stays untitled; the list shows its first line instead.
      }
    })();
  }, [persist]);
  const leaveRef = useRef(leave);
  leaveRef.current = leave;

  // The swipe back skips the back button, so listen for the screen going.
  const navigation = useNavigation();
  useEffect(() => navigation.addListener("beforeRemove", () => leaveRef.current()), [navigation]);

  const goBack = useCallback(() => {
    leave();
    // Pop the editor off the stack so it animates back out the way it came in.
    // router.replace would push a fresh screen, which slides in from the right again.
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace("/");
    }
  }, [leave, router]);

  // Until the server has it: sending now, or kept here for when the phone
  // is back online.
  const pendingHere = useIsPending(noteId ? `note:${noteId}` : null);
  const online = useOnline();
  // Only what is worth knowing: words kept on this phone until it is back
  // online, or a save taking a while. Saved is the normal state, and quick
  // saves (most) go unsaid.
  const savingNow = status !== "idle" && (pendingHere ? online : status === "saving");
  const [slowSave, setSlowSave] = useState(false);
  useEffect(() => {
    if (!savingNow) {
      setSlowSave(false);
      return;
    }
    const timer = setTimeout(() => setSlowSave(true), SLOW_SAVE_MS);
    return () => clearTimeout(timer);
  }, [savingNow]);
  const statusLabel =
    status !== "idle" && ((pendingHere && !online) || (!pendingHere && status === "offline"))
      ? "Saved on this device"
      : savingNow && slowSave
        ? "Saving…"
        : "";

  // Links: a web address as typed or pasted, opened in the in-app browser.
  const withProtocol = (url: string) => (/^[a-z][a-z0-9+.-]*:/i.test(url) ? url : `https://${url}`);
  const askForLink = (current: string) =>
    Alert.prompt(
      "Link",
      "Type or paste a web address.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Save",
          onPress: (value?: string) => {
            const url = (value ?? "").trim();
            if (url) editorRef.current?.run("link", withProtocol(url));
          },
        },
      ],
      "plain-text",
      current || "https://",
      "url",
    );
  // In a link: open it, change it or take it off. Elsewhere: link the words
  // chosen, or put a new link at the cursor.
  const onLinkTool = () => {
    const href = editorStateRef.current?.link;
    if (href == null) {
      askForLink("");
      return;
    }
    Alert.alert(href || "Link", undefined, [
      { text: "Open", onPress: () => void WebBrowser.openBrowserAsync(withProtocol(href)) },
      { text: "Change", onPress: () => askForLink(href) },
      { text: "Remove", style: "destructive", onPress: () => editorRef.current?.run("link", "") },
      { text: "Cancel", style: "cancel" },
    ]);
  };
  // The tap's time goes along, so the editor can say how long it took to
  // arrive and to be on screen (the timing log).
  const format = (name: string) => () => {
    perfMark(`toolbar: ${name} tapped`);
    editorRef.current?.run(name, null, perfClock());
  };
  const formatTools = [
    { key: "task", Icon: ListChecks, label: "Checklist", active: Boolean(editorState?.task), onPress: format("task") },
    { key: "bullet", Icon: List, label: "Bulleted list", active: Boolean(editorState?.bullet), onPress: format("bullet") },
    { key: "ordered", Icon: ListOrdered, label: "Numbered list", active: Boolean(editorState?.ordered), onPress: format("ordered") },
    { key: "indent", Icon: ListIndentIncrease, label: "Indent", active: false, onPress: format("indent") },
    { key: "outdent", Icon: ListIndentDecrease, label: "Outdent", active: false, onPress: format("outdent") },
    { key: "bold", Icon: Bold, label: "Bold", active: Boolean(editorState?.bold), onPress: format("bold") },
    { key: "italic", Icon: Italic, label: "Italic", active: Boolean(editorState?.italic), onPress: format("italic") },
    { key: "strike", Icon: Strikethrough, label: "Strikethrough", active: Boolean(editorState?.strike), onPress: format("strike") },
    { key: "heading", Icon: Heading2, label: "Heading", active: Boolean(editorState?.heading), onPress: format("heading") },
    { key: "quote", Icon: Quote, label: "Quote", active: Boolean(editorState?.quote), onPress: format("quote") },
    {
      key: "link",
      Icon: Link,
      label: editorState?.link != null ? "Link: open, change or remove" : "Add a link",
      active: editorState?.link != null,
      onPress: onLinkTool,
    },
  ];

  return (
    <Profiler id="note" onRender={recordNoteRender}>
    <SafeAreaView style={styles.page} edges={["top"]}>
      {/* Makes room for the keyboard on the UI thread, gliding a little
          slower than the keyboard itself. React Native's own avoiding view
          drove this with LayoutAnimation, which under the new renderer ran
          out of step with the keyboard and lurched. */}
      <GentleKeyboardAvoidingView style={styles.flex}>
        <View style={styles.header}>
          <Button variant="ghost" size="icon" accessibilityLabel="Back to your notes" onPress={goBack}>
            <ChevronLeft size={26} color={colors.foreground} />
          </Button>
          <View style={styles.headerCenter}>
            <Animated.View style={[styles.titleWrap, titleRevealStyle]}>
            <TextInput
              value={title}
              onChangeText={(value) => {
                titleTouchedRef.current = true;
                unsavedRef.current = true;
                setTitle(value);
              }}
              ref={titleInputRef}
              editable={loaded}
              onFocus={() => {
                lastFieldRef.current = "title";
                setTitleFocused(true);
              }}
              onBlur={() => setTitleFocused(false)}
              showSoftInputOnFocus={!trayOpen}
              placeholder={loaded ? "Untitled" : ""}
              placeholderTextColor={colors.mutedForeground}
              maxLength={300}
              style={styles.titleInput}
              accessibilityLabel="Note title"
              returnKeyType="done"
            />
            </Animated.View>
            {/* Under the title only when there is something to say, and
                taking no room of its own: the title and the note never
                move for it. */}
            {statusLabel ? (
              <Text style={styles.status} numberOfLines={1}>
                {statusLabel}
              </Text>
            ) : null}
          </View>
          {noteId ? (
            <Button
              variant="ghost"
              size="icon"
              accessibilityLabel="More: archive or delete this note"
              onPress={() => setMenu("open")}
            >
              <MoreHorizontal size={22} color={colors.foreground} />
            </Button>
          ) : (
            // Keeps the title centred until the note exists and can be archived.
            <View style={styles.headerSpacer} />
          )}
        </View>

        <Collapse open={showTitleIdea}>
          <View style={styles.titleIdeaRow}>
            <Pressable
              onPress={() => {
                const idea = titleIdeaRef.current;
                if (idea) setTitle(idea.title);
              }}
              style={({ pressed }) => [styles.titleIdea, pressed && styles.titleIdeaPressed]}
              accessibilityRole="button"
              accessibilityLabel={`Use the suggested title: ${titleIdea?.title ?? ""}`}
            >
              <Sparkles size={14} color={colors.primary} />
              <Text style={styles.titleIdeaText} numberOfLines={1}>
                {titleIdea?.title}
              </Text>
              <Text style={styles.titleIdeaUse}>Use</Text>
            </Pressable>
            <Pressable
              onPress={() => setTitleIdeaDismissed(true)}
              hitSlop={10}
              style={styles.titleIdeaDismiss}
              accessibilityRole="button"
              accessibilityLabel="No thanks, keep this note untitled"
            >
              <X size={16} color={colors.mutedForeground} />
            </Pressable>
          </View>
        </Collapse>

        {TASKS_ENABLED ? (
          // While writing, the area and the Note/Tasks switch fold away
          // (see `writing`): the note gets their room. Not on opening.
          <Collapse open={!writing} appear={false}>
            <View>
              {loaded ? (
                <View style={styles.areaRow}>
                  {tagIds
                    .map((id) => allProjects.find((project) => project.id === id))
                    .filter((project): project is NonNullable<typeof project> => Boolean(project))
                    .map((project) => (
                      <Animated.View key={project.id} entering={fadeInFast} exiting={fadeOut} layout={layoutTransition}>
                        <Pressable
                          onPress={() => setAreasOpen(true)}
                          style={styles.areaChip}
                          accessibilityLabel={`Area: ${project.name}. Change areas`}
                        >
                          <Text style={styles.areaChipText}>{areaTag(project.name)}</Text>
                        </Pressable>
                      </Animated.View>
                    ))}
                  <Animated.View layout={layoutTransition}>
                  <Pressable
                    onPress={() => setAreasOpen(true)}
                    style={[styles.areaChip, styles.areaChipAdd]}
                    accessibilityLabel={tagIds.length ? "Change areas" : "Tag this note with an area"}
                  >
                    <Plus size={14} color={colors.mutedForeground} />
                    {tagIds.length === 0 ? <Text style={styles.areaChipMuted}>Area</Text> : null}
                  </Pressable>
                  </Animated.View>
                </View>
              ) : null}

              <View style={styles.tabs}>
              <Segmented
                size="sm"
                accessibilityLabel="Note sections"
                value={editorTab}
                onChange={(value) => {
                  if (value === "tasks") {
                    // Saving puts the note in the outbox under its own id, so its
                    // tasks can open at once, online or not. Words still in the
                    // editor come over first, and are saved as they arrive.
                    editorRef.current?.run("flush");
                    void persist(titleRef.current, contentRef.current);
                    if (noteIdRef.current) {
                      setEditorFocused(false);
                      setEditorTab("tasks");
                    }
                    else toast.show("Write something in the note first; its tasks are kept with it.");
                  } else {
                    // The editor starts again from the note as it now stands.
                    setEditorReady(false);
                    setSeedDoc((prev) => ({ key: prev.key + 1, text: contentRef.current, doc: docRef.current }));
                    setEditorTab("note");
                  }
                }}
                options={[
                  { label: "Note", value: "note" },
                  { label: "Tasks", value: "tasks" },
                ]}
              />
              </View>
            </View>
          </Collapse>
        ) : null}

        {/* Note and Tasks cross-fade rather than cut. */}
        <FadeSwitch switchKey={editorTab} style={styles.flex}>
        {!TASKS_ENABLED || editorTab === "note" ? (
          <View style={styles.flex}>
            {/* The note's text, rich: Tiptap in a web view (NoteEditor),
                writing Markdown. It scrolls itself and keeps the cursor in
                view as the keyboard comes and goes. Until it has drawn the
                note, a skeleton holds its place. */}
            <View style={styles.flex}>
              {loaded ? (
                <Animated.View style={[styles.flex, bodyRevealStyle]}>
                  <BootedNoteEditor
                    ref={editorRef}
                    markdown={seedDoc.text}
                    doc={seedDoc.doc}
                    seed={String(seedDoc.key)}
                    placeholder="Start writing…"
                    autoFocus={isNew}
                    palette={editorPalette}
                    fontSize={textSize.large * scale}
                    lineHeight={BODY_LINE_HEIGHT * scale}
                    onChange={onEditorChange}
                    onCursor={onEditorCursor}
                    onState={onEditorState}
                    onFocusChange={onEditorFocus}
                    onReady={onEditorReady}
                    dom={editorDom}
                  />
                </Animated.View>
              ) : null}
              {!loaded || !editorReady ? (
                <Animated.View style={styles.bodySkeleton} exiting={FadeOut.duration(MOTION.fast)}>
                  <Skeleton style={styles.skeletonLine} />
                  <Skeleton style={styles.skeletonLine} />
                  <Skeleton style={styles.skeletonLineShort} />
                </Animated.View>
              ) : null}
            </View>
            <View style={[styles.footer, trayOpen && styles.footerTray]}>
              {trayOpen ? (
                // The tray's own bar: what to do, a fresh set, and the way back.
                <View style={styles.toolbar}>
                  <Text style={styles.trayHint}>Tap one to add it</Text>
                  <Button
                    variant="ghost"
                    size="icon"
                    style={styles.toolButton}
                    onPress={requestSuggestions}
                    loading={loading}
                    accessibilityLabel="Get new suggestions"
                  >
                    <RotateCw size={17} color={colors.mutedForeground} />
                  </Button>
                  <Pressable
                    onPress={() => backToKeyboard()}
                    style={({ pressed }) => [styles.keyboardButton, pressed && styles.pressed]}
                    accessibilityRole="button"
                    accessibilityLabel="Back to the keyboard"
                  >
                    <Text style={styles.keyboardButtonText}>Keyboard</Text>
                  </Pressable>
                </View>
              ) : editorFocused ? (
                // Writing in the note: its formats in a row that scrolls
                // sideways, then suggestions and the way to put the
                // keyboard away.
                <View style={styles.formatBar}>
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    keyboardShouldPersistTaps="always"
                    style={styles.flex}
                    contentContainerStyle={styles.formatTools}
                  >
                    {formatTools.map(({ key, Icon, label, active, onPress }) => (
                      <Pressable
                        key={key}
                        onPress={onPress}
                        style={({ pressed }) => [styles.formatTool, active && styles.formatToolOn, pressed && styles.pressed]}
                        accessibilityRole="button"
                        accessibilityLabel={label}
                        accessibilityState={{ selected: active }}
                      >
                        <Icon size={19} color={active ? colors.primaryForeground : colors.foreground} />
                      </Pressable>
                    ))}
                  </ScrollView>
                  {aiSuggestions ? (
                    <Pressable
                      onPress={openTray}
                      style={({ pressed }) => [styles.formatTool, pressed && styles.pressed]}
                      accessibilityRole="button"
                      accessibilityLabel="Suggestions: words to keep going, and questions"
                    >
                      <Sparkles size={18} color={colors.primary} />
                    </Pressable>
                  ) : null}
                  <Pressable
                    onPress={() => editorRef.current?.run("blur")}
                    style={({ pressed }) => [styles.formatTool, pressed && styles.pressed]}
                    accessibilityRole="button"
                    accessibilityLabel="Put the keyboard away"
                  >
                    <KeyboardOff size={19} color={colors.mutedForeground} />
                  </Pressable>
                </View>
              ) : (
                <View style={styles.toolbar}>
                  {aiSuggestions ? (
                    <Pressable
                      onPress={openTray}
                      style={({ pressed }) => [styles.suggestButton, pressed && styles.pressed]}
                      accessibilityRole="button"
                      accessibilityLabel="Suggestions: words to keep going, and questions"
                    >
                      <Sparkles size={15} color={colors.accentForeground} />
                      <Text style={styles.suggestButtonText}>Suggestions</Text>
                    </Pressable>
                  ) : (
                    <Text style={styles.toolbarLabel}>AI suggestions off</Text>
                  )}
                  <View style={styles.flex} />
                  <Button
                    variant="ghost"
                    size="icon"
                    style={styles.toolButton}
                    onPress={() => setAiSuggestions(!aiSuggestions)}
                    accessibilityLabel={aiSuggestions ? "Hide AI suggestions" : "Show AI suggestions"}
                  >
                    {aiSuggestions ? (
                      <EyeOff size={18} color={colors.mutedForeground} />
                    ) : (
                      <Eye size={18} color={colors.foreground} />
                    )}
                  </Button>
                </View>
              )}
            </View>
            {aiSuggestions ? (
              <SuggestionTray
                open={trayOpen}
                keyboardComing={trayKeyboardComing}
                completions={completionSuggestions}
                stems={suggestions}
                questions={reflectionQuestions}
                loading={loading}
                onPick={(suggestion) => {
                  insertSuggestion(suggestion);
                  backToKeyboard(true);
                }}
                onPickQuestion={(question) => {
                  insertQuestion(question);
                  backToKeyboard(true);
                }}
              />
            ) : null}
          </View>
        ) : (
          <View style={styles.flex}>
            <ScrollView contentContainerStyle={styles.notePanel} keyboardShouldPersistTaps="handled">
              <NoteTasks
                noteId={noteId}
                enabled={editorTab === "tasks"}
                ensureSaved={async () => {
                  // Find tasks reads the note on the server: wait for it to land.
                  const id = noteIdRef.current;
                  if (id) await waitUntilSynced(`note:${id}`, 15_000);
                }}
              />
            </ScrollView>
          </View>
        )}
        </FadeSwitch>
      </GentleKeyboardAvoidingView>

      <AreaPickerSheet
        open={areasOpen}
        onClose={() => setAreasOpen(false)}
        projects={allProjects}
        selected={tagIds}
        onToggle={(projectId) => {
          const previous = tagIdsRef.current;
          const next = previous.includes(projectId)
            ? previous.filter((id) => id !== projectId)
            : [...previous, projectId];
          setTagIds(next);
          tagIdsRef.current = next;
          const id = noteIdRef.current;
          if (!id) return;
          updateNote.mutate(
            { id, projectIds: next },
            {
              onError: () => {
                setTagIds(previous);
                tagIdsRef.current = previous;
                toast.show("That area could not be saved. Please try again.");
              },
            },
          );
        }}
        onCreate={async (name) => {
          const { project } = await createProject.mutateAsync({ name });
          const next = [...tagIdsRef.current, project.id];
          setTagIds(next);
          tagIdsRef.current = next;
          const id = noteIdRef.current;
          if (id) await updateNote.mutateAsync({ id, projectIds: next });
        }}
      />

      <Sheet
        open={menu !== "closed"}
        title={menu === "confirmDelete" ? "Delete this note?" : title.trim() || "This note"}
        description={
          menu === "confirmDelete" ? "The note will be gone for good. This cannot be undone." : undefined
        }
        onClose={() => setMenu("closed")}
      >
        {menu === "confirmDelete" ? (
          <>
            <Button
              variant="destructive"
              size="lg"
              loading={deleteNote.isPending}
              onPress={() => {
                const id = noteIdRef.current;
                if (!id) return;
                deleteNote.mutate(
                  { id },
                  {
                    onSuccess: () => {
                      // Stop autosave from writing the deleted note back.
                      loadedKeyRef.current = null;
                      void localDrafts.clear(draftKey);
                      setMenu("closed");
                      if (router.canGoBack()) router.back();
                      else router.replace("/");
                    },
                    onError: () => toast.show("That note could not be deleted. Please try again."),
                  },
                );
              }}
            >
              Delete
            </Button>
            <Button variant="ghost" onPress={() => setMenu("open")}>
              Cancel
            </Button>
          </>
        ) : (
          <View>
            <Pressable
              style={styles.menuRow}
              accessibilityRole="button"
              onPress={() => {
                const id = noteIdRef.current;
                if (!id) return;
                const next = !archived;
                void persist(titleRef.current, contentRef.current).then(() =>
                  updateNote.mutate(
                    { id, archived: next },
                    {
                      onSuccess: () => {
                        setArchived(next);
                        setMenu("closed");
                        toast.show(next ? "Note archived" : "Note restored");
                        if (next) {
                          if (router.canGoBack()) router.back();
                          else router.replace("/");
                        }
                      },
                      onError: () => toast.show("That change could not be saved. Please try again."),
                    },
                  ),
                );
              }}
            >
              {archived ? (
                <ArchiveRestore size={20} color={colors.foreground} />
              ) : (
                <Archive size={20} color={colors.foreground} />
              )}
              <Text style={styles.menuText}>{archived ? "Restore to your notes" : "Archive"}</Text>
            </Pressable>
            <Pressable
              style={[styles.menuRow, styles.menuDivider]}
              accessibilityRole="button"
              onPress={() => setMenu("confirmDelete")}
            >
              <Trash2 size={20} color={colors.error} />
              <Text style={[styles.menuText, styles.menuDanger]}>Delete</Text>
            </Pressable>
          </View>
        )}
      </Sheet>
    </SafeAreaView>
    </Profiler>
  );
}

/**
 * The note editor, given the note's text only once it is up. Its first
 * props reach the web view embedded in a JavaScript template string by
 * react-native-webview, unescaped, so a line break (or a backtick) in them
 * breaks the page and the editor never starts. The text follows a moment
 * later through the props channel, which is escaped (and is sent again
 * when the page says it is ready, in case it was still loading).
 */
// Memoised: each time it renders, Expo sends every prop over to the page
// again, the note it opened with included. Its props only change when the
// note is given to it anew, so the screen's redraws (one per change typed)
// no longer cost the editor anything.
const BootedNoteEditor = React.memo(function BootedNoteEditor({ ref, ...props }: React.ComponentProps<typeof NoteEditor>) {
  const [booted, setBooted] = useState(false);
  useEffect(() => setBooted(true), []);
  // This editor's own handle. Expo gives a ref its editor's handle only
  // while the ref is empty, and never takes it back when that editor goes. The
  // screen's ref outlived its editor (the Tasks tab and back, a reload while
  // developing) and kept the first one's handle: every command (formats, the
  // tray, the flush on leaving) went to a page that was gone, and nothing
  // happened. Each editor gets a fresh ref here, and the screen's reaches
  // whichever editor is on screen.
  // A fresh one too whenever the editor component itself is new, as when
  // its code is reloaded while developing.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const own = useMemo(() => React.createRef<NoteEditorHandle>(), [NoteEditor]);
  useImperativeHandle(
    ref,
    () => ({
      run: (...args: unknown[]) => {
        // Only once the page has said what it takes (a moment after it loads).
        const run = own.current?.run;
        if (typeof run === "function") run(...args);
      },
    }),
    [own],
  );
  const renders = useRef(0);
  renders.current += 1;
  if (renders.current > 1) perfCount("props sent to the editor");
  return (
    <NoteEditor
      {...props}
      ref={own}
      markdown={booted ? props.markdown : ""}
      doc={booted ? props.doc : null}
      seed={booted ? props.seed : "boot"}
    />
  );
});

/** How long each redraw of the note screen took, for the timing log. */
function recordNoteRender(_id: string, _phase: string, actualDuration: number) {
  perfRecord("note screen render", actualDuration);
}

function makeStyles(colors: Colors, scale: number) {
  return StyleSheet.create({
    page: { flex: 1, backgroundColor: colors.background },
    flex: { flex: 1 },
    titleWrap: { alignSelf: "stretch" },
    // Where the note's lines will be, until the editor has drawn them.
    bodySkeleton: {
      position: "absolute",
      top: 0,
      left: 0,
      right: 0,
      gap: spacing[3],
      paddingTop: spacing[3],
      paddingHorizontal: spacing[4],
    },
    skeletonLine: { height: 18 * scale },
    skeletonLineShort: { height: 18 * scale, width: "60%" },
    header: {
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: spacing[2],
      paddingTop: spacing[1],
      paddingBottom: spacing[2],
    },
    headerCenter: { flex: 1, alignItems: "center", paddingHorizontal: spacing[2] },
    titleInput: {
      alignSelf: "stretch",
      textAlign: "center",
      fontFamily: fonts.display,
      fontSize: textSize.title * scale,
      color: colors.foreground,
      paddingVertical: 2,
    },
    status: {
      position: "absolute",
      top: "100%",
      left: 0,
      right: 0,
      textAlign: "center",
      fontFamily: fonts.base,
      fontSize: textSize.label * scale,
      lineHeight: 16 * scale,
      color: colors.mutedForeground,
    },
    tabs: { alignSelf: "center", marginBottom: spacing[2] },
    headerSpacer: { width: 48, height: 48 },
    titleIdeaRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: spacing[1],
      paddingHorizontal: spacing[4],
      marginBottom: spacing[2],
    },
    titleIdea: {
      flexShrink: 1,
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      borderRadius: 999,
      backgroundColor: colors.accent,
      paddingHorizontal: spacing[3],
      paddingVertical: 6,
    },
    titleIdeaPressed: { opacity: 0.8 },
    titleIdeaText: {
      flexShrink: 1,
      fontFamily: fonts.base,
      fontSize: textSize.small * scale,
      color: colors.accentForeground,
    },
    titleIdeaUse: { fontFamily: fonts.baseSemi, fontSize: textSize.small * scale, color: colors.primary },
    titleIdeaDismiss: { padding: spacing[1] },
    areaRow: {
      flexDirection: "row",
      flexWrap: "wrap",
      justifyContent: "center",
      gap: spacing[2],
      paddingHorizontal: spacing[4],
      marginBottom: spacing[2],
    },
    areaChip: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      borderRadius: 999,
      borderWidth: 1,
      borderColor: colors.border,
      paddingHorizontal: spacing[3],
      paddingVertical: 5,
    },
    areaChipAdd: { borderStyle: "dashed", paddingHorizontal: spacing[2] },
    areaDot: { width: 8, height: 8, borderRadius: 4 },
    areaChipText: { fontFamily: fonts.base, fontSize: textSize.small * scale, color: colors.foreground },
    areaChipMuted: { fontFamily: fonts.base, fontSize: textSize.small * scale, color: colors.mutedForeground },
    menuRow: { flexDirection: "row", alignItems: "center", gap: spacing[3], paddingVertical: spacing[4] },
    menuDivider: { borderTopWidth: 1, borderTopColor: colors.border },
    menuText: { fontFamily: fonts.base, fontSize: textSize.body * scale, color: colors.foreground },
    menuDanger: { color: colors.error },
    // Bottom padding clears the pinned reflection strip, so the last row of
    // chips can always be scrolled out from behind it.
    notePanel: {
      paddingHorizontal: spacing[4],
      paddingTop: spacing[3],
      paddingBottom: spacing[16],
      gap: spacing[3],
    },
    footer: {
      paddingHorizontal: spacing[4],
      paddingTop: spacing[1],
      paddingBottom: spacing[3],
      gap: spacing[2],
      backgroundColor: colors.background,
    },
    // One slim row of controls pinned above the keyboard: a caption on the
    // left, then the refresh and show/hide buttons, each a 36pt target.
    toolbar: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "flex-end",
      gap: spacing[1],
    },
    toolbarLabel: {
      flex: 1,
      fontFamily: fonts.baseSemi,
      fontSize: textSize.label * scale,
      letterSpacing: 0.4,
      color: colors.mutedForeground,
    },
    toolButton: { width: 36, height: 36 },
    // While writing: the formats in a row that scrolls sideways, then the
    // suggestions and the way to put the keyboard away.
    formatBar: { flexDirection: "row", alignItems: "center", gap: 2, marginHorizontal: -spacing[2] },
    formatTools: { gap: 2, paddingHorizontal: spacing[1] },
    formatTool: { width: 40, height: 38, borderRadius: 10, alignItems: "center", justifyContent: "center" },
    formatToolOn: { backgroundColor: colors.primary },
    pressed: { opacity: 0.7 },
    // Above the open tray the bar joins it: its colour, a hairline above.
    footerTray: {
      backgroundColor: colors.card,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
      paddingTop: spacing[2],
    },
    trayHint: { flex: 1, fontFamily: fonts.base, fontSize: textSize.small * scale, color: colors.mutedForeground },
    keyboardButton: {
      borderRadius: 10,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
      paddingHorizontal: spacing[3],
      paddingVertical: 7,
      marginLeft: spacing[1],
    },
    keyboardButtonText: { fontFamily: fonts.baseSemi, fontSize: textSize.small * scale, color: colors.foreground },
    suggestButton: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      borderRadius: 999,
      backgroundColor: colors.accent,
      paddingHorizontal: spacing[3],
      paddingVertical: 7,
    },
    suggestButtonText: { fontFamily: fonts.baseSemi, fontSize: textSize.small * scale, color: colors.accentForeground },
  });
}
