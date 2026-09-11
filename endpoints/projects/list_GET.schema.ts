import superjson from "superjson";
import type { ProjectRecord } from "../../helpers/TaskRecord";
import { apiFetch } from "../../helpers/apiFetch";

export type OutputType = { projects: ProjectRecord[] };

export const getProjectsList = async (
  init?: RequestInit,
): Promise<OutputType> => {
  const result = await apiFetch("/_api/projects/list", { method: "GET", ...init });
  if (!result.ok) {
    const errorObject = superjson.parse<{ error: string }>(await result.text());
    throw new Error(errorObject.error);
  }
  return superjson.parse<OutputType>(await result.text());
};
