import superjson from "superjson";
import { db } from "../../helpers/db";
import { linkNoteTask, selectTaskRecords } from "../../helpers/taskRecords";
import { requireUser } from "../../helpers/requireUser";
import { endpointError } from "../../helpers/endpointError";
import { schema, type OutputType } from "./link_POST.schema";

/**
 * Link a note and a task, or unlink them. Either side can have any number of
 * links; unlinking never deletes the task or the note.
 */
export async function handle(request: Request) {
  try {
    const user = await requireUser(request);
    const input = schema.parse(superjson.parse(await request.text()));
    const [task, note] = await Promise.all([
      db.selectFrom("tasks").select("id").where("id", "=", input.taskId).where("userId", "=", user.id).where("deletedAt", "is", null).executeTakeFirst(),
      db.selectFrom("notes").select("id").where("id", "=", input.noteId).where("userId", "=", user.id).executeTakeFirst(),
    ]);
    if (!task) return new Response(superjson.stringify({ error: "That task could not be found." }), { status: 404 });
    if (!note) return new Response(superjson.stringify({ error: "That note could not be found." }), { status: 404 });

    if (input.linked) {
      await linkNoteTask(db, { noteId: input.noteId, taskId: input.taskId, userId: user.id });
    } else {
      await db
        .deleteFrom("noteTasks")
        .where("noteId", "=", input.noteId)
        .where("taskId", "=", input.taskId)
        .where("userId", "=", user.id)
        .execute();
    }

    const updated = await selectTaskRecords(db, user.id).where("tasks.id", "=", input.taskId).executeTakeFirstOrThrow();
    return new Response(superjson.stringify({ task: updated } satisfies OutputType));
  } catch (error) {
    return endpointError(error);
  }
}
