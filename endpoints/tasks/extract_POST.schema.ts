import { z } from "zod";
import superjson from "superjson";
import { apiFetch } from "../../helpers/apiFetch";

export const schema = z.object({
  noteId: z.string().uuid(),
  /**
   * The writer's local date as YYYY-MM-DD, so relative dates resolve on
   * their calendar rather than the server's. Falls back to the UTC date.
   */
  currentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});
export type InputType = z.infer<typeof schema>;

export type SuggestedTask = {
  text: string;
  projectName: string;
  /**
   * The due day at noon UTC: its UTC calendar day is the due day. Read it
   * with getUTC* and re-pin it to local noon before showing or saving it.
   */
  completeBy: Date | null;
};

export type OutputType = {
  /** Tasks the AI found that are not already in the list. */
  suggested: SuggestedTask[];
  /** The note has not changed since the last look — nothing new to find. */
  unchanged: boolean;
};

/** Today as YYYY-MM-DD on this device's calendar. */
function localIsoDay(date: Date): string {
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${m}-${d}`;
}

/** The server's due day (its UTC calendar day) as local noon on the same day. */
export function dueDayAtLocalNoon(date: Date): Date {
  return new Date(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 12);
}

export const postTasksExtract = async (
  body: InputType,
  init?: RequestInit,
): Promise<OutputType> => {
  const validatedInput = schema.parse({ currentDate: localIsoDay(new Date()), ...body });
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
  const output = superjson.parse<OutputType>(await result.text());
  return {
    ...output,
    suggested: output.suggested.map((item) => ({
      ...item,
      completeBy: item.completeBy ? dueDayAtLocalNoon(item.completeBy) : null,
    })),
  };
};
