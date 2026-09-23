import { z } from "zod";
import superjson from "superjson";
import type { NoteRecord } from "../../helpers/NoteRecord";
import { apiFetch } from "../../helpers/apiFetch";
import { MAX_NOTE_PROJECTS } from "../../helpers/noteProjects";

export const schema = z.object({
  id: z.string().min(1),
  title: z.string().max(300).optional(),
  content: z.string().max(100_000).optional(),
  archived: z.boolean().optional(),
  /** Replaces the note's areas with exactly these. Omit to leave them alone. */
  projectIds: z.array(z.string().min(1)).max(MAX_NOTE_PROJECTS).optional(),
});

export type InputType = z.infer<typeof schema>;

export type OutputType = {
  note: NoteRecord;
};

export const postNoteUpdate = async (
  body: InputType,
  init?: RequestInit,
): Promise<OutputType> => {
  const validatedInput = schema.parse(body);
  const result = await apiFetch(`/_api/notes/update`, {
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