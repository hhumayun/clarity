import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { getPreferences } from "../core/api/account";
import { postSuggestionEvent, postSuggestionsGenerate } from "../core/api/suggestions";
import { PREFERENCES_QUERY_KEY } from "../core/hooks/usePreferences";
import type { EditorCursor } from "./protocol";
import { sentenceOver } from "./wordFit";
import { fitsNow, sameIdeas, typedSince, wantsNew, type Offer, type WordIdea } from "./wordOffer";

export type { WordIdea } from "./wordOffer";

/**
 * When word help asks (2026-10-07, after the user's phone test: it was slow
 * and seemed random): once the writer stops for a moment, if what's shown no
 * longer fits and a little has been written since the last ask. Right after
 * a pick it asks at once, for where the words now end.
 */
export const ASK_AFTER_PAUSE_MS = 800;
export const ASK_AFTER_NEW_CHARS = 6;
export const ASK_GAP_MS = 3_000;
// The server said to wait (too many asks, or the AI is down): a minute.
const COOLDOWN_MS = 60_000;
// An answer slower than this has missed its moment: it's let go.
const ASK_LIMIT_MS = 8_000;
// Words that come while the writer is typing wait until they rest this long.
const REST_MS = 450;
// After a pick the strip stays, showing that more is coming, for at most this long.
const HOLD_MS = 6_000;
// The AI's questions (for Next question and Go deeper) are asked again once this much more is written.
const QUESTIONS_AFTER_CHARS = 120;
const QUESTIONS_MIN_CHARS = 40;
const QUESTIONS_GAP_MS = 20_000;
// At most this many of each: ways to finish this sentence, ways to start the next (one per mood).
const FINISH_MAX = 3;
const START_MAX = 3;

// Looking around, nothing is sent anywhere: a few ways to start a sentence stand in.
const SAMPLE_STARTS = ["What I keep coming back to", "It made me feel", "Next time I", "The hard part is", "What helped was", "Tomorrow I want to"];

/** What the strip shows: ways to finish the sentence, ways to start the next, and whether more are coming. */
export type Strip = { finishes: WordIdea[]; starts: WordIdea[]; loading: boolean };
type Shown = { finishes: WordIdea[]; starts: WordIdea[] };
/** A pick, for the editor page to put in (run "insertWords"): it fits the words against what's really typed. */
export type WordsToInsert = { text: string; kind: WordIdea["kind"]; anchor: string };

// Just picked, until the editor says where the words end.
const PICKED = "\u0000picked";
const keyOf = (idea: WordIdea) => `${idea.kind}:${idea.text}`;

/**
 * Word help while writing, from Clarity's server, with AI help on: after a
 * short pause, a few words to finish the sentence and a few to start the
 * next; and a few questions about what was written, which Next question and
 * Go deeper use. What's offered stays as the writer types on, for as long
 * as it fits (see fitsNow), and new words come at the next pause. A pick
 * leaves the strip up and asks again at once. A failure is quiet.
 */
