import { z } from "zod";
import superjson from "superjson";
import type { NoteRecord } from "../../helpers/NoteRecord";
import { apiFetch } from "../../helpers/apiFetch";

export const schema = z.object({
  id: z.string().min(1),
});

export type InputType = z.infer<typeof schema>;

export type OutputType = {
  note: NoteRecord;
};

export const getNote = async (
  params: InputType,
  init?: RequestInit,
): Promise<OutputType> => {
  const validated = schema.parse(params);
  const search = new URLSearchParams({ id: validated.id });

  const result = await apiFetch(`/_api/notes/get?${search.toString()}`, {
    method: "GET",
    ...init,
  });
  if (!result.ok) {
    const errorObject = superjson.parse<{ error: string }>(await result.text());
    throw new Error(errorObject.error);
  }
  return superjson.parse<OutputType>(await result.text());
};