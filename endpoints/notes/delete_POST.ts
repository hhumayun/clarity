import superjson from "superjson";
import { db } from "../../helpers/db";
import { requireUser } from "../../helpers/requireUser";
import { endpointError } from "../../helpers/endpointError";
import { schema, type OutputType } from "./delete_POST.schema";

export async function handle(request: Request) {
  try {
    const user = await requireUser(request);
    const input = schema.parse(superjson.parse(await request.text()));

    // note_entities cascades from the note row; suggestion_events keep their
    // phrases but lose the note reference.
    const result = await db
      .deleteFrom("notes")
      .where("id", "=", input.id)
      .where("userId", "=", user.id)
      .executeTakeFirst();

    if (Number(result.numDeletedRows ?? 0) === 0) {
      return new Response(
        superjson.stringify({ error: "That note could not be found." }),
        { status: 404, headers: { "Content-Type": "application/json" } },
      );
    }

    return new Response(
      superjson.stringify({ deleted: true } satisfies OutputType),
    );
  } catch (error) {
    return endpointError(error);
  }
}