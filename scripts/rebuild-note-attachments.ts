// Rebuilds every note's photo links (note_attachments) from the note's own
// Markdown and rich text, with the same rule the save hook uses
// (attachmentIdsOf in helpers/attachmentRefs.tsx). For after a rollback:
// while older code ran, note saves wrote no links and note deletes marked no
// photos (docs/photos-server.md, section 12, step 6). Safe to run any time,
// and more than once.
//
// Per batch of notes, in one transaction under the notes' row locks: links a
// note no longer names go, links it names are added; photos named again lose
// their orphan mark, photos no link names any more get one (the sweep still
// reads the notes' text before deleting anything). Prints counts only.
//
//   railway run --service clarity-notes --environment production npx tsx scripts/rebuild-note-attachments.ts
//   DATABASE_URL=postgres://postgres@localhost:5440/postgres npx tsx scripts/rebuild-note-attachments.ts
import { sql } from "kysely";
import { db } from "../helpers/db";
import { attachmentIdsOf } from "../helpers/attachmentRefs";
import { markOrphansIfUnused } from "../helpers/noteAttachments";

const BATCH = 200;

type Counts = { notes: number; linksAdded: number; linksRemoved: number; unmarked: number };

async function rebuildBatch(noteIds: string[], counts: Counts) {
  await db.transaction().execute(async (trx) => {
    const notes = await trx
      .selectFrom("notes")
      .select(["id", "userId", "content", "doc"])
      .where("id", "in", noteIds)
      .orderBy("id")
      .forUpdate()
      .execute();
    if (notes.length === 0) return;
    const links = await trx
      .selectFrom("noteAttachments")
      .select(["noteId", "attachmentId"])
      .where("noteId", "in", notes.map((n) => n.id))
      .execute();
    const linkedByNote = new Map<string, Set<string>>();
    for (const link of links) {
      const set = linkedByNote.get(link.noteId) ?? new Set<string>();
      set.add(link.attachmentId);
      linkedByNote.set(link.noteId, set);
    }

    const droppedByUser = new Map<number, Set<string>>();
    const addedByUser = new Map<number, Set<string>>();
    for (const note of notes) {
      counts.notes++;
      const named = attachmentIdsOf(note.content, note.doc);
      const linked = linkedByNote.get(note.id) ?? new Set<string>();
      const dropped = [...linked].filter((id) => !named.has(id));
      const added = [...named].filter((id) => !linked.has(id));
      if (dropped.length > 0) {
        await trx
          .deleteFrom("noteAttachments")
          .where("noteId", "=", note.id)
          .where("attachmentId", "in", dropped)
          .execute();
        counts.linksRemoved += dropped.length;
        const set = droppedByUser.get(note.userId) ?? new Set<string>();
        dropped.forEach((id) => set.add(id));
        droppedByUser.set(note.userId, set);
      }
      if (added.length > 0) {
        await trx
          .insertInto("noteAttachments")
          .values(added.map((attachmentId) => ({ noteId: note.id, userId: note.userId, attachmentId })))
          .onConflict((conflict) => conflict.columns(["noteId", "attachmentId"]).doNothing())
          .execute();
        counts.linksAdded += added.length;
        const set = addedByUser.get(note.userId) ?? new Set<string>();
        added.forEach((id) => set.add(id));
        addedByUser.set(note.userId, set);
      }
    }

    for (const [userId, ids] of addedByUser) {
      const result = await trx
        .updateTable("attachments")
        .set({ orphanedSince: null })
        .where("userId", "=", userId)
        .where("id", "in", [...ids])
        .where("orphanedSince", "is not", null)
        .executeTakeFirst();
      counts.unmarked += Number(result.numUpdatedRows ?? 0);
    }
    for (const [userId, ids] of droppedByUser) {
      await markOrphansIfUnused(trx, userId, [...ids]);
    }
  });
}

async function main() {
  const counts: Counts = { notes: 0, linksAdded: 0, linksRemoved: 0, unmarked: 0 };
  let after = "";
  for (;;) {
    const page = await db
      .selectFrom("notes")
      .select("id")
      .where(sql<boolean>`id::text > ${after}`)
      .orderBy(sql`id::text`)
      .limit(BATCH)
      .execute();
    if (page.length === 0) break;
    const ids = page.map((row) => row.id);
    await rebuildBatch(ids, counts);
    after = ids[ids.length - 1];
    if (page.length < BATCH) break;
  }
  const { rows } = await sql<{ n: number }>`select count(*)::int as n from note_attachments`.execute(db);
  console.log(
    `rebuild-note-attachments: ${counts.notes} notes read, ${counts.linksAdded} links added, ` +
      `${counts.linksRemoved} removed, ${counts.unmarked} photos unmarked; ${rows[0]?.n ?? 0} links now`,
  );
}

main()
  .then(async () => {
    await db.destroy();
    process.exit(0);
  })
  .catch(async (error: unknown) => {
    // Name and SQLSTATE only: messages can carry note text.
    const e = error as { name?: string; code?: string } | null;
    console.error("rebuild-note-attachments failed:", e?.name ?? "Error", e?.code ?? "");
    await db.destroy().catch(() => undefined);
    process.exit(1);
  });
