import { z } from "zod";
import superjson from "superjson";
import type {
  CompletionSuggestion,
  Suggestion,
} from "../../helpers/suggestionCategories";
import { apiFetch } from "../../helpers/apiFetch";

export const schema = z.object({
  noteId: z.string().min(1).optional(),
  title: z.string().max(300).optional(),
  textBeforeCursor: z.string().max(4_000),
});

export type InputType = z.infer<typeof schema>;

export type OutputType = {
  suggestions: Suggestion[];
  completionSuggestions: CompletionSuggestion[];
  reflectionQuestion: string;
};

export const postSuggestionsGenerate = async (
  body: InputType,
  init?: RequestInit,
): Promise<OutputType> => {
  const validatedInput = schema.parse(body);
  const result = await apiFetch(`/_api/suggestions/generate`, {
    method: "POST",
    body: superjson.stringify(validatedInput),
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  if (!result.ok) {
    const errorObject = superjson.parse<{ error: string }>(await result.text());
    throw new Error(errorObject.error);
  }
  return superjson.parse<OutputType>(await result.text());
};