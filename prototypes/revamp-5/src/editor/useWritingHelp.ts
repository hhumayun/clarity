import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { getPreferences } from "../core/api/account";
import { postSuggestionEvent, postSuggestionsGenerate } from "../core/api/suggestions";
import { PREFERENCES_QUERY_KEY } from "../core/hooks/usePreferences";
import type { SuggestionSource } from "../core/types";
import type { EditorCursor } from "./protocol";
import { fitWords, sentenceOver, type WordKind } from "./wordFit";

/** A few words offered after a pause: to finish the sentence at the cursor, or to start the next. */
export type WordIdea = { text: string; kind: WordKind; source: SuggestionSource };

/**
 * When word help asks (2026-10-06, a first try, to be tuned on the phone):
 * the writer has stopped for a moment, has written a little since the last
 * ask, and it's been a while. Each ask is one AI call, and it brings the
 * questions too, so Next question and Go deeper cost nothing more.
 */
export const ASK_AFTER_PAUSE_MS = 2_500;
export const ASK_AFTER_NEW_CHARS = 30;
export const ASK_GAP_MS = 20_000;
// The server said to wait (too many asks, or the AI is down): a minute.
const COOLDOWN_MS = 60_000;
// At most this many in the strip: ways to finish this sentence first, then ways to start the next.
const STRIP_MAX = 5;
const FINISH_MAX = 3;

// Looking around, nothing is sent anywhere: a few ways to start a sentence stand in.
const SAMPLE_STARTS = ["What I keep coming back to", "It made me feel", "Next time I", "The hard part is", "What helped was", "Tomorrow I want to"];

type Offer = { before: string; words: WordIdea[]; shownAt: number };

/**
 * Word help while writing, from Clarity's server (the main app's
 * suggestions), with AI help on: after a pause, a strip of a few words to
 * finish the sentence or start the next, and a few questions about what was
 * written, which Next question and Go deeper use. It never asks while the
 * writer is typing, nor for a note just opened, and a failure is quiet: the
 * strip simply doesn't come.
 */