export function useWritingHelp({ noteId, title, seed, writing, demo, aiReady }: { noteId: string | null; title: string; seed: string; writing: boolean; demo: boolean; aiReady: boolean }) {
  const queryClient = useQueryClient();
  const [shown, setShown] = useState<Shown | null>(null);
  const [loading, setLoading] = useState(false);
  const [holding, setHolding] = useState(false);
  const [questions, setQuestions] = useState<string[]>([]);
  const enabled = aiReady && writing;

  const cursorRef = useRef<EditorCursor | null>(null);
  const offerRef = useRef<Offer | null>(null);
  const shownRef = useRef<Shown | null>(null);
  const shownAtRef = useRef(0);
  // The note's length as last known: as it opened, until the editor sends its words.
  const lengthRef = useRef(seed.length);
  const sentRef = useRef(false);
  // The note's length at the last ask (or when writing began): only words added since count.
  const baselineRef = useRef<number | null>(null);
  const lastAskRef = useRef(0);
  const cooldownRef = useRef(0);
  const seqRef = useRef(0);
  const controllerRef = useRef<AbortController | null>(null);
  const askTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const restTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const restingRef = useRef(true);
  // After a pick: where the words end once it's in (PICKED until the editor says). Typing on from there lets the hold go.
  const holdRef = useRef<string | null>(null);
  // Picked from what's offered now: gone from the strip at once, whatever the cursor says.
  const takenRef = useRef(new Set<string>());
  const questionsRef = useRef<{ at: number; length: number } | null>(null);
  const optsRef = useRef({ noteId, title, demo, enabled });
  optsRef.current = { noteId, title, demo, enabled };

  const stopHold = useCallback(() => {
    holdRef.current = null;
    if (holdTimerRef.current) clearTimeout(holdTimerRef.current);
    holdTimerRef.current = null;
    setHolding(false);
  }, []);

  /** What fits where the cursor is now. New words wait for a rest before they first show. */
  const recompute = useCallback(() => {
    const offer = offerRef.current;
    const at = cursorRef.current;
    const fits = offer && at ? fitsNow(offer, at.before) : null;
    const left = (list: { idea: WordIdea }[], max: number) => list.map((fit) => fit.idea).filter((idea) => !takenRef.current.has(keyOf(idea))).slice(0, max);
    let next: Shown | null = fits ? { finishes: left(fits.finishes, FINISH_MAX), starts: left(fits.starts, START_MAX) } : null;
    if (next && !next.finishes.length && !next.starts.length) next = null;
    const before = shownRef.current;
    // Not showing yet, and the writer is mid-flow: they come once the writer rests.
    if (next && !before && !restingRef.current && holdRef.current === null) next = null;
    if (before === next || (before && next && sameIdeas(before.finishes, next.finishes) && sameIdeas(before.starts, next.starts))) return;
    if (next && !before) shownAtRef.current = Date.now();
    shownRef.current = next;
    setShown(next);
  }, []);

  /** The AI's questions about what's been written, now and then, in the background. */
  const askQuestions = useCallback(async (before: string) => {
    const current = optsRef.current;
    const length = lengthRef.current;
    const last = questionsRef.current;
    if (current.demo || length < QUESTIONS_MIN_CHARS) return;
    if (last && (length - last.length < QUESTIONS_AFTER_CHARS || Date.now() - last.at < QUESTIONS_GAP_MS)) return;
    questionsRef.current = { at: Date.now(), length };
    try {
      const result = await postSuggestionsGenerate({ noteId: current.noteId ?? undefined, title: current.title, textBeforeCursor: before.slice(-2_000), mode: "questions" });
      const found = (result.reflectionQuestions ?? (result.reflectionQuestion ? [result.reflectionQuestion] : [])).map((question) => question.trim()).filter(Boolean);
      if (found.length) setQuestions(found);
    } catch {
      // Sage's own questions stand in.
    }
  }, []);

  /**
   * Asks for words for `before` (where the cursor is, or where it will be
   * once a pick is in). `now`: right after a pick, with no pause or gap.
   */
  const ask = useCallback(
    async ({ now = false, before: forBefore }: { now?: boolean; before?: string } = {}) => {
      askTimerRef.current = null;
      const current = optsRef.current;
      const before = forBefore ?? cursorRef.current?.before;
      if (!current.enabled || before === undefined || !before.trim()) return;
      if (Date.now() < cooldownRef.current) return;
      if (!now) {
        const baseline = baselineRef.current ?? lengthRef.current;
        if (!wantsNew(offerRef.current, before) || lengthRef.current - baseline < ASK_AFTER_NEW_CHARS) return;
        const wait = lastAskRef.current + ASK_GAP_MS - Date.now();
        if (wait > 0) {
          // Still resting once the gap has passed: ask then.
          askTimerRef.current = setTimeout(() => void ask(), wait);
          return;
        }
      }
      lastAskRef.current = Date.now();
      baselineRef.current = lengthRef.current;
      controllerRef.current?.abort();
      const controller = new AbortController();
      controllerRef.current = controller;
      const seq = ++seqRef.current;
      const done = () => {
        if (seq !== seqRef.current) return;
        controllerRef.current = null;
        setLoading(false);
        stopHold();
      };

      if (current.demo) {
        // Only ways to start a sentence, and only once one's over.
        const starts: WordIdea[] = [];
        if (sentenceOver(before)) {
          const first = Math.floor(Math.random() * SAMPLE_STARTS.length);
          for (let i = 0; i < START_MAX; i++) starts.push({ text: SAMPLE_STARTS[(first + i) % SAMPLE_STARTS.length], kind: "start", source: "prompt" });
        }
        offerRef.current = { id: seq, anchor: before, finishes: [], starts };
        takenRef.current.clear();
        recompute();
        done();
        return;
      }

      setLoading(true);
      const limit = setTimeout(() => controller.abort(), ASK_LIMIT_MS);
      try {
        const result = await postSuggestionsGenerate(
          { noteId: current.noteId ?? undefined, title: current.title, textBeforeCursor: before.slice(-2_000), mode: "words" },
          { signal: controller.signal },
        );
        if (seq !== seqRef.current) return;
        const found = (result.reflectionQuestions ?? (result.reflectionQuestion ? [result.reflectionQuestion] : [])).map((question) => question.trim()).filter(Boolean);
        // Servers that answer everything bring questions along; newer ones are asked for them now and then.
        if (found.length) {
          setQuestions(found);
          questionsRef.current = { at: Date.now(), length: lengthRef.current };
        } else {
          void askQuestions(before);
        }
        offerRef.current = { id: seq, anchor: before, ...ideasOf(result, before) };
        takenRef.current.clear();
        recompute();
      } catch (error) {
        if (seq !== seqRef.current || controller.signal.aborted) return;
        const message = error instanceof Error ? error.message : "";
        if (/wait a moment|too many|unavailable right now/i.test(message)) cooldownRef.current = Date.now() + COOLDOWN_MS;
        // Quiet: nobody asked for it.
      } finally {
        clearTimeout(limit);
        done();
      }
    },
    [askQuestions, recompute, stopHold],
  );

  /** The writer typed or moved: the pause starts again, and new words wait for it. */
  const restart = useCallback(() => {
    restingRef.current = false;
    if (restTimerRef.current) clearTimeout(restTimerRef.current);
    restTimerRef.current = setTimeout(() => {
      restingRef.current = true;
      recompute();
    }, REST_MS);
    if (askTimerRef.current) clearTimeout(askTimerRef.current);
    askTimerRef.current = optsRef.current.enabled ? setTimeout(() => void ask(), ASK_AFTER_PAUSE_MS) : null;
  }, [ask, recompute]);

  const stopAll = useCallback(() => {
    for (const timer of [askTimerRef, restTimerRef]) {
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
    }
    seqRef.current += 1;
    controllerRef.current?.abort();
    controllerRef.current = null;
    offerRef.current = null;
    shownRef.current = null;
    setShown(null);
    setLoading(false);
    stopHold();
  }, [stopHold]);

  useEffect(() => {
    if (!sentRef.current) lengthRef.current = seed.length;
  }, [seed]);

  // Writing begins: words count from here. It stops (the keyboard goes, the
  // title is chosen) or AI help goes off: nothing waits, and nothing stays.
  useEffect(() => {
    if (enabled) {
      baselineRef.current = lengthRef.current;
      return;
    }
    baselineRef.current = null;
    stopAll();
  }, [enabled, stopAll]);
  useEffect(() => stopAll, [stopAll]);

  /** The editor's words changed. */
  const onText = useCallback(
    (markdown: string) => {
      lengthRef.current = markdown.length;
      sentRef.current = true;
      if (!optsRef.current.enabled) return;
      // Words were taken out: count from here.
      if (baselineRef.current === null || markdown.length < baselineRef.current) baselineRef.current = markdown.length;
      restart();
    },
    [restart],
  );

  /** The cursor rested somewhere (the editor says so once it's still): what fits there. */
  const onCursor = useCallback(
    (cursor: EditorCursor) => {
      cursorRef.current = cursor;
      // Typing on after a pick, or writing elsewhere: the strip needn't wait for new words.
      const hold = holdRef.current;
      if (hold !== null && holdState(hold, cursor.before) !== "on") stopHold();
      recompute();
      if (optsRef.current.enabled) restart();
    },
    [recompute, restart, stopHold],
  );

  /**
   * A word chosen: what the editor page is to put in (it fits the words to
   * what's really typed, and answers with onInserted). The chosen chip goes
   * at once; the strip stays, showing that more are coming.
   */
  const take = useCallback(
    (word: WordIdea): WordsToInsert | null => {
      const offer = offerRef.current;
      if (!offer || !shownRef.current) return null;
      // Only what was taken, and only while Learn from my writing is on.
      if (!optsRef.current.demo) {
        const responseMs = Date.now() - shownAtRef.current;
        void (async () => {
          try {
            const preferences = await queryClient.fetchQuery({ queryKey: PREFERENCES_QUERY_KEY, queryFn: () => getPreferences(), staleTime: 5 * 60_000 });
            if (preferences.usePersonalization === false) return;
            await postSuggestionEvent({ action: "accepted", suggestionText: word.text, source: word.source, noteId: optsRef.current.noteId ?? undefined, responseMs });
          } catch {
            // Only for learning: nothing to tell.
          }
        })();
      }
      takenRef.current.add(keyOf(word));
      holdRef.current = PICKED;
      setHolding(true);
      if (holdTimerRef.current) clearTimeout(holdTimerRef.current);
      holdTimerRef.current = setTimeout(stopHold, HOLD_MS);
      recompute();
      return { text: word.text, kind: word.kind, anchor: offer.anchor };
    },
    [queryClient, recompute, stopHold],
  );

  /** The editor put a pick in: new words are asked for where they now end, at once. */
  const onInserted = useCallback(
    (before: string, length: number) => {
      const at = cursorRef.current;
      cursorRef.current = { before, after: at?.after ?? "" };
      if (holdRef.current === null) return;
      holdRef.current = before;
      recompute();
      void ask({ now: true, before });
      // The words going in aren't new writing: no second ask for them.
      baselineRef.current = lengthRef.current + length;
    },
    [ask, recompute],
  );

  const strip: Strip | null = enabled && (shown || (holding && loading)) ? { finishes: shown?.finishes ?? [], starts: shown?.starts ?? [], loading } : null;
  return { strip, questions, onText, onCursor, take, onInserted };
}

