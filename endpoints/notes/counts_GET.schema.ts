import superjson from "superjson";
import { apiFetch } from "../../helpers/apiFetch";

export type OutputType = {
  /** How many notes are archived: the whole count, not a page of them. */
  archived: number;
};

export const getNoteCounts = async (init?: RequestInit): Promise<OutputType> => {
  const result = await apiFetch("/_api/notes/counts", { method: "GET", ...init });
  if (!result.ok) {
    const errorObject = superjson.parse<{ error: string }>(await result.text());
    throw new Error(errorObject.error);
  }
  return superjson.parse<OutputType>(await result.text());
};
