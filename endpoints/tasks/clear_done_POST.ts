import superjson from "superjson";
import { db } from "../../helpers/db";
import { requireUser } from "../../helpers/requireUser";
import { endpointError } from "../../helpers/endpointError";
import { schema, type OutputType } from "./clear_done_POST.schema";

/** Soft-delete every completed task, optionally within one project. */
export async function handle(request: Request) {
  try {
    const user = await requireUser(request);
    const input = schema.parse(superjson.parse(await request.text()));
    const now = new Date();

    let query = db
      .updateTable("tasks")
      .set({ deletedAt: now, updatedAt: now })
      .where("userId", "=", user.id)
      .where("status", "=", "done")
      .where("deletedAt", "is", null);
    if (input.projectId) query = query.where("projectId", "=", input.projectId);

    const result = await query.executeTakeFirst();
    const cleared = Number(result.numUpdatedRows ?? 0);
    return new Response(superjson.stringify({ cleared } satisfies OutputType));
  } catch (error) {
    return endpointError(error);
  }
}
