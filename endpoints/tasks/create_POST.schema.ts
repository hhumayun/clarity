import { z } from "zod";
import superjson from "superjson";
import type { TaskRecord } from "../../helpers/TaskRecord";
import { TASK_STATUS_VALUES } from "../../helpers/TaskRecord";
import { apiFetch } from "../../helpers/apiFetch";

export const schema = z
  .object({
    text: z.string().trim().min(1).max(500),
    projectId: z.string().uuid().optional(),
    projectName: z.string().trim().min(1).max(120).optional(),
    completeBy: z.date().nullable().optional(),
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
