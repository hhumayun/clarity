import { useCallback, useEffect, useRef, useState } from "react";
import { postSuggestionsGenerate } from "../endpoints/suggestions/generate_POST.schema";
import { postSuggestionEvent } from "../endpoints/suggestions/event_POST.schema";
import type {
  BubbleSuggestion,
  CompletionSuggestion,
  Suggestion,
} from "./suggestionCategories";
import {
  DEFAULT_REFLECTION_QUESTION,
  reflectionQuestions,
} from "./reflectionQuestions";

const DEBOUNCE_MS = 500;
const COOLDOWN_MS = 60_000;

/**
 * Dismissals match regardless of capitalization or spacing, so "Then" can't
 * come back as "then" in a later batch.
 */
function dismissalKey(text: string): string {
  return text.trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * Debounced adaptive suggestions. Stale responses are dropped via a sequence
 * counter, and suggestions come only from the current response — no generic
 * filler phrases, which would read as the app not understanding the writer.
 */
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
  // Set when the app is asked to slow down; word help pauses rather than
  // hammering the endpoint while the writer keeps typing.
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
      // Keep the question in step with what the writer has now — a local,
      // deterministic one until the model answers for this exact context.
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
        // Rate-limited or out of quota: pause word help for a minute rather
        // than firing a slow retry chain after every pause in typing.
        if (/wait a moment|too many|unavailable right now/i.test(message)) {
          cooldownUntilRef.current = Date.now() + COOLDOWN_MS;
        }
        // Clear stale bubbles rather than leave phrases that no longer fit.
        setSuggestions([]);
        setCompletionSuggestions([]);
      } finally {
        if (!cancelled && seq === seqRef.current) {
          setLoading(false);
        }
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
      }).catch(() => {
        // Personalization is a nicety; a lost event is not worth a message.
      });
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