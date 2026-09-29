import type { TaskRecord } from "../types";

/** Every note a task is linked to, even from a server older than links. */
export function linkedNoteIds(task: Pick<TaskRecord, "noteId" | "noteIds">): string[] {
  return task.noteIds ?? (task.noteId ? [task.noteId] : []);
}
