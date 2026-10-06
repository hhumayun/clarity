import { z } from "zod";
import superjson from "superjson";
import type { TaskRecord } from "../../helpers/TaskRecord";
import { DUE_TIME_PATTERN, MAX_REMIND_BEFORE, REMINDER_REPEAT_VALUES, TASK_STATUS_VALUES } from "../../helpers/TaskRecord";
import { apiFetch } from "../../helpers/apiFetch";

export const schema = z.object({
  id: z.string().uuid(),
  text: z.string().trim().min(1).max(500).optional(),
  /** Longer detail under the task's one line; "" clears it. */
  description: z.string().max(5000).optional(),
  projectId: z.string().uuid().optional(),
  completeBy: z.date().nullable().optional(),
  /** The time on its day, "HH:MM"; null for any time. Cleared with the day. */
  dueTime: z.string().regex(DUE_TIME_PATTERN).nullable().optional(),
  /** Minutes before the task's time (or 9:00 on its day) to remind; null for none. */
  remindBefore: z.number().int().min(0).max(MAX_REMIND_BEFORE).nullable().optional(),
  remindRepeat: z.enum(REMINDER_REPEAT_VALUES).nullable().optional(),
  /** The reminder is for this time only, not each time the task repeats. */
  remindOnce: z.boolean().optional(),
  status: z.enum(TASK_STATUS_VALUES).optional(),
  /** The day it was planned for before a move (Catch up, the menu, the date sheet) pushed it on; null clears it. */
  movedFrom: z.date().nullable().optional(),
  /**
   * When the change was made on the phone. An edit made offline keeps that
   * time instead of the time it reached the server; never later than now.
   */
  changedAt: z.date().optional(),
});
export type InputType = z.infer<typeof schema>;
export type OutputType = { task: TaskRecord };

export const postTaskUpdate = async (
  body: InputType,
  init?: RequestInit,
): Promise<OutputType> => {
  const validatedInput = schema.parse(body);
  const result = await apiFetch("/_api/tasks/update", {
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
