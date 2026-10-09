import { sql, type Selectable, type Transaction } from "kysely";
import type { DB, Notes } from "./schema";
import { NOTE_RECORD_COLUMNS } from "./NoteRecord";
import { MAX_MISSING_LISTED, MAX_PHOTOS_PER_NOTE } from "./attachmentLimits";
import { appendPhotos, attachmentIdsOf } from "./attachmentRefs";

/**
 * Keeping `note_attachments` in step with what each saved note names
 * (docs/photos-server.md, 6.1-6.3). Every function takes the caller's
 * transaction, never `db`, so it runs under the note's row lock. Backend only.
 */

/** A note row as the note endpoints read it back. */
export type NoteRow = Pick<Selectable<Notes>, (typeof NOTE_RECORD_COLUMNS)[number]>;

/**
 * Called inside the note's transaction, AFTER its insert or update (which
 * holds the note's row lock, so the links read here are the ones the previous
 * save committed). Makes the links match what the note names, puts back
 * photos the writer didn't say it removed (at the end of the note), and lists
 * the named ids the server has no ready photo for.
 */
export async function syncNoteAttachments<T extends NoteRow>(
  trx: Transaction<DB>,
  userId: number,
  note: T,
  removed: ReadonlySet<string>,
): Promise<{ note: T; missing: string[] }> {
  // 1. What the save names. More than 200: the words are still saved, but
  //    only the first 200 ids (sorted, so the choice is stable) get links,
  //    and nothing is put back. The sweep reads every note's text before it
  //    deletes a photo, so one named past the cap is still kept.
  let named = attachmentIdsOf(note.content, note.doc);
  const overCap = named.size > MAX_PHOTOS_PER_NOTE;
  if (overCap) {
    console.warn(`note save names ${named.size} photos; linking the first ${MAX_PHOTOS_PER_NOTE}`);
    named = new Set([...named].sort().slice(0, MAX_PHOTOS_PER_NOTE));
  }

  // 2. What the previous save left.
  const old = new Set(
    (
      await trx
        .selectFrom("noteAttachments")
        .select("attachmentId")
        .where("noteId", "=", note.id)
        .where("userId", "=", userId)
        .execute()
    ).map((row) => row.attachmentId),
  );

  // 3. Photos the note had that this save neither names nor removes: back
  //    at the end. updatedAt isn't moved again.
  const kept = overCap ? [] : [...old].filter((id) => !named.has(id) && !removed.has(id));
  if (kept.length > 0) {
    const next = appendPhotos(note.content, note.doc, kept);
    const docChanged = next.doc !== note.doc;
    const restored = await trx
      .updateTable("notes")
      .set({ content: next.content })
      .set(docChanged ? { doc: sql<string>`${JSON.stringify(next.doc)}::text::jsonb` } : {})
      .where("id", "=", note.id)
      .where("userId", "=", userId)
      .returning([...NOTE_RECORD_COLUMNS])
      .executeTakeFirstOrThrow();
    note = { ...note, ...restored };
    for (const id of kept) named.add(id);
  }

  // 4. The links become exactly what the note names.
  const dropped = [...old].filter((id) => !named.has(id));
  const added = [...named].filter((id) => !old.has(id));
  if (dropped.length > 0) {
    await trx
      .deleteFrom("noteAttachments")
      .where("noteId", "=", note.id)
      .where("userId", "=", userId)
      .where("attachmentId", "in", dropped)
      .execute();
  }
  if (added.length > 0) {
    await trx
      .insertInto("noteAttachments")
      .values(added.map((attachmentId) => ({ noteId: note.id, userId, attachmentId })))
      .onConflict((conflict) => conflict.columns(["noteId", "attachmentId"]).doNothing())
      .execute();

    // 5. Named again: no longer an orphan.
    await trx
      .updateTable("attachments")
      .set({ orphanedSince: null })
      .where("userId", "=", userId)
      .where("id", "in", added)
      .where("orphanedSince", "is not", null)
      .execute();
  }

  // 6. Taken out of this note: an orphan, unless another note names it.
  await markOrphansIfUnused(trx, userId, dropped);

  // 7. What the server has no ready photo for.
  return { note, missing: await missingPhotos(trx, userId, named) };
}

/** The named ids with no ready photo on the server, at most MAX_MISSING_LISTED. */
export async function missingPhotos(
  trx: Transaction<DB>,
  userId: number,
  named: Iterable<string>,
): Promise<string[]> {
  const ids = [...named];
  if (ids.length === 0) return [];
  const ready = new Set(
    (
      await trx
        .selectFrom("attachments")
        .select("id")
        .where("userId", "=", userId)
        .where("id", "in", ids)
        .where("status", "=", "ready")
        .execute()
    ).map((row) => row.id),
  );
  return ids.filter((id) => !ready.has(id)).slice(0, MAX_MISSING_LISTED);
}

/** The ids a note's links name, for its delete hook. */
export async function linkedPhotos(trx: Transaction<DB>, userId: number, noteId: string): Promise<string[]> {
  return (
    await trx
      .selectFrom("noteAttachments")
      .select("attachmentId")
      .where("noteId", "=", noteId)
      .where("userId", "=", userId)
      .execute()
  ).map((row) => row.attachmentId);
}

/** Marks the photos no link names any more; the sweep deletes them after the grace (and a text check). */
export async function markOrphansIfUnused(trx: Transaction<DB>, userId: number, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await trx
    .updateTable("attachments")
    .set({ orphanedSince: sql`now()` })
    .where("userId", "=", userId)
    .where("id", "in", ids)
    .where("orphanedSince", "is", null)
    .where(({ not, exists, selectFrom }) =>
      not(
        exists(
          selectFrom("noteAttachments as l")
            .select(sql`1`.as("one"))
            .where("l.userId", "=", userId)
            .whereRef("l.attachmentId", "=", "attachments.id"),
        ),
      ),
    )
    .execute();
}
