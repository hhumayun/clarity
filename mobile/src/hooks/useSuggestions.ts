import { useCallback, useEffect, useRef, useState } from "react";
import { postSuggestionEvent, postSuggestionsGenerate } from "../api/suggestions";
import type { BubbleSuggestion, CompletionSuggestion, Suggestion } from "../types";

const COOLDOWN_MS = 60_000;
// Suggestions refresh on their own once the writer has added this many
// characters since the last fetch and then stopped typing for this long.
// The count is of newly added characters, not of the note's total length, so
// opening a long note does not immediately qualify. Either number is a
// product choice, not a technical one.
const AUTO_MIN_NEW_CHARS = 10;
const AUTO_PAUSE_MS = 2_000;

function dismissalKey(text: string): string {
  return text.trim().replace(/\s+/g, " ").toLowerCase();
}

export function useSuggestions(opts: {
  noteId?: string;
  title: string;
  textBeforeCursor: string;
  enabled: boolean;
}) {
  const { noteId, title, textBeforeCursor, enabled } = opts;
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [completionSuggestions, setCompletionSuggestions] = useState<
    CompletionSuggestion[]
  >([]);
  // Only ever what the model returned. Null means nothing to show — there is
  // no local list to fall back on, by design.
  const [reflectionQuestion, setReflectionQuestion] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const seqRef = useRef(0);
  const shownAtRef = useRef(Date.now());
  const dismissedRef = useRef(new Set<string>());
  const cooldownUntilRef = useRef(0);
  const controllerRef = useRef<AbortController | null>(null);
  // The text new characters are counted from: set after every fetch, manual or
  // automatic, and lowered again when the writer deletes. Because a manual tap
  // resets it, tapping the button is never followed by an automatic fetch for
  // the same text.
  const autoBaselineRef = useRef<string | null>(null);
  const autoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Read inside refresh() so the callback stays stable and never fires with the
  // text as it was when the button was last rendered.
  const optsRef = useRef({ noteId, title, textBeforeCursor, enabled });
  optsRef.current = { noteId, title, textBeforeCursor, enabled };

  const clearAutoTimer = () => {
    if (autoTimerRef.current) {
      clearTimeout(autoTimerRef.current);
      autoTimerRef.current = null;
    }
  };

  // Suggestions are generated for one note, so they must not survive a move to
  // another one. A brand new note is exempt: it starts with no id and gets one
  // the moment it is first saved, which is the same writing session and must
  // keep the chips already on screen.
  const previousNoteIdRef = useRef(noteId);
  useEffect(() => {
    const previous = previousNoteIdRef.current;
    previousNoteIdRef.current = noteId;
    if (previous === noteId) return;
    if (previous === undefined && noteId !== undefined) return;

    seqRef.current += 1;
    controllerRef.current?.abort();
    controllerRef.current = null;
    clearAutoTimer();
    dismissedRef.current = new Set();
    autoBaselineRef.current = null;
    setSuggestions([]);
    setCompletionSuggestions([]);
    setReflectionQuestion(null);
    setLoading(false);
  }, [noteId]);

  useEffect(() => {
    if (enabled) return;
    seqRef.current += 1;
    controllerRef.current?.abort();
    controllerRef.current = null;
    clearAutoTimer();
    setLoading(false);
  }, [enabled]);

  useEffect(() => {
    return () => {
      seqRef.current += 1;
      controllerRef.current?.abort();
      clearAutoTimer();
    };
  }, []);

  /** Returns false when nothing could be fetched, so the caller can say so. */
  const refresh = useCallback(async (): Promise<boolean> => {
    const current = optsRef.current;
    if (!current.enabled) return false;
    if (Date.now() < cooldownUntilRef.current) return false;

    clearAutoTimer();
    autoBaselineRef.current = current.textBeforeCursor;

    const seq = ++seqRef.current;
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setLoading(true);

    try {
      const result = await postSuggestionsGenerate(
        {
          noteId: current.noteId,
          title: current.title,
          textBeforeCursor: current.textBeforeCursor.slice(-2_000),
        },
        { signal: controller.signal },
      );
      if (seq !== seqRef.current) return false;
      shownAtRef.current = Date.now();
      setSuggestions(
        result.suggestions.filter(
          (s) => !dismissedRef.current.has(dismissalKey(s.text)),
        ),
      );
      setCompletionSuggestions(
        (result.completionSuggestions ?? []).filter(
          (s) => !dismissedRef.current.has(dismissalKey(s.text)),
        ),
      );
      const question = result.reflectionQuestion?.trim();
      setReflectionQuestion(question ? question : null);
      return true;
    } catch (error) {
      if (seq !== seqRef.current) return false;
      const message = error instanceof Error ? error.message : "";
      if (/wait a moment|too many|unavailable right now/i.test(message)) {
        cooldownUntilRef.current = Date.now() + COOLDOWN_MS;
      }
      // The model failed, so there is nothing trustworthy to leave on screen.
      setSuggestions([]);
      setCompletionSuggestions([]);
      setReflectionQuestion(null);
      return false;
    } finally {
      if (seq === seqRef.current) setLoading(false);
    }
  }, []);

  // Automatic refresh: once AUTO_MIN_NEW_CHARS characters have been added
  // since the last fetch, wait for a pause in typing and then fetch. Every
  // keystroke restarts the wait, so nothing is requested mid-word. Opening a
  // note does not count as writing — the text present when suggestions become
  // enabled is the starting baseline, and only characters added after that
  // count towards the threshold.
  const wasEnabledRef = useRef(false);
  useEffect(() => {
    const justEnabled = enabled && !wasEnabledRef.current;
    wasEnabledRef.current = enabled;
    if (!enabled) return;
    const baseline = autoBaselineRef.current;
    // No baseline yet (just enabled, or moved to another note): take the text
    // as it stands as the starting point rather than fetching for it.
    if (justEnabled || baseline === null) {
      autoBaselineRef.current = textBeforeCursor;
      return;
    }

    const added = textBeforeCursor.length - baseline.length;
    // The writer deleted. Drop the baseline to the shorter text, so the next
    // ten characters they type count from here rather than having to climb
    // back past the old high-water mark before anything fetches again.
    if (added < 0) {
      autoBaselineRef.current = textBeforeCursor;
      return;
    }
    if (added < AUTO_MIN_NEW_CHARS) return;

    clearAutoTimer();
    autoTimerRef.current = setTimeout(() => {
      autoTimerRef.current = null;
      // Failures stay silent here; the manual button is where a toast belongs.
      void refresh();
    }, AUTO_PAUSE_MS);
    return clearAutoTimer;
  }, [textBeforeCursor, enabled, refresh]);

  const accept = useCallback(
    (suggestion: BubbleSuggestion) => {
      void postSuggestionEvent({
        action: "accepted",
        suggestionText: suggestion.text,
        source: suggestion.source,
        noteId,
        responseMs: Date.now() - shownAtRef.current,
      }).catch(() => {});
    },
    [noteId],
  );

  const dismiss = useCallback(
    (suggestion: BubbleSuggestion) => {
      dismissedRef.current.add(dismissalKey(suggestion.text));
      setSuggestions((prev) => prev.filter((p) => p.text !== suggestion.text));
      setCompletionSuggestions((prev) =>
        prev.filter((p) => p.text !== suggestion.text),
      );
      void postSuggestionEvent({
        action: "dismissed",
        suggestionText: suggestion.text,
        source: suggestion.source,
        noteId,
      }).catch(() => {});
    },
    [noteId],
  );

  return {
    suggestions,
    completionSuggestions,
    reflectionQuestion,
    loading,
    refresh,
    accept,
    dismiss,
  };
}
