import { z } from "zod";
import superjson from "superjson";
import type { TaskRecord } from "../../helpers/TaskRecord";
import { DUE_TIME_PATTERN, MAX_REMIND_BEFORE, REMINDER_REPEAT_VALUES, TASK_STATUS_VALUES } from "../../helpers/TaskRecord";
import { apiFetch } from "../../helpers/apiFetch";

export const schema = z
  .object({
    /** Made on the phone, so a retried create returns the same task. */
    id: z.string().uuid().optional(),
    /** When it was added on the phone; never later than now. */
    createdAt: z.date().optional(),
    text: z.string().trim().min(1).max(500),
    description: z.string().max(5000).optional(),
    projectId: z.string().uuid().optional(),
    projectName: z.string().trim().min(1).max(120).optional(),
    completeBy: z.date().nullable().optional(),
    /** The time on its day, "HH:MM"; ignored without a day. */
    dueTime: z.string().regex(DUE_TIME_PATTERN).nullable().optional(),
    /** Minutes before the task's time (or 9:00 on its day) to remind. */
    remindBefore: z.number().int().min(0).max(MAX_REMIND_BEFORE).nullable().optional(),
    remindRepeat: z.enum(REMINDER_REPEAT_VALUES).nullable().optional(),
    status: z.enum(TASK_STATUS_VALUES).optional(),
    noteId: z.string().uuid().nullable().optional(),
  })
  .refine((v) => v.projectId || v.projectName, {
    message: "Choose a project for this task.",
    path: ["projectId"],
  });
export type InputType = z.infer<typeof schema>;
export type OutputType = { task: TaskRecord };

export const postTaskCreate = async (
  body: InputType,
  init?: RequestInit,
): Promise<OutputType> => {
  const validatedInput = schema.parse(body);
  const result = await apiFetch("/_api/tasks/create", {
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
