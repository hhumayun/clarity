import { z } from "zod";
import superjson from "superjson";
import { apiFetch } from "../../helpers/apiFetch";
import type { FocusOutcome } from "../../helpers/schema";

export const schema = z.object({
  /** The start of the person's local day, so "today" means their today. */
  since: z.coerce.date(),
});
export type InputType = z.input<typeof schema>;

export type TaskFocusSummary = {
  taskId: string;
  sessions: number;
  totalSeconds: number;
  lastLeftOff: string;
  lastOutcome: FocusOutcome;
  lastPlannedMinutes: number;
  lastEndedAt: Date;
};

export type OutputType = { todaySeconds: number; tasks: TaskFocusSummary[] };

export const getFocusSummary = async (params: InputType, init?: RequestInit): Promise<OutputType> => {
  const since = new Date(params.since as string | Date).toISOString();
  const result = await apiFetch(`/_api/focus/summary?since=${encodeURIComponent(since)}`, {
    method: "GET",
    ...init,
  });
  if (!result.ok) {
    const errorObject = superjson.parse<{ error: string }>(await result.text());
    throw new Error(errorObject.error);
  }
  return superjson.parse<OutputType>(await result.text());
};
