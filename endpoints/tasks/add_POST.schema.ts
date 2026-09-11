import { z } from "zod";
import superjson from "superjson";
import type { TaskRecord } from "../../helpers/TaskRecord";
import { apiFetch } from "../../helpers/apiFetch";

export const schema = z.object({
  noteId: z.string().uuid(),
  tasks: z
    .array(
      z.object({
        text: z.string().trim().min(1).max(500),
        projectName: z.string().trim().min(1).max(120),
        completeBy: z.date().nullable().optional(),
      }),
    )
    .min(1)
    .max(30),
});
export type InputType = z.infer<typeof schema>;
export type OutputType = { added: number; tasks: TaskRecord[] };

export const postTasksAdd = async (
  body: InputType,
  init?: RequestInit,
): Promise<OutputType> => {
  const validatedInput = schema.parse(body);
  const result = await apiFetch("/_api/tasks/add", {
    method: "POST", body: superjson.stringify(validatedInput), ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!result.ok) {
    const errorObject = superjson.parse<{ error: string }>(await result.text());
    throw new Error(errorObject.error);
  }
  return superjson.parse<OutputType>(await result.text());
};
