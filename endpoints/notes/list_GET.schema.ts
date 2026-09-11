import { z } from "zod";
import superjson from "superjson";
import type { NoteRecord } from "../../helpers/NoteRecord";
import { apiFetch } from "../../helpers/apiFetch";

export const schema = z.object({
  q: z.string().max(200).optional(),
  archived: z.boolean().optional(),
});

export type InputType = z.infer<typeof schema>;

export type OutputType = {
  notes: NoteRecord[];
};

export const getNotesList = async (
  params: InputType = {},
  init?: RequestInit,
): Promise<OutputType> => {
  const validated = schema.parse(params);
  const search = new URLSearchParams();
  if (validated.q) search.set("q", validated.q);
  if (validated.archived) search.set("archived", "true");
  const query = search.toString();

  const result = await apiFetch(`/_api/notes/list${query ? `?${query}` : ""}`, {
    method: "GET",
    ...init,
  });
  if (!result.ok) {
    const errorObject = superjson.parse<{ error: string }>(await result.text());
    throw new Error(errorObject.error);
  }
  return superjson.parse<OutputType>(await result.text());
};