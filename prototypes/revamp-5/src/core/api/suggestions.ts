import superjson from "superjson";
import { apiFetch } from "./apiFetch";
import { jsonHeaders, parseResponse } from "./parse";
import type {
  CompletionSuggestion,
  Suggestion,
  SuggestionAction,
  SuggestionSource,
} from "../types";

/**
 * Word help from the AI. `mode` asks for less, sooner: "words" (ways to
 * finish the sentence and one start per mood) or "questions". Servers older
 * than it ignore it and answer everything, as they did before.
 */
export async function postSuggestionsGenerate(
  body: { noteId?: string; title?: string; textBeforeCursor: string; mode?: "words" | "questions" },
  init?: RequestInit,
): Promise<{
  suggestions: Suggestion[];
  completionSuggestions: CompletionSuggestion[];
  reflectionQuestion: string;
  /** A few questions; missing from servers older than the tray. */
  reflectionQuestions?: string[];
}> {
  const result = await apiFetch("/_api/suggestions/generate", {
    method: "POST",
    body: superjson.stringify(body),
    ...init,
    headers: jsonHeaders(init),
  });
  return parseResponse(result);
}

export async function postSuggestionEvent(
  body: {
    suggestionText: string;
    source: SuggestionSource;
    action: SuggestionAction;
    noteId?: string;
    responseMs?: number;
  },
  init?: RequestInit,
): Promise<{ recorded: true }> {
  const result = await apiFetch("/_api/suggestions/event", {
    method: "POST",
    body: superjson.stringify(body),
    ...init,
    headers: jsonHeaders(init),
  });
  return parseResponse(result);
}
