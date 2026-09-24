import superjson from "superjson";
import { db } from "../../helpers/db";
import { requireUser } from "../../helpers/requireUser";
import { endpointError } from "../../helpers/endpointError";
import type { OutputType } from "./counts_GET.schema";

/** Counts for the notes list, so it need not load every note to show one. */
export async function handle(request: Request) {
  try {
    const user = await requireUser(request);
    const row = await db
      .selectFrom("notes")
      .select((eb) => eb.fn.countAll<string>().as("archived"))
      .where("userId", "=", user.id)
      .where("archived", "=", true)
      .executeTakeFirstOrThrow();
    return new Response(superjson.stringify({ archived: Number(row.archived) } satisfies OutputType));
  } catch (error) {
    return endpointError(error);
  }
}
