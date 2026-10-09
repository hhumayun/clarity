import superjson from "superjson";
import type { NoteRecord } from "../../helpers/NoteRecord";
import type { AttachmentContentType, EntityType, FocusOutcome } from "../../helpers/schema";
import type { ProjectRecord, TaskRecord } from "../../helpers/TaskRecord";
import { apiFetch } from "../../helpers/apiFetch";

export type ExportedEntity = {
  noteId: string;
  type: EntityType;
  name: string;
  aliases: string[];
};

export type ExportedFocusSession = {
  id: string;
  taskId: string;
  plannedMinutes: number;
  focusedSeconds: number;
  firstStep: string;
  outcome: FocusOutcome;
  leftOff: string;
  startedAt: Date;
  endedAt: Date;
};

/** A photo still in a note. `url` downloads it until photoLinksExpireAt; null with photos off. */
export type ExportedPhoto = {
  id: string;
  contentType: AttachmentContentType;
  bytes: number;
  width: number | null;
  height: number | null;
  createdAt: Date;
  /** The notes that name it. */
  noteIds: string[];
  url: string | null;
};

export type OutputType = {
  exportedAt: Date;
  notes: NoteRecord[];
  entities: ExportedEntity[];
  projects: ProjectRecord[];
  tasks: TaskRecord[];
  focusSessions: ExportedFocusSession[];
  /** When every photo url stops working (one hour after the export); null with photos off. */
  photoLinksExpireAt: Date | null;
  photoLinksNote: string;
  photos: ExportedPhoto[];
};

export const getAccountExport = async (
  init?: RequestInit,
): Promise<OutputType> => {
  const result = await apiFetch(`/_api/account/export`, {
    method: "GET",
    ...init,
  });
  if (!result.ok) {
    const errorObject = superjson.parse<{ error: string }>(await result.text());
    throw new Error(errorObject.error);
  }
  return superjson.parse<OutputType>(await result.text());
};