import { useLocalSearchParams, useRouter } from "expo-router";
import { Archive, ArchiveRestore, ChevronLeft, Eye, EyeOff, MoreHorizontal, Plus, Sparkles, Trash2 } from "lucide-react-native";
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
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { getNote, postNoteCreate, postNoteUpdate } from "../../../src/api/notes";
import { upsertNoteInLists, useDeleteNote, useReindexNotes, useUpdateNote } from "../../../src/hooks/useNotes";
import { useQueryClient } from "@tanstack/react-query";
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
import { Sheet } from "../../../src/ui/Sheet";
import Animated from "react-native-reanimated";
import { fadeInFast, fadeOut, layoutTransition } from "../../../src/ui/motion";
import { FadeSwitch } from "../../../src/ui/FadeSwitch";
import { AreaPickerSheet } from "../../../src/ui/AreaPickerSheet";
import { useTasks } from "../../../src/hooks/useTasks";
import { areaColor } from "../../../src/lib/lifeCenter";
import { InlineSuggestions } from "../../../src/ui/InlineSuggestions";
import { NoteTasks } from "../../../src/ui/NoteTasks";
import { ReflectionStrip } from "../../../src/ui/ReflectionStrip";
import { Skeleton } from "../../../src/ui/Skeleton";
import { Segmented } from "../../../src/ui/Segmented";

type SaveStatus = "idle" | "saving" | "saved" | "offline";

const SERVER_SAVE_DELAY_MS = 900;
const REINDEX_DELAY_MS = 4_000;
// Roughly four lines: below this the note stops feeling like somewhere to write.
const MIN_BODY_HEIGHT = 120;

function shouldCapitalize(before: string): boolean {
  const trimmed = before.trimEnd();
  return trimmed.length === 0 || /[.!?]$/.test(trimmed);
}

