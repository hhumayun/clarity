import superjson from "superjson";
import { db } from "../../helpers/db";
import { requireUser } from "../../helpers/requireUser";
import { endpointError } from "../../helpers/endpointError";
import { schema, type OutputType } from "./event_POST.schema";

/**
 * Interaction history for adaptive suggestions. Only the short suggestion
 * phrase is stored — never note text.
 */
export async function handle(request: Request) {
  try {
    const user = await requireUser(request);
    const input = schema.parse(superjson.parse(await request.text()));

    // A note the user deleted mid-session must not fail the write.
    let noteId: string | null = null;
    if (input.noteId) {
      const note = await db
        .selectFrom("notes")
        .select("id")
        .where("id", "=", input.noteId)
        .where("userId", "=", user.id)
        .executeTakeFirst();
      noteId = note?.id ?? null;
    }

    await db
      .insertInto("suggestionEvents")
      .values({
        userId: user.id,
        noteId,
        suggestionText: input.suggestionText,
        source: input.source,
        action: input.action,
        responseMs: input.responseMs ?? null,
      })
      .execute();

    return new Response(
      superjson.stringify({ recorded: true } satisfies OutputType),
    );
  } catch (error) {
    return endpointError(error);
  }
}