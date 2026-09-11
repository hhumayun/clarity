import { z } from "zod";
import superjson from "superjson";
import { apiFetch } from "../../helpers/apiFetch";

export const schema = z.object({ noteId: z.string().uuid() });
export type InputType = z.infer<typeof schema>;

export type SuggestedTask = {
  text: string;
  projectName: string;
  completeBy: Date | null;
};

export type OutputType = {
  /** Tasks the AI found that are not already in the list. */
  suggested: SuggestedTask[];
  /** The note has not changed since the last look — nothing new to find. */
  unchanged: boolean;
};

export const postTasksExtract = async (
  body: InputType,
  init?: RequestInit,
): Promise<OutputType> => {
  const validatedInput = schema.parse(body);
  const result = await apiFetch("/_api/tasks/extract", {
    method: "POST", body: superjson.stringify(validatedInput), ...init,
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
