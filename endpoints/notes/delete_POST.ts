import superjson from "superjson";
import { db } from "../../helpers/db";
import { requireUser } from "../../helpers/requireUser";
import { endpointError } from "../../helpers/endpointError";
import { linkedPhotos, markOrphansIfUnused } from "../../helpers/noteAttachments";
import { schema, type OutputType } from "./delete_POST.schema";

export async function handle(request: Request) {
  try {
    const user = await requireUser(request);
    const input = schema.parse(superjson.parse(await request.text()));

    // note_entities and note_attachments cascade from the note row;
    // suggestion_events keep their phrases but lose the note reference. The
    // photos only this note named are marked as orphans in the same
    // transaction, and the sweep deletes them 7 days later.
    const deleted = await db.transaction().execute(async (trx) => {
      // The note's row lock first, so a save finishing meanwhile can't change
      // the links between reading them and the delete.
      const locked = await trx
        .selectFrom("notes")
        .select("id")
        .where("id", "=", input.id)
        .where("userId", "=", user.id)
        .forUpdate()
        .executeTakeFirst();
      if (!locked) return false;
      const photoIds = await linkedPhotos(trx, user.id, input.id);
      const result = await trx
        .deleteFrom("notes")
        .where("id", "=", input.id)
        .where("userId", "=", user.id)
        .executeTakeFirst();
      if (Number(result.numDeletedRows ?? 0) === 0) return false;
      await markOrphansIfUnused(trx, user.id, photoIds);
      return true;
    });

    if (!deleted) {
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