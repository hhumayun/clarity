import { z } from "zod";
import superjson from "superjson";
import { apiFetch } from "../../helpers/apiFetch";
import type { NoteSource } from "../../helpers/schema";

export const schema = z.object({ taskId: z.string().uuid() });
export type InputType = z.infer<typeof schema>;

/** A note linked to a task, as listed under it. */
export type LinkedNote = {
  id: string;
  title: string;
  /** The start of the note, on one line. */
  preview: string;
  source: NoteSource | null;
  createdAt: Date;
  updatedAt: Date;
};

export type OutputType = { notes: LinkedNote[] };

export const getTaskNotes = async (params: InputType, init?: RequestInit): Promise<OutputType> => {
  const validated = schema.parse(params);
  const result = await apiFetch(`/_api/tasks/notes?taskId=${encodeURIComponent(validated.taskId)}`, {
    method: "GET",
    ...init,
  });
  if (!result.ok) {
    const errorObject = superjson.parse<{ error: string }>(await result.text());
    throw new Error(errorObject.error);
  }
  return superjson.parse<OutputType>(await result.text());
};
