import type { Kysely, Transaction } from "kysely";
import type { DB } from "./schema";

/** At most this many areas on one note; more stops being a tag. */
export const MAX_NOTE_PROJECTS = 20;

/**
 * Add each note's project ids, in one query for the whole list. Notes come
 * back with `projectIds: []` when they carry no tags.
 */
export async function attachProjectIds<T extends { id: string }>(
  db: Kysely<DB>,
  notes: T[],
  userId: number,
): Promise<Array<T & { projectIds: string[] }>> {
  if (notes.length === 0) return [];
  const rows = await db
    .selectFrom("noteProjects")
    .select(["noteId", "projectId"])
    .where("userId", "=", userId)
    .where(
      "noteId",
      "in",
      notes.map((note) => note.id),
    )
    .orderBy("createdAt")
    .execute();
  const byNote = new Map<string, string[]>();
  for (const row of rows) {
    const list = byNote.get(row.noteId) ?? [];
    list.push(row.projectId);
    byNote.set(row.noteId, list);
  }
  return notes.map((note) => ({ ...note, projectIds: byNote.get(note.id) ?? [] }));
}

/**
 * Make a note's tags exactly `projectIds`. Every id must be one of the
 * caller's projects; one that is not fails the whole change rather than
 * being silently dropped.
 */
export async function replaceNoteProjects(
  trx: Transaction<DB>,
  noteId: string,
  userId: number,
  projectIds: string[],
): Promise<void> {
  const wanted = [...new Set(projectIds)];
  if (wanted.length > 0) {
    const owned = await trx
      .selectFrom("projects")
      .select("id")
      .where("userId", "=", userId)
      .where("id", "in", wanted)
      .execute();
    if (owned.length !== wanted.length) {
      throw new Error("One of those areas could not be found.");
    }
  }
  await trx.deleteFrom("noteProjects").where("noteId", "=", noteId).where("userId", "=", userId).execute();
  if (wanted.length > 0) {
    await trx
      .insertInto("noteProjects")
      .values(wanted.map((projectId) => ({ noteId, projectId, userId })))
      .execute();
  }
}
