import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Helmet } from "react-helmet-async";
import { toast } from "sonner";
import { ChevronLeft, Mic, RotateCcw } from "lucide-react";
import { Button } from "../components/Button";
import { Spinner } from "../components/Spinner";
import { InlineSuggestions } from "../components/InlineSuggestions";
import { ReflectionStrip } from "../components/ReflectionStrip";
import { NoteTasks } from "../components/NoteTasks";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/Tabs";
import { useSuggestions } from "../helpers/useSuggestions";
import { useReindexNotes } from "../helpers/useNotes";
import { localDrafts } from "../helpers/localDrafts";
import { getNote } from "../endpoints/notes/get_GET.schema";
import { postNoteCreate } from "../endpoints/notes/create_POST.schema";
import { postNoteUpdate } from "../endpoints/notes/update_POST.schema";
import {
  isCompletionSuggestion,
  type BubbleSuggestion,
} from "../helpers/suggestionCategories";
import styles from "./note.$noteId.module.css";

type SaveStatus = "idle" | "saving" | "saved" | "offline";

const SERVER_SAVE_DELAY_MS = 900;
const REINDEX_DELAY_MS = 4_000;
const UNDO_VISIBLE_MS = 7_000;

function shouldCapitalize(before: string): boolean {
  const trimmed = before.trimEnd();
  return trimmed.length === 0 || /[.!?]$/.test(trimmed);
}

