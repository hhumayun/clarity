import { sql } from "kysely";
import superjson from "superjson";
import { db } from "../../helpers/db";
import { linkNoteTask } from "../../helpers/taskRecords";
import { notInFuture } from "../../helpers/clientIds";
import { requireUser } from "../../helpers/requireUser";
import { endpointError } from "../../helpers/endpointError";
import { NOTE_RECORD_COLUMNS, readableDoc } from "../../helpers/NoteRecord";
import { attachProjectIds, replaceNoteProjects } from "../../helpers/noteProjects";
import { schema, type OutputType } from "./create_POST.schema";

export async function handle(request: Request) {
  try {
    const user = await requireUser(request);
    const input = schema.parse(superjson.parse(await request.text()));
    if (input.taskId) {
      const task = await db.selectFrom("tasks").select("id").where("id", "=", input.taskId).where("userId", "=", user.id).where("deletedAt", "is", null).executeTakeFirst();
      if (!task) return new Response(superjson.stringify({ error: "That task could not be found." }), { status: 404 });
    }

    const row = await db.transaction().execute(async (trx) => {
      const at = notInFuture(input.createdAt);
      const created = await trx
        .insertInto("notes")
        .values({
          ...(input.id ? { id: input.id } : {}),
          userId: user.id,
          title: input.title,
          content: input.content,
          doc: input.doc ? sql<string>`${JSON.stringify(input.doc)}::text::jsonb` : null,
          source: input.source ?? null,
          taskId: input.taskId ?? null,
          createdAt: at,
          updatedAt: at,
        })
        .onConflict((conflict) => conflict.column("id").doNothing())
        .returning([...NOTE_RECORD_COLUMNS])
        .executeTakeFirst();
      if (!created) {
        // Sent before: the note is already there (if it is this person's).
        return (
          (await trx
            .selectFrom("notes")
            .select([...NOTE_RECORD_COLUMNS])
            .where("id", "=", input.id!)
            .where("userId", "=", user.id)
            .executeTakeFirst()) ?? null
        );
      }
      if (input.projectIds?.length) {
        await replaceNoteProjects(trx, created.id, user.id, input.projectIds);
      }
      // A thought parked during focus is linked to the task being worked on.
      if (input.taskId) await linkNoteTask(trx, { noteId: created.id, taskId: input.taskId, userId: user.id });
      return created;
    });
    if (!row) return new Response(superjson.stringify({ error: "That note could not be found." }), { status: 404 });
    const [note] = await attachProjectIds(db, [readableDoc(row)], user.id);

    return new Response(superjson.stringify({ note } satisfies OutputType));
  } catch (error) {
    return endpointError(error);
  }
}