import { createClerkClient } from "@clerk/backend";
import { db } from "./db";
import { User } from "./User";

export class NotAuthenticatedError extends Error {
  constructor(message?: string) {
    super(message ?? "Not authenticated");
    this.name = "NotAuthenticatedError";
  }
}

const clerk = createClerkClient({
  secretKey: process.env.CLERK_SECRET_KEY,
  publishableKey: process.env.CLERK_PUBLISHABLE_KEY,
});

/**
 * Verify the Clerk session on the incoming request (Authorization: Bearer
 * token or __session cookie) and resolve it to the internal user row,
 * creating that row the first time a Clerk user signs in.
 */
export async function getServerUserSession(request: Request) {
  const requestState = await clerk.authenticateRequest(request);

  if (!requestState.isSignedIn) {
    throw new NotAuthenticatedError();
  }

  const { userId: clerkId } = requestState.toAuth();
  if (!clerkId) {
    throw new NotAuthenticatedError();
  }

  const existing = await db
    .selectFrom("users")
    .select(["id", "email", "displayName", "avatarUrl", "role"])
    .where("clerkId", "=", clerkId)
    .limit(1)
    .execute();

  if (existing.length > 0) {
    return { user: existing[0] satisfies User };
  }

  // First sign-in: create the internal user from the Clerk profile.
  const clerkUser = await clerk.users.getUser(clerkId);
  const email =
    clerkUser.emailAddresses.find(
      (e) => e.id === clerkUser.primaryEmailAddressId,
    )?.emailAddress ?? clerkUser.emailAddresses[0]?.emailAddress;
  if (!email) {
    throw new NotAuthenticatedError("Clerk user has no email address");
  }
  const displayName =
    [clerkUser.firstName, clerkUser.lastName].filter(Boolean).join(" ").trim() ||
    email.split("@")[0];

  const inserted = await db
    .insertInto("users")
    .values({
      clerkId,
      email,
      displayName,
      avatarUrl: clerkUser.imageUrl ?? null,
    })
    .onConflict((oc) => oc.column("clerkId").doNothing())
    .returning(["id", "email", "displayName", "avatarUrl", "role"])
    .execute();

  const row =
    inserted[0] ??
    (await db
      .selectFrom("users")
      .select(["id", "email", "displayName", "avatarUrl", "role"])
      .where("clerkId", "=", clerkId)
      .executeTakeFirstOrThrow());

  return { user: row satisfies User };
}
