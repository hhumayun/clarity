import { z } from "zod";
import superjson from "superjson";
import { apiFetch } from "../helpers/apiFetch";

export const schema = z.object({
  usePersonalization: z.boolean(),
});

export type InputType = z.infer<typeof schema>;

export type OutputType = {
  usePersonalization: boolean;
};

export const postPreferences = async (
  body: InputType,
  init?: RequestInit,
): Promise<OutputType> => {
  const validatedInput = schema.parse(body);
  const result = await apiFetch(`/_api/preferences`, {
    method: "POST",
    body: superjson.stringify(validatedInput),
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  if (!result.ok) {
    const errorObject = superjson.parse<{ error: string }>(await result.text());
    throw new Error(errorObject.error);
  }
  return superjson.parse<OutputType>(await result.text());
};