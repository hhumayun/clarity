import { useCallback, useEffect, useRef, useState } from "react";
import { postSuggestionEvent, postSuggestionsGenerate } from "../api/suggestions";
import {
  DEFAULT_REFLECTION_QUESTION,
  reflectionQuestions,
} from "../lib/reflection";
import type { BubbleSuggestion, CompletionSuggestion, Suggestion } from "../types";

const DEBOUNCE_MS = 500;
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

  useEffect(() => {
    if (!enabled) {
      seqRef.current += 1;
      setLoading(false);
      return;
    }

    const seq = ++seqRef.current;
    const controller = new AbortController();
    let cancelled = false;
    setLoading(true);

    const timer = setTimeout(async () => {
      setReflectionQuestion(reflectionQuestions(textBeforeCursor));
      if (Date.now() < cooldownUntilRef.current) {
        if (!cancelled && seq === seqRef.current) {
          setSuggestions([]);
          setCompletionSuggestions([]);
          setLoading(false);
        }
        return;
      }

      try {
        const result = await postSuggestionsGenerate(
          {
            noteId,
            title,
            textBeforeCursor: textBeforeCursor.slice(-2_000),
          },
          { signal: controller.signal },
        );
        if (cancelled || seq !== seqRef.current) return;
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
      } catch (error) {
        if (cancelled || seq !== seqRef.current) return;
        const message = error instanceof Error ? error.message : "";
        if (/wait a moment|too many|unavailable right now/i.test(message)) {
          cooldownUntilRef.current = Date.now() + COOLDOWN_MS;
        }
        setSuggestions([]);
        setCompletionSuggestions([]);
      } finally {
        if (!cancelled && seq === seqRef.current) setLoading(false);
      }
    }, DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
      controller.abort();
    };
  }, [noteId, title, textBeforeCursor, enabled]);

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
    accept,
    dismiss,
  };
}
