import { sql } from "kysely";
import superjson from "superjson";
import { notInFuture } from "../../helpers/clientIds";
import { db } from "../../helpers/db";
import { requireUser } from "../../helpers/requireUser";
import { endpointError } from "../../helpers/endpointError";
import { NOTE_RECORD_COLUMNS, readableDoc } from "../../helpers/NoteRecord";
import { attachProjectIds, replaceNoteProjects } from "../../helpers/noteProjects";
import { removeNoteEntities } from "../../helpers/noteEntityIndex";
import { schema, type OutputType } from "./update_POST.schema";

export async function handle(request: Request) {
  try {
    const user = await requireUser(request);
    const input = schema.parse(superjson.parse(await request.text()));

    const values: {
      title?: string;
      content?: string;
      archived?: boolean;
      updatedAt: Date;
    } = { updatedAt: notInFuture(input.changedAt) };
    if (input.title !== undefined) values.title = input.title;
    if (input.content !== undefined) values.content = input.content;
    if (input.archived !== undefined) values.archived = input.archived;
    // The rich text comes with its Markdown. New words without it (a plain
    // edit, from the web app) leave the old document behind: it goes.
    const doc =
      input.doc !== undefined
        ? input.doc === null
          ? null
          : sql<string>`${JSON.stringify(input.doc)}::text::jsonb`
        : input.content !== undefined
          ? null
          : undefined;

    const row = await db.transaction().execute(async (trx) => {
      const updated = await trx
        .updateTable("notes")
        .set(values)
        .set(doc === undefined ? {} : { doc })
        .where("id", "=", input.id)
        .where("userId", "=", user.id)
        .returning([...NOTE_RECORD_COLUMNS])
        .executeTakeFirst();
      if (updated && input.projectIds !== undefined) {
        await replaceNoteProjects(trx, updated.id, user.id, input.projectIds);
      }
      return updated;
    });

    if (!row) {
      return new Response(
        superjson.stringify({ error: "That note could not be found." }),
        { status: 404, headers: { "Content-Type": "application/json" } },
      );
    }

    // An archived note leaves the entity index, so it stops shaping
    // suggestions; unarchiving lets it be indexed again.
    if (input.archived === true) {
      await removeNoteEntities(row.id);
    }
    const [note] = await attachProjectIds(db, [readableDoc(row)], user.id);

    return new Response(superjson.stringify({ note } satisfies OutputType));
  } catch (error) {
    return endpointError(error);
  }
}