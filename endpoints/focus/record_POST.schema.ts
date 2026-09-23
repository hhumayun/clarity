import { z } from "zod";
import superjson from "superjson";
import { apiFetch } from "../../helpers/apiFetch";
import { FocusOutcomeArrayValues } from "../../helpers/schema";

export const schema = z.object({
  taskId: z.string().uuid(),
  plannedMinutes: z.number().int().min(1).max(180),
  focusedSeconds: z.number().int().min(0).max(43_200),
  firstStep: z.string().max(300).default(""),
  outcome: z.enum(FocusOutcomeArrayValues),
  leftOff: z.string().max(2_000).default(""),
  startedAt: z.date(),
});
export type InputType = z.input<typeof schema>;
export type OutputType = { recorded: true; id: string };

export const postFocusRecord = async (body: InputType, init?: RequestInit): Promise<OutputType> => {
  const validatedInput = schema.parse(body);
  const result = await apiFetch("/_api/focus/record", {
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