export default function NoteEditorPage() {
  const { noteId: routeId } = useParams<{ noteId: string }>();
  const isNew = routeId === "new";
  const navigate = useNavigate();

  const [noteId, setNoteId] = useState<string | null>(isNew ? null : routeId ?? null);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [cursorPos, setCursorPos] = useState(0);
  const [editorTab, setEditorTab] = useState<"note" | "tasks">("note");
  const [suggestionsExpanded, setSuggestionsExpanded] = useState(false);
  const [undoState, setUndoState] = useState<{
    text: string;
    cursor: number;
  } | null>(null);
  const [pendingSelection, setPendingSelection] = useState<number | null>(null);

  const contentRef = useRef(content);
  contentRef.current = content;
  const titleRef = useRef(title);
  titleRef.current = title;
  const noteIdRef = useRef(noteId);
  noteIdRef.current = noteId;
  const creatingRef = useRef(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const undoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const draftKey = isNew ? "new" : (routeId ?? "new");

  const reindex = useReindexNotes();
  const reindexRef = useRef(reindex.mutate);
  reindexRef.current = reindex.mutate;

  // ---- Load: the server copy, unless a newer draft is on this device ----
  useEffect(() => {
    let cancelled = false;

    const applyDraftOnly = () => {
      const draft = localDrafts.load(draftKey);
      if (draft) {
        setTitle(draft.title);
        setContent(draft.content);
        setCursorPos(draft.content.length);
      }
      setLoaded(true);
    };

    if (isNew) {
      applyDraftOnly();
      return;
    }

    (async () => {
      try {
        const { note } = await getNote({ id: routeId as string });
        if (cancelled) return;
        const draft = localDrafts.load(draftKey);
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
        setLoaded(true);
      } catch {
        if (cancelled) return;
        const draft = localDrafts.load(draftKey);
        if (draft) {
          setTitle(draft.title);
          setContent(draft.content);
          setCursorPos(draft.content.length);
          setStatus("offline");
          setLoaded(true);
        } else {
          toast.error("Couldn't open this note. Please try again.");
          navigate("/", { replace: true });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [routeId, isNew, draftKey, navigate]);

  // ---- Save: this device immediately, the server after a short pause ----
  const persist = useCallback(
    async (nextTitle: string, nextContent: string) => {
      if (
        nextTitle.trim() === "" &&
        nextContent.trim() === "" &&
        !noteIdRef.current
      ) {
        setStatus("idle");
        return; // never create empty notes
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
            // Keep the URL in step so a refresh reopens the real note.
            window.history.replaceState(null, "", `/note/${note.id}`);
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
        localDrafts.clear(draftKey);
        setStatus("saved");
      } catch {
        // The words stay on this device; writing is never blocked by sync.
        setStatus("offline");
      }
    },
    [draftKey],
  );

  useEffect(() => {
    if (!loaded) return;
    localDrafts.save(draftKey, { title, content, at: Date.now() });
    const timer = setTimeout(() => {
      void persist(title, content);
    }, SERVER_SAVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [title, content, loaded, draftKey, persist]);

  // ---- Entity indexing, well after typing settles ----
  useEffect(() => {
    if (!loaded || !noteId) return;
    const timer = setTimeout(() => {
      reindexRef.current({ noteId });
    }, REINDEX_DELAY_MS);
    return () => clearTimeout(timer);
  }, [loaded, noteId, title, content]);

  // ---- Suggestions ----
  const textBeforeCursor = useMemo(
    () => content.slice(0, cursorPos),
    [content, cursorPos],
  );

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
      enabled: loaded,
    });

  // ---- Editor mechanics ----
  const growTextarea = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, []);

  useLayoutEffect(() => {
    growTextarea();
  }, [content, growTextarea]);

  // Move the caret only after React has committed the inserted text.
  useLayoutEffect(() => {
    if (pendingSelection === null) return;
    const el = textareaRef.current;
    if (el) {
      el.focus();
      el.setSelectionRange(pendingSelection, pendingSelection);
    }
    setCursorPos(pendingSelection);
    setPendingSelection(null);
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
      const el = textareaRef.current;
      const current = contentRef.current;
      const start = el?.selectionStart ?? current.length;
      const end = el?.selectionEnd ?? start;

      let before = current.slice(0, start);
      const after = current.slice(end);
      const trimmedBefore = before.trimEnd();
      const midClause = /[,;:({["'‘“–—-]$/.test(trimmedBefore);

      let text = suggestion.text;
      if (isCompletionSuggestion(suggestion)) {
        // Completion fragments continue exactly where the writer paused.
        if (shouldCapitalize(before)) {
          text = text.charAt(0).toUpperCase() + text.slice(1);
        }
      } else if (shouldCapitalize(before)) {
        text = text.charAt(0).toUpperCase() + text.slice(1);
      } else if (midClause) {
        text = text.charAt(0).toLowerCase() + text.slice(1);
      } else {
        // Stems open a new sentence — gently close the current one first.
        before = trimmedBefore + ".";
        text = text.charAt(0).toUpperCase() + text.slice(1);
      }

      const needsSpaceBefore =
        before.length > 0 && !/\s$/.test(before) && !/^[,.!?;:'")]/.test(text);
      const needsSpaceAfter = after.length === 0 || !/^\s/.test(after);
      const inserted =
        (needsSpaceBefore ? " " : "") + text + (needsSpaceAfter ? " " : "");

      setUndoState({ text: current, cursor: start });
      scheduleUndoExpiry();

      const next = before + inserted + after;
      contentRef.current = next;
      setContent(next);
      setPendingSelection(before.length + inserted.length);
      setSuggestionsExpanded(false);
      accept(suggestion);
    },
    [accept, scheduleUndoExpiry],
  );

  const answerQuestion = useCallback(() => {
    const current = contentRef.current;
    const trimmed = current.replace(/\s+$/, "");
    const next =
      (trimmed.length > 0 ? trimmed + "\n\n" : "") + reflectionQuestion + "\n";

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
    navigate("/");
  }, [navigate, persist]);

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
      <main className={styles.loadingPage}>
        <Spinner size="md" />
      </main>
    );
  }

  return (
    <>
      <Helmet>
        <title>{title.trim() || "New note"} · Clarity Notes</title>
      </Helmet>
      <main className={styles.page}>
        <header className={styles.header}>
          <Button
            variant="ghost"
            size="icon-lg"
            aria-label="Back to your notes"
            className={styles.headerButton}
            onClick={goBack}
          >
            <ChevronLeft className={styles.backIcon} aria-hidden="true" />
          </Button>
          <span className={styles.status} aria-live="polite">
            {statusLabel}
          </span>
          <Button
            variant="ghost"
            size="icon-lg"
            aria-label="Voice typing (coming soon)"
            className={styles.headerButton}
            onClick={() =>
              toast("Voice typing is coming soon", {
                description:
                  "For now you can type your note and use the word bubbles below.",
              })
            }
          >
            <Mic className={styles.micIcon} aria-hidden="true" />
          </Button>
        </header>

        <div className={styles.editor}>
          <input
            className={styles.titleInput}
            placeholder="Title"
            aria-label="Note title"
            maxLength={300}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />

          <Tabs
            value={editorTab}
            className={styles.editorTabs}
            onValueChange={(value) => {
              if (value === "tasks") {
                void persist(titleRef.current, contentRef.current).then(() => setEditorTab("tasks"));
              } else {
                setEditorTab("note");
              }
            }}
          >
            <TabsList className={styles.tabList} aria-label="Note sections">
              <TabsTrigger className={styles.tabTrigger} value="note">Note</TabsTrigger>
              <TabsTrigger className={styles.tabTrigger} value="tasks">Tasks</TabsTrigger>
            </TabsList>

            <TabsContent value="note" className={styles.notePanel}>
              <textarea
                ref={textareaRef}
                className={styles.body}
                placeholder="Start writing…"
                aria-label="Note text"
                autoFocus={isNew}
                value={content}
                onChange={(e) => {
                  setContent(e.target.value);
                  setCursorPos(e.target.selectionStart ?? e.target.value.length);
                }}
                onSelect={(e) => {
                  const el = e.currentTarget;
                  if (pendingSelection === null) {
                    setCursorPos(el.selectionStart ?? 0);
                  }
                }}
              />

              <InlineSuggestions
                suggestions={suggestions}
                completionSuggestions={completionSuggestions}
                loading={loading}
                expanded={suggestionsExpanded}
                onToggleExpanded={() => setSuggestionsExpanded((v) => !v)}
                onAccept={insertSuggestion}
                onDismiss={dismiss}
              />

              {undoState && (
                <div className={styles.undoRow}>
                  <button
                    type="button"
                    className={styles.undoChip}
                    onClick={undoInsert}
                    aria-label="Undo the last inserted phrase"
                  >
                    <RotateCcw className={styles.undoIcon} aria-hidden="true" />
                    Undo
                  </button>
                </div>
              )}
            </TabsContent>

            <TabsContent value="tasks">
              <NoteTasks noteId={noteId} enabled={editorTab === "tasks"} />
            </TabsContent>
          </Tabs>
        </div>

        {editorTab === "note" && (
          <div className={styles.footer}>
            <ReflectionStrip question={reflectionQuestion} onPress={answerQuestion} />
          </div>
        )}
      </main>
    </>
  );
}