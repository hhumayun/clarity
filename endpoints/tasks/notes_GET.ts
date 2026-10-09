import superjson from "superjson";
import { db } from "../../helpers/db";
import { requireUser } from "../../helpers/requireUser";
import { endpointError } from "../../helpers/endpointError";
import { schema, type OutputType } from "./notes_GET.schema";
import { withoutAttachments } from "../../helpers/attachmentRefs";

const PREVIEW_CHARS = 220;

/** Every note linked to a task, newest first. */
export async function handle(request: Request) {
  try {
    const user = await requireUser(request);
    const url = new URL(request.url);
    const input = schema.parse({ taskId: url.searchParams.get("taskId") ?? undefined });
    const task = await db.selectFrom("tasks").select("id").where("id", "=", input.taskId).where("userId", "=", user.id).where("deletedAt", "is", null).executeTakeFirst();
    if (!task) return new Response(superjson.stringify({ error: "That task could not be found." }), { status: 404 });

    const rows = await db
      .selectFrom("noteTasks")
      .innerJoin("notes", "notes.id", "noteTasks.noteId")
      .select(["notes.id as id", "notes.title as title", "notes.content as content", "notes.source as source", "notes.createdAt as createdAt", "notes.updatedAt as updatedAt"])
      .where("noteTasks.taskId", "=", input.taskId)
      .where("noteTasks.userId", "=", user.id)
      .where("notes.userId", "=", user.id)
      .orderBy("notes.createdAt", "desc")
      .execute();

    const notes = rows.map(({ content, ...note }) => ({
      ...note,
      preview: withoutAttachments(content).replace(/\s+/g, " ").trim().slice(0, PREVIEW_CHARS),
    }));
    return new Response(superjson.stringify({ notes } satisfies OutputType));
  } catch (error) {
    return endpointError(error);
  }
}
