import superjson from "superjson";
import { db } from "../../helpers/db";
import { requireUser } from "../../helpers/requireUser";
import { endpointError } from "../../helpers/endpointError";
import { NOTE_RECORD_COLUMNS } from "../../helpers/NoteRecord";
import { schema, type OutputType } from "./create_POST.schema";

export async function handle(request: Request) {
  try {
    const user = await requireUser(request);
    const input = schema.parse(superjson.parse(await request.text()));

    const note = await db
      .insertInto("notes")
      .values({
        userId: user.id,
        title: input.title,
        content: input.content,
      })
      .returning([...NOTE_RECORD_COLUMNS])
      .executeTakeFirstOrThrow();

    return new Response(superjson.stringify({ note } satisfies OutputType));
  } catch (error) {
    return endpointError(error);
  }
}