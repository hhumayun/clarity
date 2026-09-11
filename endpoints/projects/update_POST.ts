import superjson from "superjson";
import { db } from "../../helpers/db";
import { requireUser } from "../../helpers/requireUser";
import { endpointError } from "../../helpers/endpointError";
import { normalizeProjectName } from "../../helpers/normalizeProjectName";
import { schema, type OutputType } from "./update_POST.schema";

/** Rename a project. Names are unique per user (case-insensitive). */
export async function handle(request: Request) {
  try {
    const user = await requireUser(request);
    const input = schema.parse(superjson.parse(await request.text()));
    const name = input.name.trim().replace(/\s+/g, " ");
    const normalizedName = normalizeProjectName(name);

    const clash = await db
      .selectFrom("projects")
      .select("id")
      .where("userId", "=", user.id)
      .where("normalizedName", "=", normalizedName)
      .where("id", "!=", input.id)
      .executeTakeFirst();
    if (clash) {
      return new Response(
        superjson.stringify({ error: "You already have a project with that name." }),
        { status: 409 },
      );
    }

    const project = await db
      .updateTable("projects")
      .set({ name, normalizedName, updatedAt: new Date() })
      .where("id", "=", input.id)
      .where("userId", "=", user.id)
      .returning(["id", "name", "createdAt", "updatedAt"])
      .executeTakeFirst();
    if (!project) {
      return new Response(superjson.stringify({ error: "That project could not be found." }), { status: 404 });
    }
    return new Response(superjson.stringify({ project } satisfies OutputType));
  } catch (error) {
    return endpointError(error);
  }
}
