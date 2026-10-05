import { z } from "zod";
import superjson from "superjson";
import { apiFetch } from "../../helpers/apiFetch";

export const schema = z.object({
  noteId: z.string().uuid(),
  /** The suggestion's words, as Find tasks offered them. */
  text: z.string().trim().min(1).max(500),
});
export type InputType = z.infer<typeof schema>;
export type OutputType = { dismissed: true };

export const postDismissSuggestion = async (
  body: InputType,
  init?: RequestInit,
): Promise<OutputType> => {
  const validatedInput = schema.parse(body);
  const result = await apiFetch("/_api/tasks/dismiss_suggestion", {
    method: "POST",
    body: superjson.stringify(validatedInput),
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!result.ok) {
    const errorObject = superjson.parse<{ error: string }>(await result.text());
    throw new Error(errorObject.error);
  }
  return superjson.parse<OutputType>(await result.text());
};
