import { z } from "zod";
import superjson from "superjson";
import { apiFetch } from "../../helpers/apiFetch";
import type { ParsedTaskLine } from "../../helpers/parseTaskLine";

export const schema = z.object({
  text: z.string().trim().min(1).max(500),
  currentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});
export type InputType = z.infer<typeof schema>;
export type OutputType = ParsedTaskLine;

export const postTaskParse = async (
  body: InputType,
  init?: RequestInit,
): Promise<OutputType> => {
  const validatedInput = schema.parse(body);
  const result = await apiFetch("/_api/tasks/parse", {
    method: "POST",
    body: superjson.stringify(validatedInput),
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!result.ok) {
    const errorObject = superjson.parse<{ error: string; code?: string }>(await result.text());
    const error = new Error(errorObject.error) as Error & { code?: string };
    error.code = errorObject.code;
    throw error;
  }
  return superjson.parse<OutputType>(await result.text());
};
