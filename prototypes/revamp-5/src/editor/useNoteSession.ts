import { onlineManager, useQueryClient, type QueryClient } from "@tanstack/react-query";
import * as Crypto from "expo-crypto";
import { useCallback, useEffect, useRef, useState } from "react";
import { findCachedNote, getNote, upsertNoteInLists } from "../core/hooks/useNotes";
import { TASKS_QUERY_KEY } from "../core/hooks/useTasks";
import { localDrafts, type LocalDraft } from "../core/lib/localDrafts";
import { noteDocs } from "../core/lib/noteDocs";
import { postNotesReindex, postSuggestTitle } from "../core/api/notes";
import { outbox, waitUntilSynced } from "../core/sync/store";
import { aiOn } from "../data/ai";
import type { NoteRecord, ProjectRecord } from "../core/types";
import { hasWriting, markdownOfBlocks, noteFacts } from "../data/adapt";
import { getSage, useSage } from "../data/sage";
import type { EditorSeed } from "./bridge";
import { draftWins, serverCopyReplaces } from "./noteCopies";

/**
 * A note's page, apart from its drawing: what it opens with, and how what's
 * written is kept. Two of them, one per source, behind one shape:
 * - your account's (`useAccountNoteSession`): the main app's save rules
 *   (mobile/app/(app)/note/[id].tsx at 4344bd8), lifted out: a draft on the
 *   phone at most every second, the newer of the draft and the server's copy
 *   winning, and the server's copy never replacing words being typed. One
 *   change from the main app, to spend fewer calls: the server hears at most
 *   once a minute while writing (the main app sends 900 ms after every
 *   pause), and at once on leaving or going to the background. A new note is
 *   still made as its first words settle, so it's never only on the phone;
 * - the samples' (`useDemoNoteSession`): the same page, saved into the
 *   sample store and nowhere else.
 */
export type NoteSession = {
  /** The note's words are in (the editor can be given them). */
  loaded: boolean;
  /** The note's id once it exists: a new one's from its first words. */
  noteId: string | null;
  title: string;
  /** Typed in the title field. */
  setTitle: (title: string) => void;
  /** What the editor takes in, again whenever its key changes. */
  seed: EditorSeed;
  /** The editor's words, as it sends them. */
  change: (markdown: string, doc: unknown) => void;
  /** Leaving (Done, back, the swipe back): saved now, and words still arriving are saved as they come. */
  leave: () => void;
  /** Sent now, not waiting for the minute: going to the background, or opening the note's tasks. */
  saveNow: () => void;
  /** A page not yet written on starts over (another question, or none). */
  restart: (markdown: string, doc: unknown) => void;
  /** Deleted: nothing more is saved. */
  discard: () => void;
  /** Written on: a title, or words beyond the questions asked. */
  written: boolean;
  createdAt: Date | null;
  /** The note isn't on this phone and couldn't be fetched. */
  missing: boolean;
};

export type NoteParams = {
  /** The note's id, or "new". */
  id: string;
  /** A new page's first question (Today's question). */
  prompt?: string;
  /** A page written to Today's question: saved as the day's page. */
  page: boolean;
  /** The questions put on the page so far. */
  asked: () => string[];
};

// The phone's draft: at most once a second while writing.
const DRAFT_WRITE_MS = 1_000;
// The server, while writing: at most once a minute. Leaving the note, going to
// the background and opening its tasks send at once.
const SEND_EVERY_MS = 60_000;
// A new note is made on the server as its first words settle.
const CREATE_AFTER_MS = 900;
// The samples: saved into the sample store after a pause (nothing is sent anywhere).
const DEMO_SAVE_DELAY_MS = 900;

/** A page that starts with a question: the question as a quote, and an empty line under it for the answer. */
export function questionPage(question: string): { markdown: string; doc: unknown } {
  return {
    markdown: `> ${question}`,
    doc: {
      type: "doc",
      content: [{ type: "blockquote", content: [{ type: "paragraph", content: [{ type: "text", text: question }] }] }, { type: "paragraph" }],
    },
  };
}

/**
 * A note's rich text as the editor takes it. The server has stored every
 * rich text so far as a quoted string inside its JSON column (it encoded it
 * twice), so a string is read back into the document it holds. Anything
 * else that isn't a document is no rich text at all: the Markdown stands.
 */
