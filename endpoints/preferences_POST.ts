import superjson from "superjson";
import { db } from "../helpers/db";
import { requireUser } from "../helpers/requireUser";
import { endpointError } from "../helpers/endpointError";
import { schema, type OutputType } from "./preferences_POST.schema";

export async function handle(request: Request) {
  try {
    const user = await requireUser(request);
    const input = schema.parse(superjson.parse(await request.text()));

    await db
      .insertInto("userPreferences")
      .values({
        userId: user.id,
        usePersonalization: input.usePersonalization,
        updatedAt: new Date(),
      })
      .onConflict((oc) =>
        oc.column("userId").doUpdateSet({
          usePersonalization: input.usePersonalization,
          updatedAt: new Date(),
        }),
      )
      .execute();

    return new Response(
      superjson.stringify({
        usePersonalization: input.usePersonalization,
      } satisfies OutputType),
    );
  } catch (error) {
    return endpointError(error);
  }
}