export default function NoteEditorScreen() {
  const { id: routeId } = useLocalSearchParams<{ id: string }>();
  const isNew = routeId === "new";
  const router = useRouter();
  const toast = useToast();
  const { colors, scale, aiSuggestions, setAiSuggestions } = useAppTheme();
  const styles = useMemo(() => makeStyles(colors, scale), [colors, scale]);

  const [noteId, setNoteId] = useState<string | null>(isNew ? null : routeId ?? null);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [status, setStatus] = useState<SaveStatus>("idle");
  // Archive and delete live here now that the notes list has no "…" menu.
  const [archived, setArchived] = useState(false);
  const [menu, setMenu] = useState<"closed" | "open" | "confirmDelete">("closed");
  const updateNote = useUpdateNote();
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
  const [suggestionsExpanded, setSuggestionsExpanded] = useState(false);
  const [pendingSelection, setPendingSelection] = useState<number | null>(null);
  const [selection, setSelection] = useState<{ start: number; end: number } | undefined>();

  const contentRef = useRef(content);
  contentRef.current = content;
  const titleRef = useRef(title);
  titleRef.current = title;
  const noteIdRef = useRef(noteId);
  noteIdRef.current = noteId;
  const creatingRef = useRef(false);

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
        setArchived(note.archived);
        setTagIds(note.projectIds ?? []);
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
              ...(tagIdsRef.current.length ? { projectIds: tagIdsRef.current } : {}),
            });
            setNoteId(note.id);
            noteIdRef.current = note.id;
            // Show it in the notes list straight away.
            upsertNoteInLists(queryClient, note);
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
          const { note } = await postNoteUpdate({
            id: noteIdRef.current,
            title: nextTitle,
            content: nextContent,
          });
          upsertNoteInLists(queryClient, note);
        }
        await localDrafts.clear(draftKey);
        setStatus("saved");
      } catch {
        setStatus("offline");
      }
    },
    [draftKey, queryClient],
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

      const next = before + inserted + after;
      contentRef.current = next;
      setContent(next);
      setPendingSelection(before.length + inserted.length);
      setSuggestionsExpanded(false);
      accept(suggestion);
    },
    [accept, cursorPos],
  );

  const answerQuestion = useCallback(() => {
    if (!reflectionQuestion) return;
    const current = contentRef.current;
    const trimmed = current.replace(/\s+$/, "");
    const next = (trimmed.length > 0 ? trimmed + "\n\n" : "") + reflectionQuestion + "\n";
    contentRef.current = next;
    setContent(next);
    setPendingSelection(next.length);
  }, [reflectionQuestion]);

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
          <View style={styles.headerCenter}>
            <TextInput
              value={title}
              onChangeText={setTitle}
              editable={loaded}
              placeholder={loaded ? "Untitled" : ""}
              placeholderTextColor={colors.mutedForeground}
              maxLength={300}
              style={styles.titleInput}
              accessibilityLabel="Note title"
              returnKeyType="done"
            />
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
                    <View style={[styles.areaDot, { backgroundColor: areaColor(project.id) }]} />
                    <Text style={styles.areaChipText}>{project.name}</Text>
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
              {aiSuggestions ? (
                <InlineSuggestions
                  suggestions={suggestions}
                  completionSuggestions={completionSuggestions}
                  loading={loading}
                  expanded={suggestionsExpanded}
                  onToggleExpanded={() => setSuggestionsExpanded((value) => !value)}
                  onAccept={insertSuggestion}
                  onDismiss={dismiss}
                />
              ) : null}
                </>
              )}
            </ScrollView>
            <View style={styles.footer}>
              <View style={styles.toolbar}>
                <Text style={styles.toolbarLabel}>
                  {aiSuggestions ? "AI suggestions" : "AI suggestions off"}
                </Text>
                {aiSuggestions ? (
                  <Button
                    variant="ghost"
                    size="icon"
                    style={styles.toolButton}
                    onPress={requestSuggestions}
                    loading={loading}
                    accessibilityLabel="Get new suggestions for what you are writing"
                  >
                    <Sparkles size={18} color={colors.foreground} />
                  </Button>
                ) : null}
                <Button
                  variant="ghost"
                  size="icon"
                  style={styles.toolButton}
                  onPress={() => setAiSuggestions(!aiSuggestions)}
                  accessibilityLabel={aiSuggestions ? "Hide AI suggestions" : "Show AI suggestions"}
                >
                  {aiSuggestions ? (
                    <EyeOff size={18} color={colors.foreground} />
                  ) : (
                    <Eye size={18} color={colors.foreground} />
                  )}
                </Button>
              </View>
              {aiSuggestions && reflectionQuestion ? (
                <ReflectionStrip question={reflectionQuestion} onPress={answerQuestion} />
              ) : null}
            </View>
          </View>
        ) : (
          <View style={styles.flex}>
            <ScrollView contentContainerStyle={styles.notePanel} keyboardShouldPersistTaps="handled">
              <NoteTasks noteId={noteId} enabled={editorTab === "tasks"} />
            </ScrollView>
          </View>
        )}
        </FadeSwitch>
      </KeyboardAvoidingView>

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
      fontSize: 20 * scale,
      color: colors.foreground,
      paddingVertical: 2,
    },
    status: {
      fontFamily: fonts.base,
      fontSize: 12 * scale,
      lineHeight: 16 * scale,
      color: colors.mutedForeground,
    },
    tabs: { alignSelf: "center", marginBottom: spacing[2] },
    headerSpacer: { width: 48, height: 48 },
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
    areaChipText: { fontFamily: fonts.base, fontSize: 13 * scale, color: colors.foreground },
    areaChipMuted: { fontFamily: fonts.base, fontSize: 13 * scale, color: colors.mutedForeground },
    menuRow: { flexDirection: "row", alignItems: "center", gap: spacing[3], paddingVertical: spacing[4] },
    menuDivider: { borderTopWidth: 1, borderTopColor: colors.border },
    menuText: { fontFamily: fonts.base, fontSize: 17 * scale, color: colors.foreground },
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
      fontSize: 18 * scale,
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
      fontSize: 12 * scale,
      letterSpacing: 0.4,
      color: colors.mutedForeground,
    },
    toolButton: { width: 36, height: 36 },
  });
}
