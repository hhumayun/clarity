import { useCallback, useEffect, useRef, useState } from "react";
import { postSuggestionEvent, postSuggestionsGenerate } from "../api/suggestions";
import {
  DEFAULT_REFLECTION_QUESTION,
  reflectionQuestions,
} from "../lib/reflection";
import type { BubbleSuggestion, CompletionSuggestion, Suggestion } from "../types";

const COOLDOWN_MS = 60_000;

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
  const [reflectionQuestion, setReflectionQuestion] = useState(
    DEFAULT_REFLECTION_QUESTION,
  );
  const [loading, setLoading] = useState(false);

  const seqRef = useRef(0);
  const shownAtRef = useRef(Date.now());
  const dismissedRef = useRef(new Set<string>());
  const cooldownUntilRef = useRef(0);
  const controllerRef = useRef<AbortController | null>(null);

  // Read inside refresh() so the callback stays stable and never fires with the
  // text as it was when the button was last rendered.
  const optsRef = useRef({ noteId, title, textBeforeCursor, enabled });
  optsRef.current = { noteId, title, textBeforeCursor, enabled };

  // The reflection prompt is picked locally and costs nothing, so it keeps
  // following the text. Only the generate call waits for the button.
  useEffect(() => {
    setReflectionQuestion(reflectionQuestions(textBeforeCursor));
  }, [textBeforeCursor]);

  useEffect(() => {
    if (enabled) return;
    seqRef.current += 1;
    controllerRef.current?.abort();
    controllerRef.current = null;
    setLoading(false);
  }, [enabled]);

  useEffect(() => {
    return () => {
      seqRef.current += 1;
      controllerRef.current?.abort();
    };
  }, []);

  /** Returns false when nothing could be fetched, so the caller can say so. */
  const refresh = useCallback(async (): Promise<boolean> => {
    const current = optsRef.current;
    if (!current.enabled) return false;
    if (Date.now() < cooldownUntilRef.current) return false;

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
      if (result.reflectionQuestion) {
        setReflectionQuestion(result.reflectionQuestion);
      }
      return true;
    } catch (error) {
      if (seq !== seqRef.current) return false;
      const message = error instanceof Error ? error.message : "";
      if (/wait a moment|too many|unavailable right now/i.test(message)) {
        cooldownUntilRef.current = Date.now() + COOLDOWN_MS;
      }
      setSuggestions([]);
      setCompletionSuggestions([]);
      return false;
    } finally {
      if (seq === seqRef.current) setLoading(false);
    }
  }, []);

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
