import { db } from "./db";

/**
 * Personalization is opt-out: a user with no preferences row yet is on.
 * Backend only.
 */
export async function isPersonalizationEnabled(userId: number): Promise<boolean> {
  const row = await db
    .selectFrom("userPreferences")
    .select("usePersonalization")
    .where("userId", "=", userId)
    .executeTakeFirst();
  return row?.usePersonalization ?? true;
}