export function asDoc(value: unknown): unknown {
  let doc = value;
  if (typeof doc === "string") {
    try {
      doc = JSON.parse(doc);
    } catch {
      return null;
    }
  }
  return doc && typeof doc === "object" && (doc as { type?: unknown }).type === "doc" ? doc : null;
}

/** An area's id from its name, as the phone's copy of the lists has them. */
function areaIds(queryClient: QueryClient, name: string | null): string[] {
  if (!name) return [];
  const wanted = name.trim().toLowerCase();
  for (const [, data] of queryClient.getQueriesData<{ projects?: ProjectRecord[] }>({ queryKey: TASKS_QUERY_KEY })) {
    const found = data?.projects?.find((project) => project.name.trim().toLowerCase() === wanted);
    if (found) return [found.id];
  }
  return [];
}

/** Your account's note: the main app's save rules. */
export function useAccountNoteSession({ id: routeId, prompt, page, asked }: NoteParams): NoteSession {
  const isNew = routeId === "new";
  const queryClient = useQueryClient();
  const askedRef = useRef(asked);
  askedRef.current = asked;

  const [newId] = useState(() => (isNew ? Crypto.randomUUID() : null));
  // The note's id: its own, or a new one's, made as it opened. It's saved
  // (to the outbox) under this id from the first word, online or not.
  const draftKey = isNew ? (newId as string) : routeId;
  const [noteId, setNoteId] = useState<string | null>(isNew ? null : routeId);
  const noteIdRef = useRef(noteId);
  const [title, setTitleState] = useState("");
  const titleRef = useRef("");
  const [loaded, setLoaded] = useState(false);
  const [createdAt, setCreatedAt] = useState<Date | null>(isNew ? new Date() : null);
  const [missing, setMissing] = useState(false);
  const [written, setWritten] = useState(!isNew);
  const [seed, setSeed] = useState<EditorSeed>({ key: "boot", markdown: "", doc: null, focus: null });
  const seeds = useRef(0);
  const reseed = (markdown: string, doc: unknown, focus: "end" | null = null) => setSeed({ key: String(++seeds.current), markdown, doc, focus });

  // The words (Markdown) and rich text as the editor last sent them.
  const contentRef = useRef("");
  const docRef = useRef<unknown>(null);
  const [changes, setChanges] = useState(0);
  // The text as the note opened: only a changed text is ever saved over it.
  const baselineRef = useRef<string | null>(null);
  const titleTouchedRef = useRef(false);
  // The title, words and rich text as last saved (or loaded).
  const lastSavedRef = useRef<{ title: string; content: string; doc: string } | null>(null);
  // Changed since the last save: only then is a draft worth writing.
  const unsavedRef = useRef(false);
  const draftTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Whose words the page holds: until it matches draftKey, nothing is saved.
  const loadedKeyRef = useRef<string | null>(null);
  const leftRef = useRef(false);

  const cancelDraft = () => {
    unsavedRef.current = false;
    if (draftTimerRef.current) clearTimeout(draftTimerRef.current);
    draftTimerRef.current = null;
  };

  const useText = (nextTitle: string, markdown: string, doc: unknown) => {
    titleRef.current = nextTitle;
    setTitleState(nextTitle);
    contentRef.current = markdown;
    docRef.current = doc;
    baselineRef.current = markdown;
  };

  useEffect(() => {
    let cancelled = false;
    if (isNew) {
      // A new page: its question, if it was opened from one.
      const start = prompt ? questionPage(prompt) : { markdown: "", doc: null };
      useText("", start.markdown, start.doc);
      reseed(start.markdown, start.doc, "end");
      loadedKeyRef.current = draftKey;
      setLoaded(true);
      return;
    }

    // A copy of the note on screen: the draft on the phone wins if it's newer.
    const applyNote = (note: NoteRecord, draft: LocalDraft | null): boolean => {
      const useDraft = draftWins(draft, note);
      if (draft && useDraft) {
        useText(draft.title, draft.content, asDoc(draft.doc));
        reseed(draft.content, asDoc(draft.doc));
        unsavedRef.current = true;
      } else {
        useText(note.title, note.content, asDoc(note.doc));
        reseed(note.content, asDoc(note.doc));
      }
      lastSavedRef.current = { title: note.title, content: note.content, doc: JSON.stringify(asDoc(note.doc)) };
      noteIdRef.current = note.id;
      setNoteId(note.id);
      setCreatedAt(new Date(note.createdAt));
      loadedKeyRef.current = draftKey;
      setLoaded(true);
      return useDraft;
    };

    void (async () => {
      // Opened from a list: it holds the note's words already, so they show
      // at once, and the server is asked behind them. The rich text isn't in
      // the lists; the phone keeps it for notes opened before (noteDocs).
      const listed = findCachedNote(queryClient, routeId);
      let cached: NoteRecord | null = null;
      let openedFromDraft = false;
      if (listed) {
        const [draft, doc] = await Promise.all([localDrafts.load(draftKey), noteDocs.load(listed.id, listed.content)]);
        if (cancelled) return;
        cached = { ...listed, doc: asDoc(doc) };
        openedFromDraft = applyNote(cached, draft);
      }
      try {
        const fetched = await getNote({ id: routeId });
        if (cancelled) return;
        const note: NoteRecord = { ...fetched.note, doc: asDoc(fetched.note.doc) };
        // Kept for next time, offline too.
        if (note.doc) void noteDocs.save(note.id, note.doc, note.content);
        else void noteDocs.remove(note.id);
        if (cached) {
          // Only a newer copy matters, and only while nothing's been typed or
          // is waiting to be sent: words are never swapped out under the writer.
          const replaces = serverCopyReplaces({
            openedFromDraft,
            waiting: outbox.isPending(`note:${note.id}`),
            untouched: contentRef.current === baselineRef.current && !titleTouchedRef.current,
            shown: cached,
            fetched: note,
          });
          if (replaces) applyNote(note, null);
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
          useText(draft.title, draft.content, asDoc(draft.doc));
          reseed(draft.content, asDoc(draft.doc));
          loadedKeyRef.current = draftKey;
          setLoaded(true);
        } else {
          setMissing(true);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // Loaded once per page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const persist = useCallback(
    async (nextTitle: string, nextContent: string) => {
      if (loadedKeyRef.current !== draftKey) return;
      // A page with only its questions on it isn't a note yet.
      if (!noteIdRef.current && !hasWriting(nextTitle, nextContent, askedRef.current())) return;
      // Nothing changed since it was saved (or loaded): saving again would
      // only mark it edited. Opening and closing a note never does.
      const saved = lastSavedRef.current;
      const doc = docRef.current ?? undefined;
      const docText = JSON.stringify(doc ?? null);
      if (noteIdRef.current && saved && saved.title === nextTitle && saved.content === nextContent && saved.doc === docText) {
        cancelDraft();
        void localDrafts.clear(draftKey);
        return;
      }
      // Into the outbox, which sends it now or, offline, when it can; the
      // lists show it straight away either way.
      const now = new Date();
      if (!noteIdRef.current) {
        const id = newId as string;
        const projectIds = areaIds(queryClient, getSage().draftArea);
        outbox.enqueue({
          kind: "note.create",
          body: {
            id,
            createdAt: now,
            title: nextTitle,
            content: nextContent,
            ...(doc ? { doc } : {}),
            ...(page ? { source: "page" as const } : {}),
            ...(projectIds.length ? { projectIds } : {}),
          },
        });
        noteIdRef.current = id;
        setNoteId(id);
        setCreatedAt(now);
        upsertNoteInLists(queryClient, {
          id,
          title: nextTitle,
          content: nextContent,
          doc: doc ?? null,
          archived: false,
          source: page ? "page" : null,
          createdAt: now,
          updatedAt: now,
          projectIds,
        });
      } else {
        const id = noteIdRef.current;
        // The rich text goes with its Markdown, or the server takes the words
        // as a plain edit and drops the rich text.
        outbox.enqueue({ kind: "note.update", body: { id, title: nextTitle, content: nextContent, ...(doc ? { doc } : {}), changedAt: now } });
        const current = findCachedNote(queryClient, id);
        if (current) upsertNoteInLists(queryClient, { ...current, title: nextTitle, content: nextContent, doc: doc ?? null, updatedAt: now });
      }
      lastSavedRef.current = { title: nextTitle, content: nextContent, doc: docText };
      // The rich text, for opening the note again (offline too).
      if (noteIdRef.current && doc) void noteDocs.save(noteIdRef.current, doc, nextContent);
      cancelDraft();
      await localDrafts.clear(draftKey);
    },
    // cancelDraft only touches refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [draftKey, newId, page, queryClient],
  );
  const persistRef = useRef(persist);
  persistRef.current = persist;

  /** The draft, now: only if something is unsaved. */
  const writeDraft = useCallback(() => {
    if (draftTimerRef.current) clearTimeout(draftTimerRef.current);
    draftTimerRef.current = null;
    if (!unsavedRef.current || loadedKeyRef.current !== draftKey) return;
    void localDrafts.save(draftKey, { title: titleRef.current, content: contentRef.current, doc: docRef.current ?? undefined, at: Date.now() });
  }, [draftKey]);
  const writeDraftRef = useRef(writeDraft);
  writeDraftRef.current = writeDraft;

  // While writing: the draft at most once a second; the server at most once a
  // minute, the first unsent change starting the clock. A new note is made as
  // its first words settle, so it's never only on the phone.
  const sendTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!loaded || loadedKeyRef.current !== draftKey) return;
    if (unsavedRef.current && !draftTimerRef.current) draftTimerRef.current = setTimeout(() => writeDraftRef.current(), DRAFT_WRITE_MS);
    if (!noteIdRef.current) {
      const timer = setTimeout(() => void persistRef.current(titleRef.current, contentRef.current), CREATE_AFTER_MS);
      return () => clearTimeout(timer);
    }
    if (unsavedRef.current && !sendTimerRef.current) {
      sendTimerRef.current = setTimeout(() => {
        sendTimerRef.current = null;
        void persistRef.current(titleRef.current, contentRef.current);
      }, SEND_EVERY_MS);
    }
  }, [title, changes, loaded, draftKey]);

  /**
   * Leaving a note whose words changed, with AI help on and a connection: an
   * untitled one is given a title quietly (from its words as they now stand),
   * and the note is indexed once, so word help can draw on it. Nothing is
   * offered while writing. Both wait for the note to reach the server.
   */
  const afterLeaving = () => {
    const id = noteIdRef.current;
    const content = contentRef.current;
    if (!id || !aiOn() || !onlineManager.isOnline() || content === baselineRef.current) return;
    const untitled = !titleRef.current.trim() && !titleTouchedRef.current && hasWriting("", content, askedRef.current());
    void (async () => {
      await waitUntilSynced(`note:${id}`, 10_000);
      if (untitled) {
        try {
          const { title } = await postSuggestTitle({ content });
          const current = findCachedNote(queryClient, id);
          // Titled meanwhile (here or elsewhere): that title stays.
          if (title && !current?.title.trim()) {
            const now = new Date();
            outbox.enqueue({ kind: "note.update", body: { id, title, changedAt: now } });
            if (current) upsertNoteInLists(queryClient, { ...current, title, updatedAt: now });
          }
        } catch {
          // Untitled is fine: the lists show its first line.
        }
      }
      void postNotesReindex({ noteId: id }).catch(() => {});
    })();
  };

  /** To the server now, not waiting for the minute. */
  const sendNow = useCallback(() => {
    if (sendTimerRef.current) clearTimeout(sendTimerRef.current);
    sendTimerRef.current = null;
    void persistRef.current(titleRef.current, contentRef.current);
  }, []);

  // Gone without leaving (an unexpected unmount): what's there is saved.
  useEffect(
    () => () => {
      if (sendTimerRef.current) clearTimeout(sendTimerRef.current);
      if (!leftRef.current) void persistRef.current(titleRef.current, contentRef.current);
    },
    [],
  );

  return {
    loaded,
    noteId,
    title,
    setTitle: (next) => {
      titleTouchedRef.current = true;
      titleRef.current = next;
      unsavedRef.current = true;
      setTitleState(next);
      setWritten(hasWriting(next, contentRef.current, askedRef.current()));
    },
    seed,
    change: (markdown, doc) => {
      contentRef.current = markdown;
      docRef.current = doc;
      unsavedRef.current = true;
      setChanges((count) => count + 1);
      setWritten(hasWriting(titleRef.current, markdown, askedRef.current()));
      // The last words, sent as the note was left: saved straight away.
      if (leftRef.current) void persistRef.current(titleRef.current, markdown);
    },
    leave: () => {
      if (leftRef.current) return;
      leftRef.current = true;
      sendNow();
      afterLeaving();
    },
    saveNow: sendNow,
    restart: (markdown, doc) => {
      contentRef.current = markdown;
      docRef.current = doc;
      baselineRef.current = markdown;
      reseed(markdown, doc, "end");
    },
    discard: () => {
      leftRef.current = true;
      loadedKeyRef.current = null;
      cancelDraft();
      void localDrafts.clear(draftKey);
    },
    written,
    createdAt,
    missing,
  };
}

/** A sample note, in demo mode: the same page, saved into the sample store and nowhere else. */
export function useDemoNoteSession({ id: routeId, prompt, page, asked }: NoteParams): NoteSession {
  const isNew = routeId === "new";
  const askedRef = useRef(asked);
  askedRef.current = asked;
  const writeNote = useSage((state) => state.writeNote);
  const [newId] = useState(() => (isNew ? `note-${Date.now().toString(36)}` : null));
  const id = isNew ? (newId as string) : routeId;

  // The note as it opened. (The store changes as it's written; the editor keeps its own copy.)
  const [opened] = useState(() => {
    if (isNew) return { title: "", ...(prompt ? questionPage(prompt) : { markdown: "", doc: null }), day: null as string | null };
    const note = getSage().notes.find((item) => item.id === routeId);
    if (!note) return null;
    const blocks = note.blocks?.length ? note.blocks : note.excerpt ? [{ kind: "p" as const, text: note.excerpt }] : [];
    return { title: note.typedTitle ?? note.title, markdown: note.markdown ?? markdownOfBlocks(blocks), doc: null, day: note.day };
  });

  const [title, setTitleState] = useState(opened?.title ?? "");
  const titleRef = useRef(title);
  const contentRef = useRef(opened?.markdown ?? "");
  const savedRef = useRef(isNew ? null : { title: opened?.title ?? "", content: opened?.markdown ?? "" });
  const [exists, setExists] = useState(!isNew);
  const existsRef = useRef(exists);
  const [written, setWritten] = useState(!isNew);
  const [changes, setChanges] = useState(0);
  const [seed, setSeed] = useState<EditorSeed>(() => ({ key: "1", markdown: opened?.markdown ?? "", doc: opened?.doc ?? null, focus: isNew ? "end" : null }));
  const seeds = useRef(1);
  const leftRef = useRef(false);
  const goneRef = useRef(false);

  const save = useCallback(() => {
    if (goneRef.current || !opened) return;
    const nextTitle = titleRef.current;
    const markdown = contentRef.current;
    if (!existsRef.current && !hasWriting(nextTitle, markdown, askedRef.current())) return;
    const saved = savedRef.current;
    if (saved && saved.title === nextTitle && saved.content === markdown) return;
    writeNote({ id, ...noteFacts(nextTitle, markdown), typedTitle: nextTitle, markdown, area: getSage().draftArea, page });
    savedRef.current = { title: nextTitle, content: markdown };
    existsRef.current = true;
    setExists(true);
  }, [id, opened, page, writeNote]);
  const saveRef = useRef(save);
  saveRef.current = save;

  useEffect(() => {
    const timer = setTimeout(() => saveRef.current(), DEMO_SAVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [title, changes]);

  useEffect(
    () => () => {
      if (!leftRef.current) saveRef.current();
    },
    [],
  );

  return {
    loaded: !!opened,
    noteId: exists ? id : null,
    title,
    setTitle: (next) => {
      titleRef.current = next;
      setTitleState(next);
      setWritten(hasWriting(next, contentRef.current, askedRef.current()));
    },
    seed,
    change: (markdown) => {
      contentRef.current = markdown;
      setChanges((count) => count + 1);
      setWritten(hasWriting(titleRef.current, markdown, askedRef.current()));
      if (leftRef.current) saveRef.current();
    },
    leave: () => {
      leftRef.current = true;
      saveRef.current();
    },
    saveNow: () => saveRef.current(),
    restart: (markdown, doc) => {
      contentRef.current = markdown;
      setSeed({ key: String(++seeds.current), markdown, doc, focus: "end" });
    },
    discard: () => {
      goneRef.current = true;
      leftRef.current = true;
    },
    written,
    createdAt: isNew ? new Date() : null,
    missing: !opened,
  };
}
