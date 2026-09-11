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
    const values: { text?: string; projectId?: string; completeBy?: Date | null; status?: typeof input.status; updatedAt: Date } = { updatedAt: new Date() };
    if (input.text !== undefined) values.text = input.text.trim();
    if (input.projectId !== undefined) values.projectId = input.projectId;
    if (input.completeBy !== undefined) values.completeBy = input.completeBy;
    if (input.status !== undefined) values.status = input.status;
    const updated = await db.updateTable("tasks").set(values).where("id", "=", input.id).where("userId", "=", user.id).where("deletedAt", "is", null).returning("id").executeTakeFirst();
    if (!updated) return new Response(superjson.stringify({ error: "That task could not be found." }), { status: 404 });
    const task = await db.selectFrom("tasks").innerJoin("projects", "projects.id", "tasks.projectId").select([
      "tasks.id as id", "tasks.noteId as noteId", "tasks.projectId as projectId", "tasks.text as text",
      "tasks.completeBy as completeBy", "tasks.status as status", "tasks.createdAt as createdAt",
      "tasks.updatedAt as updatedAt", "projects.name as projectName",
    ]).where("tasks.id", "=", input.id).where("tasks.userId", "=", user.id).where("tasks.deletedAt", "is", null).executeTakeFirstOrThrow();
    return new Response(superjson.stringify({ task } satisfies OutputType));
  } catch (error) {
    return endpointError(error);
  }
}
