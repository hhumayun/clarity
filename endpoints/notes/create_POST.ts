import superjson from "superjson";
import { db } from "../../helpers/db";
import { requireUser } from "../../helpers/requireUser";
import { endpointError } from "../../helpers/endpointError";
import { NOTE_RECORD_COLUMNS } from "../../helpers/NoteRecord";
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
      const created = await trx
        .insertInto("notes")
        .values({
          userId: user.id,
          title: input.title,
          content: input.content,
          source: input.source ?? null,
          taskId: input.taskId ?? null,
        })
        .returning([...NOTE_RECORD_COLUMNS])
        .executeTakeFirstOrThrow();
      if (input.projectIds?.length) {
        await replaceNoteProjects(trx, created.id, user.id, input.projectIds);
      }
      return created;
    });
    const [note] = await attachProjectIds(db, [row], user.id);

    return new Response(superjson.stringify({ note } satisfies OutputType));
  } catch (error) {
    return endpointError(error);
  }
}