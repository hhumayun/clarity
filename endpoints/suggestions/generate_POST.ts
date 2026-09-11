import superjson from "superjson";
import { requireUser } from "../../helpers/requireUser";
import { endpointError } from "../../helpers/endpointError";
import { generateSuggestions } from "../../helpers/generateSuggestions";
import { schema, type OutputType } from "./generate_POST.schema";

export async function handle(request: Request) {
  try {
    const user = await requireUser(request);
    const input = schema.parse(superjson.parse(await request.text()));

    const result = await generateSuggestions({
      userId: user.id,
      noteId: input.noteId,
      title: input.title,
      textBeforeCursor: input.textBeforeCursor,
    });

    return new Response(superjson.stringify(result satisfies OutputType));
  } catch (error) {
    return endpointError(error);
  }
}