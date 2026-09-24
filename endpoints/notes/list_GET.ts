import superjson from "superjson";
import { db } from "../../helpers/db";
import { requireUser } from "../../helpers/requireUser";
import { endpointError } from "../../helpers/endpointError";
import { NOTE_RECORD_COLUMNS } from "../../helpers/NoteRecord";
import { attachProjectIds } from "../../helpers/noteProjects";
import { filterNotes, listNotesPage } from "../../helpers/listNotesPage";
import { schema, type OutputType } from "./list_GET.schema";

export async function handle(request: Request) {
  try {
    const user = await requireUser(request);
    const url = new URL(request.url);
    const input = schema.parse({
      q: url.searchParams.get("q") ?? undefined,
      archived: url.searchParams.get("archived") === "true" ? true : undefined,
      from: url.searchParams.get("from") ?? undefined,
      to: url.searchParams.get("to") ?? undefined,
      limit: url.searchParams.get("limit") ?? undefined,
      cursor: url.searchParams.get("cursor") ?? undefined,
    });

    // Paged: a page of notes, newest written first, and where the next begins.
    if (input.limit) {
      const page = await listNotesPage(db, user.id, { ...input, limit: input.limit });
      return new Response(superjson.stringify(page satisfies OutputType));
    }

    // Unpaged, for callers that do not ask for pages: the newest-edited 200.
    // A date range reaches back past that cap, so the journal can show a
    // week from any time, not just recent ones.
    const rows = await filterNotes(
      db.selectFrom("notes").select([...NOTE_RECORD_COLUMNS]),
      user.id,
      input,
    )
      .orderBy("updatedAt", "desc")
      .limit(200)
      .execute();
    const notes = await attachProjectIds(db, rows, user.id);

    return new Response(superjson.stringify({ notes } satisfies OutputType));
  } catch (error) {
    return endpointError(error);
  }
}
