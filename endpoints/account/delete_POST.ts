import superjson from "superjson";
import { createClerkClient } from "@clerk/backend";
import { db } from "../../helpers/db";
import { requireUser } from "../../helpers/requireUser";
import { endpointError } from "../../helpers/endpointError";
import { schema, type OutputType } from "./delete_POST.schema";

const clerk = createClerkClient({
  secretKey: process.env.CLERK_SECRET_KEY,
  publishableKey: process.env.CLERK_PUBLISHABLE_KEY,
});

/**
 * Permanently remove the account and everything attached to it. Projects,
 * tasks, notes, entities, suggestion history and preferences all cascade
 * from the user row; the rows are removed explicitly first so a partial
 * failure can never leave note text behind. The Clerk user is deleted last.
 */
export async function handle(request: Request) {
  try {
    const user = await requireUser(request);
    schema.parse(superjson.parse(await request.text()));

    const clerkId = await db
      .selectFrom("users")
      .select("clerkId")
      .where("id", "=", user.id)
      .executeTakeFirstOrThrow();

    await db.transaction().execute(async (trx) => {
      await trx.deleteFrom("taskExtractions").where("userId", "=", user.id).execute();
      // Also removed by the cascade from tasks; named here so the list of
      // what an account deletion erases stays complete in one place.
      await trx.deleteFrom("focusSessions").where("userId", "=", user.id).execute();
      await trx.deleteFrom("tasks").where("userId", "=", user.id).execute();
      await trx.deleteFrom("projects").where("userId", "=", user.id).execute();
      await trx
        .deleteFrom("noteEntities")
        .where("userId", "=", user.id)
        .execute();
      await trx
        .deleteFrom("suggestionEvents")
        .where("userId", "=", user.id)
        .execute();
      await trx.deleteFrom("noteProjects").where("userId", "=", user.id).execute();
      await trx.deleteFrom("notes").where("userId", "=", user.id).execute();
      await trx
        .deleteFrom("userPreferences")
        .where("userId", "=", user.id)
        .execute();
      await trx.deleteFrom("users").where("id", "=", user.id).execute();
    });

    // Remove the Clerk account too, so the same email can sign up again
    // without resurrecting a deleted profile.
    try {
      await clerk.users.deleteUser(clerkId.clerkId);
    } catch (clerkError) {
      console.error("Clerk user deletion failed:", clerkError);
    }

    return new Response(
      superjson.stringify({ deleted: true } satisfies OutputType),
      { headers: { "Content-Type": "application/json" } },
    );
  } catch (error) {
    return endpointError(error);
  }
}
