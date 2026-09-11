import superjson from "superjson";
import { db } from "../../helpers/db";
import { requireUser } from "../../helpers/requireUser";
import { endpointError } from "../../helpers/endpointError";
import { schema, type OutputType } from "./delete_POST.schema";

export async function handle(request: Request) {
  try {
    const user = await requireUser(request);
    const input = schema.parse(superjson.parse(await request.text()));
    const result = await db.updateTable("tasks").set({ deletedAt: new Date(), updatedAt: new Date() }).where("id", "=", input.id).where("userId", "=", user.id).where("deletedAt", "is", null).executeTakeFirst();
    if (Number(result.numUpdatedRows ?? 0) === 0) return new Response(superjson.stringify({ error: "That task could not be found." }), { status: 404 });
    return new Response(superjson.stringify({ deleted: true } satisfies OutputType));
  } catch (error) {
    return endpointError(error);
  }
}