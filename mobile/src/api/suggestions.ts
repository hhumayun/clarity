import superjson from "superjson";
import { apiFetch } from "./apiFetch";
import { jsonHeaders, parseResponse } from "./parse";
import type {
  CompletionSuggestion,
  Suggestion,
  SuggestionAction,
  SuggestionSource,
} from "../types";

export async function postSuggestionsGenerate(
  body: { noteId?: string; title?: string; textBeforeCursor: string },
  init?: RequestInit,
): Promise<{
  suggestions: Suggestion[];
  completionSuggestions: CompletionSuggestion[];
  reflectionQuestion: string;
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
