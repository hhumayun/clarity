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
    const project = await db
      .insertInto("projects")
      .values({
        id: randomUUID(),
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