import superjson from "superjson";
import { db } from "../../helpers/db";
import { requireUser } from "../../helpers/requireUser";
import { endpointError } from "../../helpers/endpointError";
import { dismissSuggestion } from "../../helpers/taskSuggestions";
import { schema, type OutputType } from "./dismiss_suggestion_POST.schema";

/**
 * "Not now" on a Find tasks suggestion: it stops being offered for this
 * note, now and after the note changes. Saying it twice is harmless, so a
 * change replayed from the phone's queue does no harm.
 */
export async function handle(request: Request) {
  try {
    const user = await requireUser(request);
    const input = schema.parse(superjson.parse(await request.text()));
    const note = await db.selectFrom("notes").select("id").where("id", "=", input.noteId).where("userId", "=", user.id).executeTakeFirst();
    if (!note) return new Response(superjson.stringify({ error: "That note could not be found." }), { status: 404 });
    await dismissSuggestion(db, input.noteId, user.id, input.text);
    return new Response(superjson.stringify({ dismissed: true } satisfies OutputType));
  } catch (error) {
    return endpointError(error);
  }
}
