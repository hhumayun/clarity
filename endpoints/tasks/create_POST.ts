import { randomUUID } from "node:crypto";
import superjson from "superjson";
import { db } from "../../helpers/db";
import { linkNoteTask, selectTaskRecords } from "../../helpers/taskRecords";
import { notInFuture } from "../../helpers/clientIds";
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

    if (input.id) {
      // Sent before (a retry after a lost answer): the same task, if it is
      // this person's.
      const existing = await db.selectFrom("tasks").select(["userId"]).where("id", "=", input.id).executeTakeFirst();
      if (existing) {
        const task =
          existing.userId === user.id
            ? await selectTaskRecords(db, user.id).where("tasks.id", "=", input.id).executeTakeFirst()
            : undefined;
        if (!task) return new Response(superjson.stringify({ error: "That task could not be found." }), { status: 404 });
        return new Response(superjson.stringify({ task } satisfies OutputType));
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

      const id = input.id ?? randomUUID();
      const at = notInFuture(input.createdAt, now);
      await trx
        .insertInto("tasks")
        .values({
          id,
          createdAt: at,
          userId: user.id,
          projectId,
          noteId: input.noteId ?? null,
          text: input.text.trim().replace(/\s+/g, " "),
          description: input.description?.trim() ?? "",
          completeBy: input.completeBy ?? null,
          status: input.status ?? "todo",
          sourceFingerprint: null,
          updatedAt: now,
        })
        .execute();
      if (input.noteId) await linkNoteTask(trx, { noteId: input.noteId, taskId: id, userId: user.id });

      return selectTaskRecords(trx, user.id)
        .where("tasks.id", "=", id)
        .executeTakeFirstOrThrow();
    });

    return new Response(superjson.stringify({ task } satisfies OutputType));
  } catch (error) {
    return endpointError(error);
  }
}
