import { useLocalSearchParams, useNavigation, useRouter } from "expo-router";
import { Archive, ArchiveRestore, ChevronLeft, Eye, EyeOff, MoreHorizontal, Plus, RotateCw, Sparkles, Trash2, X } from "lucide-react-native";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Keyboard,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { GentleKeyboardAvoidingView } from "../../../src/ui/GentleKeyboardAvoidingView";
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
const REINDEX_DELAY_MS = 4_000;
// Roughly four lines: below this the note stops feeling like somewhere to write.
const MIN_BODY_HEIGHT = 120;
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
  const { id: routeId } = useLocalSearchParams<{ id: string }>();
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
  const revealStyle = useAnimatedStyle(() => ({
    opacity: reveal.value,
    transform: [{ translateY: (1 - reveal.value) * 8 }],
  }));
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
  const [tagIds, setTagIds] = useState<string[]>([]);
  const tagIdsRef = useRef(tagIds);
  tagIdsRef.current = tagIds;
  const [areasOpen, setAreasOpen] = useState(false);
  const { query: tasksQuery, createProject } = useTasks(undefined, TASKS_ENABLED);
  const allProjects = tasksQuery.data?.projects ?? [];
  const [cursorPos, setCursorPos] = useState(0);
  const [editorTab, setEditorTab] = useState<"note" | "tasks">("note");
  // The suggestion tray, in the keyboard's place. Closing it with the
  // keyboard coming back lets the two swap without the note moving.
  const [trayOpen, setTrayOpen] = useState(false);
  const [trayKeyboardComing, setTrayKeyboardComing] = useState(false);
  const bodyRef = useRef<TextInput>(null);
  const titleInputRef = useRef<TextInput>(null);
  // Where the writer was typing, so Keyboard takes them back there.
  const lastFieldRef = useRef<"title" | "body">("body");
  const [pendingSelection, setPendingSelection] = useState<number | null>(null);
  const [selection, setSelection] = useState<{ start: number; end: number } | undefined>();

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
  const lastSavedRef = useRef<{ title: string; content: string } | null>(null);
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

    // Put a copy of the note on screen: the local draft wins if it is newer.
    // Says whether the draft was used.
    const applyNote = (note: NoteRecord, draft: LocalDraft | null): boolean => {
      const useDraft = Boolean(draft && draft.at > note.updatedAt.getTime());
      if (draft && useDraft) {
        setTitle(draft.title);
        setContent(draft.content);
        baselineContentRef.current = draft.content;
        setCursorPos(draft.content.length);
        setStatus("saving");
      } else {
        setTitle(note.title);
        setContent(note.content);
        baselineContentRef.current = note.content;
        setCursorPos(note.content.length);
        setStatus("saved");
      }
      lastSavedRef.current = { title: note.title, content: note.content };
      setNoteId(note.id);
      noteIdRef.current = note.id;
      setArchived(note.archived);
      setTagIds(note.projectIds ?? []);
      loadedKeyRef.current = draftKey;
      setLoaded(true);
      return useDraft;
    };

    void (async () => {
      // Opened from a list: it already holds the whole note, so show that at
      // once and check with the server behind it.
      const cached = findCachedNote(queryClient, routeId as string);
      let openedFromDraft = false;
      if (cached) {
        const draft = await localDrafts.load(draftKey);
        if (cancelled) return;
        openedFromDraft = applyNote(cached, draft);
      }
      try {
        const { note } = await getNote({ id: routeId as string });
        if (cancelled) return;
        if (cached) {
          // Only a newer copy matters, and only while the writer has not
          // started; their words are never swapped out under them.
          // An unsaved draft on screen is kept too. The draft written a
          // moment ago is only the list's copy, so it is not consulted.
          const untouched =
            contentRef.current === baselineContentRef.current && !titleTouchedRef.current;
          // Changes made here and still on their way are newer than the server's copy.
          const waiting = outbox.isPending(`note:${note.id}`);
          if (!openedFromDraft && !waiting && untouched && note.updatedAt.getTime() > cached.updatedAt.getTime()) {
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
          setCursorPos(draft.content.length);
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
      if (noteIdRef.current && saved && saved.title === nextTitle && saved.content === nextContent) {
        setStatus("saved");
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
          archived: false,
          source: null,
          createdAt: now,
          updatedAt: now,
          projectIds: tagIdsRef.current,
        });
      } else {
        const id = noteIdRef.current;
        outbox.enqueue({ kind: "note.update", body: { id, title: nextTitle, content: nextContent } });
        const current = findCachedNote(queryClient, id);
        if (current) upsertNoteInLists(queryClient, { ...current, title: nextTitle, content: nextContent, updatedAt: now });
      }
      lastSavedRef.current = { title: nextTitle, content: nextContent };
      setStatus("saved");
      await localDrafts.clear(draftKey);
    },
    [draftKey, newId, queryClient],
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

  const textBeforeCursor = useMemo(() => content.slice(0, cursorPos), [content, cursorPos]);
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

  const insertSuggestion = useCallback(
    (suggestion: BubbleSuggestion) => {
      const current = contentRef.current;
      const start = cursorPos;
      let before = current.slice(0, start);
      const after = current.slice(start);
      const trimmedBefore = before.trimEnd();
      const midClause = /[,;:({["'‘“–—-]$/.test(trimmedBefore);

      let text = suggestion.text;
      if (isCompletionSuggestion(suggestion)) {
        // Finishes the sentence it follows: the model's own casing, unless
        // there is no sentence left to finish.
        if (shouldCapitalize(before)) text = text.charAt(0).toUpperCase() + text.slice(1);
      } else if (shouldCapitalize(before)) {
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

      const next = before + inserted + after;
      const caret = before.length + inserted.length;
      contentRef.current = next;
      setContent(next);
      setPendingSelection(caret);
      accept(suggestion);
      return caret;
    },
    [accept, cursorPos],
  );

  // A question goes in as its own line where the cursor is, with the cursor
  // on the line below it, ready for the answer.
  const insertQuestion = useCallback(
    (question: string) => {
      const current = contentRef.current;
      const before = current.slice(0, cursorPos).replace(/\s+$/, "");
      const after = current.slice(cursorPos).replace(/^\s+/, "");
      const block = (before ? "\n\n" : "") + question + "\n";
      const next = before + block + (after ? "\n" + after : "");
      const caret = before.length + block.length;
      contentRef.current = next;
      setContent(next);
      setPendingSelection(caret);
      return caret;
    },
    [cursorPos],
  );

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

  /**
   * Back to typing, only ever from Keyboard or an added suggestion: the
   * keyboard comes up as the tray goes down. With a caret position (after an
   * added suggestion) the cursor lands in the note there; otherwise the
   * writer goes back to the field they were in.
   */
  const backToKeyboard = useCallback((caret?: number) => {
    setTrayKeyboardComing(true);
    setTrayOpen(false);
    const field = caret !== undefined || lastFieldRef.current === "body" ? bodyRef : titleInputRef;
    // A field tapped while the tray was open is focused with no keyboard;
    // it has to let go and take focus again for the keyboard to come.
    field.current?.blur();
    setTimeout(() => {
      field.current?.focus();
      if (caret !== undefined) field.current?.setSelection(caret, caret);
    }, 60);
  }, []);

  // With the tray open, a tap in the note only moves the cursor (no
  // keyboard); once it rests somewhere new, fetch for that spot.
  useEffect(() => {
    if (!trayOpen) return;
    const timer = setTimeout(() => void refreshIfStale(), CURSOR_REFRESH_MS);
    return () => clearTimeout(timer);
  }, [trayOpen, cursorPos, refreshIfStale]);

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
  const statusLabel =
    status === "idle"
      ? ""
      : pendingHere
        ? online
          ? "Saving…"
          : "Saved on this device"
        : status === "saving"
          ? "Saving…"
          : status === "offline"
            ? "Saved on this device"
            : "Saved";

  return (
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
                setTitle(value);
              }}
              ref={titleInputRef}
              editable={loaded}
              onFocus={() => {
                lastFieldRef.current = "title";
              }}
              showSoftInputOnFocus={!trayOpen}
              placeholder={loaded ? "Untitled" : ""}
              placeholderTextColor={colors.mutedForeground}
              maxLength={300}
              style={styles.titleInput}
              accessibilityLabel="Note title"
              returnKeyType="done"
            />
            </Animated.View>
            {/* Reserved height even when blank, so the header never shifts. */}
            <Text style={styles.status} numberOfLines={1}>
              {statusLabel}
            </Text>
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

        {TASKS_ENABLED && loaded ? (
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

        {TASKS_ENABLED ? (
        <View style={styles.tabs}>
        <Segmented
          size="sm"
          accessibilityLabel="Note sections"
          value={editorTab}
          onChange={(value) => {
            if (value === "tasks") {
              // Saving puts the note in the outbox under its own id, so its
              // tasks can open at once, online or not.
              void persist(titleRef.current, contentRef.current);
              if (noteIdRef.current) setEditorTab("tasks");
              else toast.show("Write something in the note first; its tasks are kept with it.");
            } else {
              setEditorTab("note");
            }
          }}
          options={[
            { label: "Note", value: "note" },
            { label: "Tasks", value: "tasks" },
          ]}
        />
        </View>
        ) : null}

        {/* Note and Tasks cross-fade rather than cut. */}
        <FadeSwitch switchKey={editorTab} style={styles.flex}>
        {!TASKS_ENABLED || editorTab === "note" ? (
          <View style={styles.flex}>
            <ScrollView
              style={styles.flex}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={styles.notePanel}
            >
              {!loaded ? (
                <Animated.View style={styles.bodySkeleton} exiting={FadeOut.duration(MOTION.fast)}>
                  <Skeleton style={styles.skeletonLine} />
                  <Skeleton style={styles.skeletonLine} />
                  <Skeleton style={styles.skeletonLineShort} />
                </Animated.View>
              ) : (
                <Animated.View style={revealStyle}>
              <TextInput
                ref={bodyRef}
                multiline
                autoFocus={isNew}
                onFocus={() => {
                  lastFieldRef.current = "body";
                }}
                // With the tray open a tap places the cursor and nothing
                // more; only Keyboard brings the keyboard back.
                showSoftInputOnFocus={!trayOpen}
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
                // No height here, on purpose. Under the new architecture the
                // shadow node measures the text on every keystroke, so an
                // unsized multiline input grows with its content by itself.
                // Pinning the height from onContentSizeChange defeats that:
                // that event only fires from updateLayoutMetrics, i.e. when
                // the frame changes — which a pinned height never lets happen.
                // With the box always fitting the text there is nothing for
                // the input to scroll, so its own scrolling is off and the
                // surrounding ScrollView carries the note and chips together.
                scrollEnabled={false}
                style={styles.body}
                textAlignVertical="top"
              />
                </Animated.View>
              )}
            </ScrollView>
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
                onPick={(suggestion) => backToKeyboard(insertSuggestion(suggestion))}
                onPickQuestion={(question) => backToKeyboard(insertQuestion(question))}
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
  );
}

function makeStyles(colors: Colors, scale: number) {
  return StyleSheet.create({
    page: { flex: 1, backgroundColor: colors.background },
    flex: { flex: 1 },
    titleWrap: { alignSelf: "stretch" },
    bodySkeleton: { gap: spacing[3], paddingTop: spacing[2] },
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
    body: {
      // Height comes from the text itself (see the input). The floor keeps a
      // usable tap target on an empty note.
      minHeight: MIN_BODY_HEIGHT,
      fontFamily: fonts.base,
      fontSize: textSize.large * scale,
      lineHeight: 28 * scale,
      color: colors.foreground,
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
