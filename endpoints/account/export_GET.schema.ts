import superjson from "superjson";
import type { NoteRecord } from "../../helpers/NoteRecord";
import type { EntityType, FocusOutcome } from "../../helpers/schema";
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

export type OutputType = {
  exportedAt: Date;
  notes: NoteRecord[];
  entities: ExportedEntity[];
  projects: ProjectRecord[];
  tasks: TaskRecord[];
  focusSessions: ExportedFocusSession[];
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