/**
 * Where the cursor is, against where a pick left it: still there ("on"), typing
 * on from it, or gone (written elsewhere, or taken back past it). A cursor from
 * just before the pick went in counts as still there.
 */
function holdState(hold: string, before: string): "on" | "typing" | "gone" {
  if (hold === PICKED) return "on";
  const typed = typedSince(hold, before);
  if (typed !== null) return typed.length > 1 ? "typing" : "on";
  return typedSince(before, hold) !== null ? "on" : "gone";
}

/** From the server's answer: up to three ways to finish the sentence (if it isn't over), and a start for each mood. */
function ideasOf(result: Awaited<ReturnType<typeof postSuggestionsGenerate>>, before: string): Pick<Offer, "finishes" | "starts"> {
  const finishes: WordIdea[] = sentenceOver(before) ? [] : (result.completionSuggestions ?? []).slice(0, FINISH_MAX).map((item) => ({ text: item.text, kind: "finish", source: item.source }));
  const byKind = new Map<string, WordIdea[]>();
  for (const item of result.suggestions) {
    const list = byKind.get(item.category) ?? [];
    list.push({ text: item.text, kind: "start", source: item.source });
    byKind.set(item.category, list);
  }
  // One of each mood first (servers that answer everything give two of each).
  const starts: WordIdea[] = [];
  const lists = [...byKind.values()];
  for (let i = 0; lists.some((list) => i < list.length); i++) for (const list of lists) if (list[i]) starts.push(list[i]);
  return { finishes, starts: starts.slice(0, START_MAX) };
}

