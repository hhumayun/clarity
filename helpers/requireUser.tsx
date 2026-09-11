import { getServerUserSession } from "./getServerUserSession";
import type { User } from "./User";

/**
 * Resolve the signed-in user for an endpoint, or throw
 * NotAuthenticatedError. Backend only.
 */
export async function requireUser(request: Request): Promise<User> {
  const { user } = await getServerUserSession(request);
  return user;
}
