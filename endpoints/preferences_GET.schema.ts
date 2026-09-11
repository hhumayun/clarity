import { z } from "zod";
import superjson from "superjson";
import { apiFetch } from "../helpers/apiFetch";

export const schema = z.object({});

export type InputType = z.infer<typeof schema>;

export type OutputType = {
  usePersonalization: boolean;
};

export const getPreferences = async (
  init?: RequestInit,
): Promise<OutputType> => {
  const result = await apiFetch(`/_api/preferences`, { method: "GET", ...init });
  if (!result.ok) {
    const errorObject = superjson.parse<{ error: string }>(await result.text());
    throw new Error(errorObject.error);
  }
  return superjson.parse<OutputType>(await result.text());
};