/** A note as plain words, for asking about it: no list marks, quote marks or emphasis. */
export function plainWords(markdown: string): string {
  return markdown
    .split("\n")
    .map((line) => line.replace(/^\s*(?:>\s?)+/, "").replace(/^\s*(?:[-*+]\s+\[[ xX]\]\s+|[-*+]\s+|\d+[.)]\s+|#{1,6}\s+)/, ""))
    .join("\n")
    .replace(/(\*\*|__|~~|\*|_)(\S(?:.*?\S)?)\1/g, "$2")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .trim();
}

// Questions about a whole note, for Go deeper: kept for the app's session, one ask per version of a note.
const DEEPER_KEY = "sage-deeper";
const DEEPER_MIN_CHARS = 40;
function versionOf(text: string): string {
  let hash = 0;
  for (let i = 0; i < text.length; i++) hash = (hash * 31 + text.charCodeAt(i)) | 0;
  return `${text.length}:${hash}`;
}

/**
 * Go deeper's questions about a whole note, from the AI: asked only when
 * `enabled` (the writer wanted another question), once per version of the
 * note, and kept for the app's session. `undefined` while asking; `null`
 * when there's nothing from the AI (not asked, too little written, or it
 * couldn't answer), so Sage's own questions stand in.
 */
export function useDeeperQuestions({ noteId, title, markdown, enabled }: { noteId: string; title: string; markdown: string; enabled: boolean }): string[] | null | undefined {
  const words = plainWords(markdown);
  const worth = enabled && words.length >= DEEPER_MIN_CHARS;
  const query = useQuery({
    queryKey: [DEEPER_KEY, noteId, versionOf(words)],
    queryFn: async () => {
      // Only questions: a smaller answer, so it comes sooner.
      const result = await postSuggestionsGenerate({ noteId, title, textBeforeCursor: words.slice(-2_000), mode: "questions" });
      return (result.reflectionQuestions ?? (result.reflectionQuestion ? [result.reflectionQuestion] : [])).map((question) => question.trim()).filter(Boolean);
    },
    enabled: worth,
    staleTime: Infinity,
    gcTime: 60 * 60_000,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
  // Asked before about this version of the note: there already.
  if (query.data?.length) return query.data;
  return query.isFetching ? undefined : null;
}
