import superjson from "superjson";
import { db } from "../../helpers/db";
import { requireUser } from "../../helpers/requireUser";
import { endpointError } from "../../helpers/endpointError";
import { schema, type OutputType } from "./update_POST.schema";

export async function handle(request: Request) {
  try {
    const user = await requireUser(request);
    const input = schema.parse(superjson.parse(await request.text()));
    if (input.projectId) {
      const project = await db.selectFrom("projects").select("id").where("id", "=", input.projectId).where("userId", "=", user.id).executeTakeFirst();
      if (!project) return new Response(superjson.stringify({ error: "That project could not be found." }), { status: 404 });
    }
    if (input.noteId) {
      const note = await db.selectFrom("notes").select("id").where("id", "=", input.noteId).where("userId", "=", user.id).executeTakeFirst();
      if (!note) return new Response(superjson.stringify({ error: "That note could not be found." }), { status: 404 });
    }
    const values: { text?: string; description?: string; projectId?: string; completeBy?: Date | null; status?: typeof input.status; noteId?: string | null; updatedAt: Date } = { updatedAt: new Date() };
    if (input.text !== undefined) values.text = input.text.trim();
    if (input.description !== undefined) values.description = input.description.trim();
    if (input.projectId !== undefined) values.projectId = input.projectId;
    if (input.completeBy !== undefined) values.completeBy = input.completeBy;
    if (input.status !== undefined) values.status = input.status;
    // Linking an existing task to a note moves it there from any other note.
    if (input.noteId !== undefined) values.noteId = input.noteId;
    const updated = await db.updateTable("tasks").set(values).where("id", "=", input.id).where("userId", "=", user.id).where("deletedAt", "is", null).returning("id").executeTakeFirst();
    if (!updated) return new Response(superjson.stringify({ error: "That task could not be found." }), { status: 404 });
    const task = await db.selectFrom("tasks").innerJoin("projects", "projects.id", "tasks.projectId").select([
      "tasks.id as id", "tasks.noteId as noteId", "tasks.projectId as projectId", "tasks.text as text", "tasks.description as description",
      "tasks.completeBy as completeBy", "tasks.status as status", "tasks.createdAt as createdAt",
      "tasks.updatedAt as updatedAt", "projects.name as projectName",
    ]).where("tasks.id", "=", input.id).where("tasks.userId", "=", user.id).where("tasks.deletedAt", "is", null).executeTakeFirstOrThrow();
    return new Response(superjson.stringify({ task } satisfies OutputType));
  } catch (error) {
    // A task found in a note carries that note's fingerprint; one note can
    // hold each fingerprint once.
    if ((error as { code?: string } | null)?.code === "23505") {
      return new Response(superjson.stringify({ error: "That task is already in this note." }), { status: 409 });
    }
    return endpointError(error);
  }
}
