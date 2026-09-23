import superjson from "superjson";
import { db } from "../../helpers/db";
import { requireUser } from "../../helpers/requireUser";
import { endpointError } from "../../helpers/endpointError";
import { NOTE_RECORD_COLUMNS } from "../../helpers/NoteRecord";
import { attachProjectIds } from "../../helpers/noteProjects";
import { schema, type OutputType } from "./get_GET.schema";

export async function handle(request: Request) {
  try {
    const user = await requireUser(request);
    const url = new URL(request.url);
    const input = schema.parse({ id: url.searchParams.get("id") ?? "" });

    const row = await db
      .selectFrom("notes")
      .select([...NOTE_RECORD_COLUMNS])
      .where("id", "=", input.id)
      .where("userId", "=", user.id)
      .executeTakeFirst();

    if (!row) {
      return new Response(
        superjson.stringify({ error: "That note could not be found." }),
        { status: 404, headers: { "Content-Type": "application/json" } },
      );
    }

    const [note] = await attachProjectIds(db, [row], user.id);
    return new Response(superjson.stringify({ note } satisfies OutputType));
  } catch (error) {
    return endpointError(error);
  }
}