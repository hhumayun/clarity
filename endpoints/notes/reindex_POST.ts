import superjson from "superjson";
import { requireUser } from "../../helpers/requireUser";
import { endpointError } from "../../helpers/endpointError";
import {
  noteEntityIndex,
  backfillUserEntities,
} from "../../helpers/noteEntityIndex";
import { schema, type OutputType } from "./reindex_POST.schema";

/**
 * Background entity indexing, driven by the client once typing settles
 * rather than during a save — a save must never wait on a model call, and
 * suggestions must never wait on indexing.
 */
export async function handle(request: Request) {
  try {
    const user = await requireUser(request);
    const input = schema.parse(superjson.parse(await request.text()));

    const indexed = input.noteId
      ? (await noteEntityIndex(input.noteId, user.id))
        ? 1
        : 0
      : await backfillUserEntities(user.id);

    return new Response(superjson.stringify({ indexed } satisfies OutputType));
  } catch (error) {
    return endpointError(error);
  }
}