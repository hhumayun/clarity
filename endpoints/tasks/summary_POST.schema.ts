import { z } from "zod";
import superjson from "superjson";
import { apiFetch } from "../../helpers/apiFetch";
import type { ProgressStep } from "../../helpers/summarizeTask";

export const schema = z.object({
  taskId: z.string().uuid(),
  /** The writer's local date as YYYY-MM-DD, for "today" in the summary. */
  currentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});
export type InputType = z.infer<typeof schema>;

export type OutputType = {
  /** null when there is nothing to summarise yet: no notes, no focus time. */
  summary: string | null;
  progress: ProgressStep[];
  generatedAt: Date | null;
  noteCount: number;
  sessionCount: number;
};

export const postTaskSummary = async (body: InputType, init?: RequestInit): Promise<OutputType> => {
  const validatedInput = schema.parse(body);
  const result = await apiFetch("/_api/tasks/summary", {
    method: "POST", body: superjson.stringify(validatedInput), ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!result.ok) {
    const errorObject = superjson.parse<{ error: string }>(await result.text());
    throw new Error(errorObject.error);
  }
  return superjson.parse<OutputType>(await result.text());
};
