import superjson from "superjson";
import { db } from "../../helpers/db";
import { requireUser } from "../../helpers/requireUser";
import { endpointError } from "../../helpers/endpointError";
import { type OutputType } from "./clear_personalization_POST.schema";

/**
 * Forget what the app learned: the accepted/dismissed history and the whole
 * entity index, including the per-note markers so kept notes are indexed
 * again from scratch. Notes themselves are untouched.
 */
export async function handle(request: Request) {
  try {
    const user = await requireUser(request);

    await db.transaction().execute(async (trx) => {
      await trx
        .deleteFrom("suggestionEvents")
        .where("userId", "=", user.id)
        .execute();
      await trx
        .deleteFrom("noteEntities")
        .where("userId", "=", user.id)
        .execute();
      await trx
        .updateTable("notes")
        .set({ entitiesHash: null })
        .where("userId", "=", user.id)
        .execute();
    });

    return new Response(
      superjson.stringify({ cleared: true } satisfies OutputType),
    );
  } catch (error) {
    return endpointError(error);
  }
}