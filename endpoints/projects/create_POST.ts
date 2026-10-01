import { randomUUID } from "node:crypto";
import superjson from "superjson";
import { db } from "../../helpers/db";
import { requireUser } from "../../helpers/requireUser";
import { endpointError } from "../../helpers/endpointError";
import { normalizeProjectName } from "../../helpers/normalizeProjectName";
import { schema, type OutputType } from "./create_POST.schema";

export async function handle(request: Request) {
  try {
    const user = await requireUser(request);
    const input = schema.parse(superjson.parse(await request.text()));
    const name = input.name.trim().replace(/\s+/g, " ");
    const now = new Date();
    if (input.id) {
      // Sent before: the same project, if it is this person's.
      const existing = await db.selectFrom("projects").select(["id", "name", "createdAt", "updatedAt", "userId"]).where("id", "=", input.id).executeTakeFirst();
      if (existing) {
        if (existing.userId !== user.id) {
          return new Response(superjson.stringify({ error: "That project could not be found." }), { status: 404 });
        }
        const { userId: _owner, ...project } = existing;
        return new Response(superjson.stringify({ project } satisfies OutputType));
      }
    }
    const project = await db
      .insertInto("projects")
      .values({
        id: input.id ?? randomUUID(),
        userId: user.id,
        name,
        normalizedName: normalizeProjectName(name),
        updatedAt: now,
      })
      .onConflict((conflict) =>
        conflict.columns(["userId", "normalizedName"]).doUpdateSet({
          name,
          updatedAt: now,
        }),
      )
      .returning(["id", "name", "createdAt", "updatedAt"])
      .executeTakeFirstOrThrow();
    return new Response(superjson.stringify({ project } satisfies OutputType));
  } catch (error) {
    return endpointError(error);
  }
}