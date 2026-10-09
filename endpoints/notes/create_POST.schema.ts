import { z } from "zod";
import superjson from "superjson";
import type { NoteRecord } from "../../helpers/NoteRecord";
import { apiFetch } from "../../helpers/apiFetch";
import { NoteSourceArrayValues } from "../../helpers/schema";
import { MAX_NOTE_PROJECTS } from "../../helpers/noteProjects";
import { noteDocSchema } from "../../helpers/noteDoc";
import { MAX_PHOTOS_PER_NOTE } from "../../helpers/attachmentLimits";

export const schema = z.object({
  /** Made on the phone, so a retried create returns the same note. */
  id: z.string().uuid().optional(),
  /** When it was written on the phone; never later than now. */
  createdAt: z.date().optional(),
  title: z.string().max(300).default(""),
  content: z.string().max(100_000).default(""),
  /** The rich text as the editor keeps it; `content` is its Markdown. */
  doc: noteDocSchema.optional(),
  /** Omitted for notes written in the editor; "focus" for a parked thought. */
  source: z.enum(NoteSourceArrayValues).optional(),
  /** For a thought parked during focus time: the task being worked on. */
  taskId: z.string().uuid().optional(),
  /** Areas to tag the note with from the start. */
  projectIds: z.array(z.string().min(1)).max(MAX_NOTE_PROJECTS).optional(),
  /**
   * Ids of photos this writer saw in this note and took out. A new note has
   * no photos to keep, so it changes nothing here; accepted so one body
   * shape serves both create and update.
   */
  removedPhotos: z.array(z.string().max(100)).max(MAX_PHOTOS_PER_NOTE).optional(),
});

export type InputType = z.infer<typeof schema>;

export type OutputType = {
  note: NoteRecord;
  /** Photo ids the note names that the server has no ready photo for (at most 100). */
  missingPhotos: string[];
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