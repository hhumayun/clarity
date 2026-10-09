import { sql } from "kysely";
import superjson from "superjson";
import { db } from "../../helpers/db";
import { requireUser } from "../../helpers/requireUser";
import { attachmentError, endpointError } from "../../helpers/endpointError";
import { presignUpload, requireBucket, s3Call, storageKeyFor } from "../../helpers/bucket";
import { takeToken } from "../../helpers/rateLimit";
import {
  ACCOUNT_QUOTA_BYTES,
  ATTACHMENT_RECORD_COLUMNS,
  MAX_PENDING_PER_ACCOUNT,
  MAX_PHOTO_BYTES,
  MAX_PHOTOS_PER_ACCOUNT,
  UPLOAD_CALLS_PER_MINUTE,
  toAttachmentRecord,
  type AttachmentRecord,
} from "../../helpers/attachmentLimits";
import { schema, type OutputType } from "./start_POST.schema";

/**
 * Asks to keep a photo and answers a signed upload link for it
 * (docs/photos-server.md, 5.3). Idempotent: the same values again give a
 * fresh link for the same key; a photo already confirmed answers "ready"
 * with no link.
 */
export async function handle(request: Request) {
  try {
    const user = await requireUser(request);
    const input = schema.parse(superjson.parse(await request.text()));
    const b = requireBucket();
    if (input.bytes > MAX_PHOTO_BYTES) throw attachmentError("TOO_LARGE");
    takeToken("upload", user.id, UPLOAD_CALLS_PER_MINUTE);

    const result = await db.transaction().execute(
      async (trx): Promise<{ ready: AttachmentRecord } | { storageKey: string }> => {
        // Serialises starts for one user, so two at once can't both pass the limits.
        await trx.selectFrom("users").select("id").where("id", "=", user.id).forUpdate().executeTakeFirst();

        // Locked, so the sweep (which skips locked rows) can't remove it meanwhile.
        const existing = await trx
          .selectFrom("attachments")
          .select([...ATTACHMENT_RECORD_COLUMNS, "status", "storageKey"])
          .where("userId", "=", user.id)
          .where("id", "=", input.id)
          .forUpdate()
          .executeTakeFirst();

        // A retried upload whose confirm answer was lost.
        if (existing?.status === "ready") return { ready: toAttachmentRecord(existing) };

        // Every link ever signed for a key carries the same size and type, so
        // an old link can't put more bytes under a row than the row counts.
        if (existing && (existing.bytes !== input.bytes || existing.contentType !== input.contentType)) {
          throw attachmentError("UPLOAD_CHANGED");
        }

        const totals = await trx
          .selectFrom("attachments")
          .select([
            sql<string>`count(*)`.as("photos"),
            sql<string>`count(*) filter (where status = 'pending')`.as("pending"),
            sql<string>`coalesce(sum(bytes), 0)::bigint`.as("used"),
          ])
          .where("userId", "=", user.id)
          .where("id", "<>", input.id)
          .executeTakeFirstOrThrow();

        if (!existing && Number(totals.pending) >= MAX_PENDING_PER_ACCOUNT) throw attachmentError("TOO_MANY_PENDING");
        if (!existing && Number(totals.photos) >= MAX_PHOTOS_PER_ACCOUNT) throw attachmentError("PHOTO_LIMIT");
        // Photos deleted in the last 20 minutes still count: an upload link
        // signed for one may still be used (storage_deletions keeps their size).
        const recentlyDeleted = await trx
          .selectFrom("storageDeletions")
          .select(sql<string>`coalesce(sum(bytes), 0)::bigint`.as("bytes"))
          .where("userId", "=", user.id)
          .where("notBefore", ">", sql<Date>`now()`)
          .executeTakeFirstOrThrow();
        if (Number(totals.used) + Number(recentlyDeleted.bytes) + input.bytes > ACCOUNT_QUOTA_BYTES) {
          throw attachmentError("QUOTA_FULL");
        }

        if (!existing) {
          const inserted = await trx
            .insertInto("attachments")
            .values({
              userId: user.id,
              id: input.id,
              contentType: input.contentType,
              bytes: input.bytes,
              width: input.width ?? null,
              height: input.height ?? null,
              storageKey: storageKeyFor(user.id, input.id),
            })
            .returning("storageKey")
            .executeTakeFirstOrThrow();
          return { storageKey: inserted.storageKey };
        }

        // Pending with the same values: a fresh link for the same key, and the
        // upload's 24 hours start again.
        const restarted = await trx
          .updateTable("attachments")
          .set({ uploadStartedAt: sql<Date>`now()` })
          .where("userId", "=", user.id)
          .where("id", "=", input.id)
          .returning("storageKey")
          .executeTakeFirstOrThrow();
        return { storageKey: restarted.storageKey };
      },
    );

    if ("ready" in result) {
      return new Response(superjson.stringify({ status: "ready", attachment: result.ready } satisfies OutputType));
    }
    // Local signing, no network; outside the transaction all the same.
    const upload = await s3Call("presign upload", () =>
      presignUpload(b, result.storageKey, input.bytes, input.contentType),
    );
    return new Response(superjson.stringify({ status: "pending", upload } satisfies OutputType));
  } catch (error) {
    return endpointError(error);
  }
}
