import { z } from "zod";
import superjson from "superjson";
import {
  SuggestionActionArrayValues,
  SuggestionSourceArrayValues,
} from "../../helpers/schema";
import { apiFetch } from "../../helpers/apiFetch";

export const schema = z.object({
  suggestionText: z.string().min(1).max(200),
  source: z.enum(SuggestionSourceArrayValues),
  action: z.enum(SuggestionActionArrayValues),
  noteId: z.string().min(1).optional(),
  responseMs: z.number().nonnegative().optional(),
});

export type InputType = z.infer<typeof schema>;

export type OutputType = {
  recorded: true;
};

export const postSuggestionEvent = async (
  body: InputType,
  init?: RequestInit,
): Promise<OutputType> => {
  const validatedInput = schema.parse(body);
  const result = await apiFetch(`/_api/suggestions/event`, {
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