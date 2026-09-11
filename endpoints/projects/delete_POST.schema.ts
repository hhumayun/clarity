import { z } from "zod";
import superjson from "superjson";
import { apiFetch } from "../../helpers/apiFetch";

export const schema = z.object({
  id: z.string().uuid(),
  // Where this project's tasks should go. When omitted the tasks are removed.
  moveTasksTo: z.string().uuid().optional(),
});
export type InputType = z.infer<typeof schema>;
export type OutputType = { deleted: true; movedTasks: number; removedTasks: number };

export const postProjectDelete = async (
  body: InputType,
  init?: RequestInit,
): Promise<OutputType> => {
  const validatedInput = schema.parse(body);
  const result = await apiFetch("/_api/projects/delete", {
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
