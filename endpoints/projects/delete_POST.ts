import superjson from "superjson";
import { db } from "../../helpers/db";
import { requireUser } from "../../helpers/requireUser";
import { endpointError } from "../../helpers/endpointError";
import { schema, type OutputType } from "./delete_POST.schema";

/**
 * Delete a project. Its tasks are either moved to another project or, when
 * no destination is given, soft-deleted so nothing is lost silently.
 */
export async function handle(request: Request) {
  try {
    const user = await requireUser(request);
    const input = schema.parse(superjson.parse(await request.text()));
    if (input.moveTasksTo === input.id) {
      return new Response(superjson.stringify({ error: "Choose a different project to move tasks to." }), { status: 400 });
    }

    const result = await db.transaction().execute(async (trx) => {
      const project = await trx
        .selectFrom("projects")
        .select("id")
        .where("id", "=", input.id)
        .where("userId", "=", user.id)
        .executeTakeFirst();
      if (!project) return null;

      const now = new Date();
      let movedTasks = 0;
      let removedTasks = 0;

      // Count only the tasks the user can actually see; soft-deleted rows
      // travel along silently so nothing is orphaned.
      const visible = await trx
        .selectFrom("tasks")
        .select((eb) => eb.fn.countAll<string>().as("count"))
        .where("projectId", "=", input.id)
        .where("userId", "=", user.id)
        .where("deletedAt", "is", null)
        .executeTakeFirstOrThrow();
      const visibleCount = Number(visible.count);

      if (input.moveTasksTo) {
        const target = await trx
          .selectFrom("projects")
          .select("id")
          .where("id", "=", input.moveTasksTo)
          .where("userId", "=", user.id)
          .executeTakeFirst();
        if (!target) throw new Error("That project could not be found.");
        await trx
          .updateTable("tasks")
          .set({ projectId: input.moveTasksTo, updatedAt: now })
          .where("projectId", "=", input.id)
          .where("userId", "=", user.id)
          .execute();
        movedTasks = visibleCount;
      } else {
        // Tasks reference the project with ON DELETE CASCADE; remove them
        // explicitly so nothing lingers.
        await trx
          .deleteFrom("tasks")
          .where("projectId", "=", input.id)
          .where("userId", "=", user.id)
          .execute();
        removedTasks = visibleCount;
      }

      await trx.deleteFrom("projects").where("id", "=", input.id).where("userId", "=", user.id).execute();
      return { movedTasks, removedTasks };
    });

    if (!result) {
      return new Response(superjson.stringify({ error: "That project could not be found." }), { status: 404 });
    }
    return new Response(
      superjson.stringify({ deleted: true, ...result } satisfies OutputType),
    );
  } catch (error) {
    return endpointError(error);
  }
}
