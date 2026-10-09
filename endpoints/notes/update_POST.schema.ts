import { z } from "zod";
import superjson from "superjson";
import type { NoteRecord } from "../../helpers/NoteRecord";
import { apiFetch } from "../../helpers/apiFetch";
import { MAX_NOTE_PROJECTS } from "../../helpers/noteProjects";
import { noteDocSchema } from "../../helpers/noteDoc";
import { MAX_PHOTOS_PER_NOTE } from "../../helpers/attachmentLimits";

export const schema = z.object({
  id: z.string().min(1),
  title: z.string().max(300).optional(),
  content: z.string().max(100_000).optional(),
  /**
   * The rich text as the editor keeps it, sent with its Markdown (`content`).
   * New words without it (a plain-text edit) clear it, so an old document
   * never comes back over them.
   */
  doc: noteDocSchema.nullable().optional(),
  archived: z.boolean().optional(),
  /** Replaces the note's areas with exactly these. Omit to leave them alone. */
  projectIds: z.array(z.string().min(1)).max(MAX_NOTE_PROJECTS).optional(),
  /**
   * When the change was made on the phone. An edit made offline keeps that
   * time instead of the time it reached the server; never later than now.
   */
  changedAt: z.date().optional(),
  /**
   * Ids of photos this writer saw in this note and took out. A photo the
   * note had that this save neither names nor lists here is put back at the
   * end of the note, so a writer that never saw a photo can't remove it.
   */
  removedPhotos: z.array(z.string().max(100)).max(MAX_PHOTOS_PER_NOTE).optional(),
});

export type InputType = z.infer<typeof schema>;

export type OutputType = {
  note: NoteRecord;
  /** Photo ids the note names that the server has no ready photo for (at most 100). */
  missingPhotos: string[];
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