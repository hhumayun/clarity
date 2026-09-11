import superjson from "superjson";
import { db } from "../../helpers/db";
import { requireUser } from "../../helpers/requireUser";
import { endpointError } from "../../helpers/endpointError";
import { NOTE_RECORD_COLUMNS } from "../../helpers/NoteRecord";
import { schema, type OutputType } from "./list_GET.schema";

export async function handle(request: Request) {
  try {
    const user = await requireUser(request);
    const url = new URL(request.url);
    const input = schema.parse({
      q: url.searchParams.get("q") ?? undefined,
      archived: url.searchParams.get("archived") === "true" ? true : undefined,
    });

    let query = db
      .selectFrom("notes")
      .select([...NOTE_RECORD_COLUMNS])
      .where("userId", "=", user.id)
      .where("archived", "=", input.archived === true);

    const term = input.q?.trim();
    if (term) {
      const pattern = `%${term.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
      query = query.where((eb) =>
        eb.or([eb("title", "ilike", pattern), eb("content", "ilike", pattern)]),
      );
    }

    const notes = await query.orderBy("updatedAt", "desc").limit(200).execute();

    return new Response(superjson.stringify({ notes } satisfies OutputType));
  } catch (error) {
    return endpointError(error);
  }
}