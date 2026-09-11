import { randomUUID } from "node:crypto";
import superjson from "superjson";
import { db } from "../../helpers/db";
import { requireUser } from "../../helpers/requireUser";
import { endpointError } from "../../helpers/endpointError";
import { normalizeProjectName } from "../../helpers/normalizeProjectName";
import { taskFingerprint } from "../../helpers/taskFingerprint";
import { schema, type OutputType } from "./add_POST.schema";

/**
 * Add the task suggestions the writer chose from a note. Projects are
 * created on demand; a suggestion already added (same fingerprint) is
 * skipped rather than duplicated.
 */
export async function handle(request: Request) {
  try {
    const user = await requireUser(request);
    const input = schema.parse(superjson.parse(await request.text()));

    const note = await db
      .selectFrom("notes")
      .select("id")
      .where("id", "=", input.noteId)
      .where("userId", "=", user.id)
      .executeTakeFirst();
    if (!note) {
      return new Response(superjson.stringify({ error: "That note could not be found." }), { status: 404 });
    }

    const result = await db.transaction().execute(async (trx) => {
      const existingProjects = await trx
        .selectFrom("projects")
        .select(["id", "name", "normalizedName"])
        .where("userId", "=", user.id)
        .execute();
      const projectByName = new Map(existingProjects.map((p) => [p.normalizedName, p]));

      let added = 0;
      const ids: string[] = [];
      for (const item of input.tasks) {
        const normalizedName = normalizeProjectName(item.projectName);
        let project = projectByName.get(normalizedName);
        if (!project) {
          const now = new Date();
          project = await trx.insertInto("projects").values({
            id: randomUUID(), userId: user.id, name: item.projectName,
            normalizedName, updatedAt: now,
          }).onConflict((conflict) => conflict.columns(["userId", "normalizedName"]).doUpdateSet({ updatedAt: now }))
            .returning(["id", "name", "normalizedName"]).executeTakeFirstOrThrow();
          projectByName.set(normalizedName, project);
        }
        const id = randomUUID();
        const inserted = await trx.insertInto("tasks").values({
          id, userId: user.id, projectId: project.id,
          noteId: input.noteId, text: item.text.trim().replace(/\s+/g, " "),
          completeBy: item.completeBy ?? null,
          status: "todo", sourceFingerprint: taskFingerprint(input.noteId, item.text),
          updatedAt: new Date(),
        }).onConflict((conflict) => conflict.columns(["userId", "noteId", "sourceFingerprint"]).doNothing())
          .returning("id").executeTakeFirst();
        if (inserted) {
          added += 1;
          ids.push(inserted.id);
        }
      }

      const tasks = ids.length
        ? await trx
            .selectFrom("tasks")
            .innerJoin("projects", "projects.id", "tasks.projectId")
            .select([
              "tasks.id as id", "tasks.noteId as noteId", "tasks.projectId as projectId", "tasks.text as text",
              "tasks.completeBy as completeBy", "tasks.status as status", "tasks.createdAt as createdAt",
              "tasks.updatedAt as updatedAt", "projects.name as projectName",
            ])
            .where("tasks.id", "in", ids)
            .execute()
        : [];
      return { added, tasks };
    });

    return new Response(superjson.stringify(result satisfies OutputType));
  } catch (error) {
    return endpointError(error);
  }
}