export function useWritingHelp({ noteId, title, seed, writing, demo, aiReady }: { noteId: string | null; title: string; seed: string; writing: boolean; demo: boolean; aiReady: boolean }) {
  const queryClient = useQueryClient();
  const [offer, setOffer] = useState<Offer | null>(null);
  const [questions, setQuestions] = useState<string[]>([]);
  const enabled = aiReady && writing;

  const cursorRef = useRef<EditorCursor | null>(null);
  // The note's length at the last ask (or when writing began): only words added since count.
  const baselineRef = useRef<number | null>(null);
  // The note's length as last known: as it opened, until the editor sends its words.
  const lengthRef = useRef(seed.length);
  const sentRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastAskRef = useRef(0);
  const cooldownRef = useRef(0);
  const seqRef = useRef(0);
  const optsRef = useRef({ noteId, title, demo, enabled });
  optsRef.current = { noteId, title, demo, enabled };

  const clearTimer = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
  };

  const ask = useCallback(async () => {
    timerRef.current = null;
    const current = optsRef.current;
    const at = cursorRef.current;
    if (!current.enabled || !at || !at.before.trim()) return;
    const wait = Math.max(lastAskRef.current + ASK_GAP_MS, cooldownRef.current) - Date.now();
    if (wait > 0) {
      // Still paused once the gap has passed: ask then.
      timerRef.current = setTimeout(() => void ask(), wait);
      return;
    }
    lastAskRef.current = Date.now();
    baselineRef.current = lengthRef.current;
    const seq = ++seqRef.current;
    if (current.demo) {
      if (!sentenceOver(at.before)) return;
      const start = Math.floor(Math.random() * SAMPLE_STARTS.length);
      const words = [0, 1, 2].map((i) => ({ text: SAMPLE_STARTS[(start + i) % SAMPLE_STARTS.length], kind: "start" as const, source: "prompt" as const }));
      setOffer({ before: at.before, words, shownAt: Date.now() });
      return;
    }
    try {
      const result = await postSuggestionsGenerate({ noteId: current.noteId ?? undefined, title: current.title, textBeforeCursor: at.before.slice(-2_000) });
      if (seq !== seqRef.current) return;
      const found = (result.reflectionQuestions ?? (result.reflectionQuestion ? [result.reflectionQuestion] : [])).map((question) => question.trim()).filter(Boolean);
      if (found.length) setQuestions(found);
      const words = stripOf(result, at.before);
      // Written on since: these were for other words.
      if (words.length && cursorRef.current?.before === at.before) setOffer({ before: at.before, words, shownAt: Date.now() });
    } catch (error) {
      if (seq !== seqRef.current) return;
      const message = error instanceof Error ? error.message : "";
      if (/wait a moment|too many|unavailable right now/i.test(message)) cooldownRef.current = Date.now() + COOLDOWN_MS;
      // Quiet: nobody asked for it.
    }
  }, []);

  useEffect(() => {
    if (!sentRef.current) lengthRef.current = seed.length;
  }, [seed]);

  // Writing begins: words count from here. It stops (the keyboard goes, the
  // title is chosen) or AI help goes off: nothing waits.
  useEffect(() => {
    if (enabled) {
      baselineRef.current = lengthRef.current;
      return;
    }
    clearTimer();
    seqRef.current += 1;
    baselineRef.current = null;
  }, [enabled]);
  useEffect(
    () => () => {
      clearTimer();
      seqRef.current += 1;
    },
    [],
  );

  /** The editor's words changed. */
  const onText = useCallback(
    (markdown: string) => {
      lengthRef.current = markdown.length;
      sentRef.current = true;
      if (!optsRef.current.enabled) return;
      const baseline = baselineRef.current;
      // Words were taken out: count from here.
      if (baseline === null || markdown.length < baseline) {
        baselineRef.current = markdown.length;
        return;
      }
      if (markdown.length - baseline < ASK_AFTER_NEW_CHARS) return;
      // Every change starts the pause again, so nothing is asked mid-word.
      clearTimer();
      timerRef.current = setTimeout(() => void ask(), ASK_AFTER_PAUSE_MS);
    },
    [ask],
  );

  /** The cursor rested somewhere: the strip goes once it's somewhere else. */
  const onCursor = useCallback((cursor: EditorCursor) => {
    cursorRef.current = cursor;
    setOffer((shown) => (shown && shown.before !== cursor.before ? null : shown));
  }, []);

  /** A word chosen: what to insert, cased and spaced for the cursor. */
  const take = useCallback(
    (word: WordIdea): { text: string; trimBefore: boolean } | null => {
      const at = cursorRef.current;
      if (!at) return null;
      const shownAt = offer?.shownAt ?? Date.now();
      setOffer(null);
      // Only what was taken, and only while Learn from my writing is on.
      if (!optsRef.current.demo) {
        void (async () => {
          try {
            const preferences = await queryClient.fetchQuery({ queryKey: PREFERENCES_QUERY_KEY, queryFn: () => getPreferences(), staleTime: 5 * 60_000 });
            if (preferences.usePersonalization === false) return;
            await postSuggestionEvent({ action: "accepted", suggestionText: word.text, source: word.source, noteId: optsRef.current.noteId ?? undefined, responseMs: Date.now() - shownAt });
          } catch {
            // Only for learning: nothing to tell.
          }
        })();
      }
      return fitWords(word.text, word.kind, at.before, at.after);
    },
    [offer, queryClient],
  );

  const strip = enabled && offer && cursorRef.current?.before === offer.before ? offer.words : null;
  return { strip, questions, onText, onCursor, take };
}

/** Ways to finish the sentence (if it isn't over), then ways to start the next, one of each kind in turn. */
function stripOf(result: Awaited<ReturnType<typeof postSuggestionsGenerate>>, before: string): WordIdea[] {
  const finishes: WordIdea[] = sentenceOver(before) ? [] : (result.completionSuggestions ?? []).slice(0, FINISH_MAX).map((item) => ({ text: item.text, kind: "finish", source: item.source }));
  const byKind = new Map<string, WordIdea[]>();
  for (const item of result.suggestions) {
    const list = byKind.get(item.category) ?? [];
    list.push({ text: item.text, kind: "start", source: item.source });
    byKind.set(item.category, list);
  }
  const starts: WordIdea[] = [];
  const lists = [...byKind.values()];
  for (let i = 0; lists.some((list) => i < list.length); i++) for (const list of lists) if (list[i]) starts.push(list[i]);
  return [...finishes, ...starts].slice(0, STRIP_MAX);
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
      const result = await postSuggestionsGenerate({ noteId, title, textBeforeCursor: words.slice(-2_000) });
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
