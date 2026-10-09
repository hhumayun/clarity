import { sql } from "kysely";
import { db } from "./db";
import { bucket, deleteObjects, listPage, s3Call, userPrefix } from "./bucket";

/**
 * How long account deletion waits on deleting photos at once; the queued
 * prefix catches the rest. A hard limit (a stalled bucket call can take 90 s
 * with the SDK's retries), so the answer and the Clerk deletion never wait
 * past a phone's request timeout.
 */
const IMMEDIATE_PHOTO_DELETE_MS = 10_000;

/**
 * Erases every row of an account (docs/photos-server.md, 7.3). The endpoint
 * does the Clerk lookup before and the Clerk deletion after; the checks call
 * this directly for a throwaway local user.
 *
 * Photos first, in the same transaction: every object key and the user's
 * whole prefix are queued in storage_deletions before the photo rows go, so
 * no object is forgotten. After the transaction the prefix is listed and
 * deleted once now (failures are logged and ignored); the queue rows stay,
 * so 20 minutes later, when every upload link another device held has
 * expired, the sweep lists the prefix again. Always succeeds when the rows
 * are gone, whatever the bucket does.
 */
export async function deleteAccountData(userId: number): Promise<void> {
  const prefix = userPrefix(userId);
  await db.transaction().execute(async (trx) => {
    await sql`
      insert into storage_deletions (storage_key)
      select storage_key from attachments where user_id = ${userId}
      on conflict do nothing`.execute(trx);
    await trx
      .insertInto("storageDeletions")
      .values({ storageKey: prefix, isPrefix: true })
      .onConflict((conflict) => conflict.column("storageKey").doNothing())
      .execute();
    await trx.deleteFrom("noteAttachments").where("userId", "=", userId).execute();
    await trx.deleteFrom("attachments").where("userId", "=", userId).execute();

    await trx.deleteFrom("taskExtractions").where("userId", "=", userId).execute();
    // Also removed by the cascade from tasks; named here so the list of
    // what an account deletion erases stays complete in one place.
    await trx.deleteFrom("focusSessions").where("userId", "=", userId).execute();
    await trx.deleteFrom("tasks").where("userId", "=", userId).execute();
    await trx.deleteFrom("projects").where("userId", "=", userId).execute();
    await trx.deleteFrom("noteEntities").where("userId", "=", userId).execute();
    await trx.deleteFrom("suggestionEvents").where("userId", "=", userId).execute();
    await trx.deleteFrom("noteProjects").where("userId", "=", userId).execute();
    await trx.deleteFrom("notes").where("userId", "=", userId).execute();
    await trx.deleteFrom("userPreferences").where("userId", "=", userId).execute();
    await trx.deleteFrom("users").where("id", "=", userId).execute();
  });

  const b = bucket();
  if (!b) return; // photos off: the queue waits until they are on again
  const started = Date.now();
  const immediate = (async () => {
    try {
      while (Date.now() - started < IMMEDIATE_PHOTO_DELETE_MS) {
        const page = await s3Call("list", () => listPage(b, prefix));
        if (page.objects.length === 0) break;
        const failed = await s3Call("delete", () => deleteObjects(b, page.objects.map((o) => o.key)));
        if (failed.length > 0) break;
      }
    } catch {
      // Logged by s3Call (name and status only). The sweep finishes the job.
    }
  })();
  // A call still out when the time is up finishes (or fails) on its own.
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([immediate, new Promise<void>((resolve) => (timer = setTimeout(resolve, IMMEDIATE_PHOTO_DELETE_MS)))]);
  clearTimeout(timer);
}
