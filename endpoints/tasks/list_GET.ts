import superjson from "superjson";
import { db } from "../../helpers/db";
import { requireUser } from "../../helpers/requireUser";
import { endpointError } from "../../helpers/endpointError";
import { taskContentHash } from "../../helpers/taskContentHash";
import { schema, type OutputType } from "./list_GET.schema";

export async function handle(request: Request) {
  try {
    const user = await requireUser(request);
    const url = new URL(request.url);
    const input = schema.parse({ noteId: url.searchParams.get("noteId") ?? undefined });

    let extraction: OutputType["extraction"] = null;
    if (input.noteId) {
      const [note, record] = await Promise.all([
        db.selectFrom("notes").select(["title", "content"]).where("id", "=", input.noteId).where("userId", "=", user.id).executeTakeFirst(),
        db.selectFrom("taskExtractions").select(["contentHash"]).where("noteId", "=", input.noteId).where("userId", "=", user.id).executeTakeFirst(),
      ]);
      if (!note) {
        return new Response(superjson.stringify({ error: "That note could not be found." }), { status: 404 });
      }
      extraction = {
        hasExtracted: Boolean(record),
        needsRefresh: Boolean(record && record.contentHash !== taskContentHash(note.title, note.content)),
      };
    }

    let taskQuery = db
      .selectFrom("tasks")
      .innerJoin("projects", "projects.id", "tasks.projectId")
      .select([
        "tasks.id as id", "tasks.noteId as noteId", "tasks.projectId as projectId",
        "tasks.text as text", "tasks.completeBy as completeBy", "tasks.status as status",
        "tasks.createdAt as createdAt", "tasks.updatedAt as updatedAt",
        "projects.name as projectName",
      ])
      .where("tasks.userId", "=", user.id)
      .where("tasks.deletedAt", "is", null);
    if (input.noteId) taskQuery = taskQuery.where("tasks.noteId", "=", input.noteId);

    const [tasks, projects] = await Promise.all([
      taskQuery.orderBy("tasks.updatedAt", "desc").execute(),
      db.selectFrom("projects").select(["id", "name", "createdAt", "updatedAt"]).where("userId", "=", user.id).orderBy("updatedAt", "desc").execute(),
    ]);
    return new Response(superjson.stringify({ tasks, projects, extraction } satisfies OutputType));
  } catch (error) {
    return endpointError(error);
  }
}
