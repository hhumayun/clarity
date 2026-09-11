import { z } from "zod";
import superjson from "superjson";
import type { ProjectRecord } from "../../helpers/TaskRecord";
import { apiFetch } from "../../helpers/apiFetch";

export const schema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(120),
});
export type InputType = z.infer<typeof schema>;
export type OutputType = { project: ProjectRecord };

export const postProjectUpdate = async (
  body: InputType,
  init?: RequestInit,
): Promise<OutputType> => {
  const validatedInput = schema.parse(body);
  const result = await apiFetch("/_api/projects/update", {
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
