import { z } from "zod";
import superjson from "superjson";
import type { ProjectRecord, TaskRecord } from "../../helpers/TaskRecord";
import { apiFetch } from "../../helpers/apiFetch";

export const schema = z.object({ noteId: z.string().uuid().optional() });
export type InputType = z.infer<typeof schema>;
export type OutputType = {
  tasks: TaskRecord[];
  projects: ProjectRecord[];
  extraction: { hasExtracted: boolean; needsRefresh: boolean } | null;
};

export const getTasksList = async (
  params: InputType = {},
  init?: RequestInit,
): Promise<OutputType> => {
  const validated = schema.parse(params);
  const search = new URLSearchParams();
  if (validated.noteId) search.set("noteId", validated.noteId);
  const suffix = search.size > 0 ? `?${search.toString()}` : "";
  const result = await apiFetch(`/_api/tasks/list${suffix}`, { method: "GET", ...init });
  if (!result.ok) {
    const errorObject = superjson.parse<{ error: string }>(await result.text());
    throw new Error(errorObject.error);
  }
  return superjson.parse<OutputType>(await result.text());
};
