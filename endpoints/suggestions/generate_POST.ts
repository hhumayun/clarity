import superjson from "superjson";
import { requireUser } from "../../helpers/requireUser";
import { endpointError } from "../../helpers/endpointError";
import { generateSuggestions } from "../../helpers/generateSuggestions";
import { schema, type OutputType } from "./generate_POST.schema";

export async function handle(request: Request) {
  try {
    const user = await requireUser(request);
    const input = schema.parse(superjson.parse(await request.text()));

    const timings: { context?: number; model?: number } = {};
    const result = await generateSuggestions({
      userId: user.id,
      noteId: input.noteId,
      title: input.title,
      textBeforeCursor: input.textBeforeCursor,
      mode: input.mode,
      timings,
    });

    // How long the writer's context and the model took: word help is typed against, so it's watched.
    const serverTiming = Object.entries(timings)
      .map(([name, ms]) => `${name};dur=${ms}`)
      .join(", ");
    return new Response(superjson.stringify(result satisfies OutputType), {
      headers: serverTiming ? { "Server-Timing": serverTiming } : undefined,
    });
  } catch (error) {
    return endpointError(error);
  }
}