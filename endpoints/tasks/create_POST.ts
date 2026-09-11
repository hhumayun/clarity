import { randomUUID } from "node:crypto";
import superjson from "superjson";
import { db } from "../../helpers/db";
import { requireUser } from "../../helpers/requireUser";
import { endpointError } from "../../helpers/endpointError";
import { normalizeProjectName } from "../../helpers/normalizeProjectName";
import { schema, type OutputType } from "./create_POST.schema";

/**
 * Manually add a task. Manual tasks carry no sourceFingerprint, so a later
 * "Refresh tasks" on the note can never treat them as duplicates.
 */
export async function handle(request: Request) {
  try {
    const user = await requireUser(request);
    const input = schema.parse(superjson.parse(await request.text()));
    const now = new Date();

    if (input.noteId) {
      const note = await db
        .selectFrom("notes")
        .select("id")
        .where("id", "=", input.noteId)
        .where("userId", "=", user.id)
        .executeTakeFirst();
      if (!note) {
        return new Response(superjson.stringify({ error: "That note could not be found." }), { status: 404 });
      }
    }

    const task = await db.transaction().execute(async (trx) => {
      let projectId = input.projectId;
      if (projectId) {
        const project = await trx
          .selectFrom("projects")
          .select("id")
          .where("id", "=", projectId)
          .where("userId", "=", user.id)
          .executeTakeFirst();
        if (!project) throw new Error("That project could not be found.");
      } else {
        const name = input.projectName!.trim().replace(/\s+/g, " ");
        const project = await trx
          .insertInto("projects")
          .values({
            id: randomUUID(),
            userId: user.id,
            name,
            normalizedName: normalizeProjectName(name),
            updatedAt: now,
          })
          .onConflict((conflict) =>
            conflict.columns(["userId", "normalizedName"]).doUpdateSet({ updatedAt: now }),
          )
          .returning("id")
          .executeTakeFirstOrThrow();
        projectId = project.id;
      }

      const id = randomUUID();
      await trx
        .insertInto("tasks")
        .values({
          id,
          userId: user.id,
          projectId,
          noteId: input.noteId ?? null,
          text: input.text.trim().replace(/\s+/g, " "),
          completeBy: input.completeBy ?? null,
          status: input.status ?? "todo",
          sourceFingerprint: null,
          updatedAt: now,
        })
        .execute();

      return trx
        .selectFrom("tasks")
        .innerJoin("projects", "projects.id", "tasks.projectId")
        .select([
          "tasks.id as id", "tasks.noteId as noteId", "tasks.projectId as projectId", "tasks.text as text",
          "tasks.completeBy as completeBy", "tasks.status as status", "tasks.createdAt as createdAt",
          "tasks.updatedAt as updatedAt", "projects.name as projectName",
        ])
        .where("tasks.id", "=", id)
        .executeTakeFirstOrThrow();
    });

    return new Response(superjson.stringify({ task } satisfies OutputType));
  } catch (error) {
    return endpointError(error);
  }
}
