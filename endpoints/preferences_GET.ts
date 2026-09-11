import superjson from "superjson";
import { requireUser } from "../helpers/requireUser";
import { endpointError } from "../helpers/endpointError";
import { isPersonalizationEnabled } from "../helpers/isPersonalizationEnabled";
import type { OutputType } from "./preferences_GET.schema";

export async function handle(request: Request) {
  try {
    const user = await requireUser(request);
    const usePersonalization = await isPersonalizationEnabled(user.id);
    return new Response(
      superjson.stringify({ usePersonalization } satisfies OutputType),
    );
  } catch (error) {
    return endpointError(error);
  }
}