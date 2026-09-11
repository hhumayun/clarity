import superjson from "superjson";
import { db } from "../../helpers/db";
import { requireUser } from "../../helpers/requireUser";
import { endpointError } from "../../helpers/endpointError";
import { NOTE_RECORD_COLUMNS } from "../../helpers/NoteRecord";
import { removeNoteEntities } from "../../helpers/noteEntityIndex";
import { schema, type OutputType } from "./update_POST.schema";

export async function handle(request: Request) {
  try {
    const user = await requireUser(request);
    const input = schema.parse(superjson.parse(await request.text()));

    const values: {
      title?: string;
      content?: string;
      archived?: boolean;
      updatedAt: Date;
    } = { updatedAt: new Date() };
    if (input.title !== undefined) values.title = input.title;
    if (input.content !== undefined) values.content = input.content;
    if (input.archived !== undefined) values.archived = input.archived;

    const note = await db
      .updateTable("notes")
      .set(values)
      .where("id", "=", input.id)
      .where("userId", "=", user.id)
      .returning([...NOTE_RECORD_COLUMNS])
      .executeTakeFirst();

    if (!note) {
      return new Response(
        superjson.stringify({ error: "That note could not be found." }),
        { status: 404, headers: { "Content-Type": "application/json" } },
      );
    }

    // An archived note leaves the entity index, so it stops shaping
    // suggestions; unarchiving lets it be indexed again.
    if (input.archived === true) {
      await removeNoteEntities(note.id);
    }

    return new Response(superjson.stringify({ note } satisfies OutputType));
  } catch (error) {
    return endpointError(error);
  }
}