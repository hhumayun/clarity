import superjson from "superjson";
import { requireUser } from "../../helpers/requireUser";
import { endpointError } from "../../helpers/endpointError";
import { suggestNoteTitle } from "../../helpers/suggestNoteTitle";
import { schema, type OutputType } from "./suggest_title_POST.schema";

/**
 * Suggest a title for a note the writer has not titled. Nothing is saved
 * here: the editor offers it, or applies it when they leave. A model failure
 * returns no title rather than an error, since an untitled note is fine.
 */
export async function handle(request: Request) {
  try {
    await requireUser(request);
    const input = schema.parse(superjson.parse(await request.text()));
    let title: string | null = null;
    try {
      title = await suggestNoteTitle(input.content);
    } catch (error) {
      console.warn("title suggestion failed", error instanceof Error ? error.message : error);
    }
    return new Response(superjson.stringify({ title } satisfies OutputType));
  } catch (error) {
    return endpointError(error);
  }
}
