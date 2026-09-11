import type { SuggestionSource } from "./schema";

/**
 * The three moods a sentence-starter can belong to. Shared by the engine,
 * the endpoint schema and the bubble UI.
 */
export const SUGGESTION_CATEGORIES = ["deeper", "continue", "forward"] as const;

export type SuggestionCategory = (typeof SUGGESTION_CATEGORIES)[number];

export type Suggestion = {
  text: string;
  source: SuggestionSource;
  category: SuggestionCategory;
};

/** A phrase that continues the unfinished sentence at the cursor. */
export type CompletionSuggestion = {
  text: string;
  source: SuggestionSource;
  kind: "completion";
};

export type BubbleSuggestion = Suggestion | CompletionSuggestion;

export function isCompletionSuggestion(
  suggestion: BubbleSuggestion,
): suggestion is CompletionSuggestion {
  return "kind" in suggestion && suggestion.kind === "completion";
}

export const SUGGESTION_CATEGORY_LABELS: Record<SuggestionCategory, string> = {
  deeper: "GO DEEPER",
  continue: "KEEP GOING",
  forward: "FORWARD",
};

export function isSuggestionCategory(value: string): value is SuggestionCategory {
  return (SUGGESTION_CATEGORIES as readonly string[]).includes(value);
}