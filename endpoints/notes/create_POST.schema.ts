import { z } from "zod";
import superjson from "superjson";
import type { NoteRecord } from "../../helpers/NoteRecord";
import { apiFetch } from "../../helpers/apiFetch";
import { NoteSourceArrayValues } from "../../helpers/schema";

export const schema = z.object({
  title: z.string().max(300).default(""),
  content: z.string().max(100_000).default(""),
  /** Omitted for notes written in the editor; "focus" for a parked thought. */
  source: z.enum(NoteSourceArrayValues).optional(),
});

export type InputType = z.infer<typeof schema>;

export type OutputType = {
  note: NoteRecord;
};

export const postNoteCreate = async (
  body: InputType,
  init?: RequestInit,
): Promise<OutputType> => {
  const validatedInput = schema.parse(body);
  const result = await apiFetch(`/_api/notes/create`, {
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