import { sql } from "kysely";
import superjson from "superjson";
import { db } from "../../helpers/db";
import { requireUser } from "../../helpers/requireUser";
import { attachmentError, endpointError } from "../../helpers/endpointError";
import { bucket, deleteObjects, s3Call } from "../../helpers/bucket";
import { takeToken } from "../../helpers/rateLimit";
import { UPLOAD_CALLS_PER_MINUTE } from "../../helpers/attachmentLimits";
import { schema, type OutputType } from "./delete_POST.schema";

/**
 * Deletes a photo no note names: an upload the client gives up on
 * (docs/photos-server.md, 5.6). Photos taken out of notes are left to the
 * sweep, after their grace period. Idempotent, and works with photos off.
 */
export async function handle(request: Request) {
  try {
    const user = await requireUser(request);
    const input = schema.parse(superjson.parse(await request.text()));
    takeToken("delete", user.id, UPLOAD_CALLS_PER_MINUTE);

    const key = await db.transaction().execute(async (trx) => {
      const row = await trx
        .selectFrom("attachments")
        .select(["storageKey", "status", "bytes"])
        .where("userId", "=", user.id)
        .where("id", "=", input.id)
        .forUpdate()
        .executeTakeFirst();
      if (!row) return null;

      // A ready photo a link names, or a note's own text does (links can
      // drift while older code runs), stays. A pending one always goes: no
      // object of it was ever confirmed, notes name a photo before its
      // upload ends, and its id can start afresh with a new key. Ids hold no
      // % or _, so they are safe in LIKE.
      if (row.status === "ready") {
        const pattern = `%attachment:${input.id}%`;
        const { rows } = await sql<{ inUse: boolean }>`
          select exists (
            select 1 from note_attachments
            where user_id = ${user.id} and attachment_id = ${input.id}
          ) or exists (
            select 1 from notes
            where user_id = ${user.id}
              and (content like ${pattern} or doc::text like ${pattern})
          ) as in_use`.execute(trx);
        if (rows[0]?.inUse) throw attachmentError("IN_USE");
      }

      await trx.deleteFrom("attachments").where("userId", "=", user.id).where("id", "=", input.id).execute();
      // Queued in the same transaction, so the object is never forgotten.
      // not_before defaults to 20 minutes ahead: after every upload link for
      // this key has expired, the drain deletes it again. Its owner and size
      // go with it: `start` counts them toward the account's space until
      // then, so an old link can't store bytes outside the quota.
      await trx
        .insertInto("storageDeletions")
        .values({ storageKey: row.storageKey, userId: user.id, bytes: row.bytes })
        .onConflict((conflict) => conflict.column("storageKey").doNothing())
        .execute();
      return row.storageKey;
    });

    // Try once now; the queue row stays either way.
    const b = bucket();
    if (key && b) await s3Call("delete", () => deleteObjects(b, [key])).catch(() => undefined);

    return new Response(superjson.stringify({ deleted: true } satisfies OutputType));
  } catch (error) {
    return endpointError(error);
  }
}
