import superjson from "superjson";
import { requireUser } from "../../helpers/requireUser";
import { endpointError } from "../../helpers/endpointError";
import { parseTaskLine } from "../../helpers/parseTaskLine";
import { schema, type OutputType } from "./parse_POST.schema";

/**
 * Read a due date out of one typed task line. Nothing is written: the client
 * shows what was found and the person decides before the task is created.
 */
export async function handle(request: Request) {
  try {
    await requireUser(request);
    const input = schema.parse(superjson.parse(await request.text()));
    const parsed = await parseTaskLine(input);
    return new Response(superjson.stringify(parsed satisfies OutputType));
  } catch (error) {
    return endpointError(error);
  }
}
