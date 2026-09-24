import { z } from "zod";
import superjson from "superjson";
import type { NoteRecord } from "../../helpers/NoteRecord";
import { apiFetch } from "../../helpers/apiFetch";

export const schema = z.object({
  q: z.string().max(200).optional(),
  archived: z.boolean().optional(),
  /** Only notes written at or after this moment (the journal's week). */
  from: z.coerce.date().optional(),
  /** ...and before this one. */
  to: z.coerce.date().optional(),
  /**
   * Ask for pages of this many notes, newest written first. Without it the
   * list is the newest-edited 200 in one go.
   */
  limit: z.coerce.number().int().min(1).max(100).optional(),
  /** Where the previous page ended: its `nextCursor`. */
  cursor: z.string().min(1).max(500).optional(),
});

export type InputType = z.infer<typeof schema>;

export type OutputType = {
  notes: NoteRecord[];
  /** Paged lists only: pass back as `cursor` for the next page; null on the last. */
  nextCursor?: string | null;
};

export const getNotesList = async (
  params: InputType = {},
  init?: RequestInit,
): Promise<OutputType> => {
  const validated = schema.parse(params);
  const search = new URLSearchParams();
  if (validated.q) search.set("q", validated.q);
  if (validated.archived) search.set("archived", "true");
  if (validated.from) search.set("from", validated.from.toISOString());
  if (validated.to) search.set("to", validated.to.toISOString());
  if (validated.limit) search.set("limit", String(validated.limit));
  if (validated.cursor) search.set("cursor", validated.cursor);
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