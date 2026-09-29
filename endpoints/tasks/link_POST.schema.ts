import { z } from "zod";
import superjson from "superjson";
import type { TaskRecord } from "../../helpers/TaskRecord";
import { apiFetch } from "../../helpers/apiFetch";

export const schema = z.object({
  taskId: z.string().uuid(),
  noteId: z.string().uuid(),
  /** true links the two; false removes the link and nothing else. */
  linked: z.boolean(),
});
export type InputType = z.infer<typeof schema>;
export type OutputType = { task: TaskRecord };

export const postTaskLink = async (body: InputType, init?: RequestInit): Promise<OutputType> => {
  const validatedInput = schema.parse(body);
  const result = await apiFetch("/_api/tasks/link", {
    method: "POST", body: superjson.stringify(validatedInput), ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!result.ok) {
    const errorObject = superjson.parse<{ error: string }>(await result.text());
    throw new Error(errorObject.error);
  }
  return superjson.parse<OutputType>(await result.text());
};
