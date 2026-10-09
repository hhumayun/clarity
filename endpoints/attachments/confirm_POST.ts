import { sql } from "kysely";
import superjson from "superjson";
import { db } from "../../helpers/db";
import { requireUser } from "../../helpers/requireUser";
import { attachmentError, endpointError } from "../../helpers/endpointError";
import { deleteObjects, headObject, requireBucket, s3Call } from "../../helpers/bucket";
import { takeToken } from "../../helpers/rateLimit";
import {
  ATTACHMENT_RECORD_COLUMNS,
  UPLOAD_CALLS_PER_MINUTE,
  toAttachmentRecord,
} from "../../helpers/attachmentLimits";
import { schema, type OutputType } from "./confirm_POST.schema";

/** "image/jpeg; charset=…" and "IMAGE/JPEG" are both image/jpeg. */
const baseType = (type: string | null) => (type ?? "").split(";")[0].trim().toLowerCase();

/**
 * Says an upload has landed: checks the object's size and type against the
 * row and marks the photo ready (docs/photos-server.md, 5.4). Idempotent.
 */
export async function handle(request: Request) {
  try {
    const user = await requireUser(request);
    const input = schema.parse(superjson.parse(await request.text()));
    const b = requireBucket();
    takeToken("upload", user.id, UPLOAD_CALLS_PER_MINUTE);

    const readRow = () =>
      db
        .selectFrom("attachments")
        .select([...ATTACHMENT_RECORD_COLUMNS, "status", "storageKey"])
        .where("userId", "=", user.id)
        .where("id", "=", input.id)
        .executeTakeFirst();
    const answer = (row: Parameters<typeof toAttachmentRecord>[0]) =>
      new Response(superjson.stringify({ attachment: toAttachmentRecord(row) } satisfies OutputType));

    const row = await readRow();
    if (!row) throw attachmentError("NOT_FOUND");
    if (row.status === "ready") return answer(row);
    const key = row.storageKey;

    // Also the answer while the bucket hasn't caught up yet: the client retries.
    const head = await s3Call("head", () => headObject(b, key));
    if (!head) throw attachmentError("NOT_UPLOADED");

    if (head.bytes !== row.bytes || baseType(head.contentType) !== row.contentType) {
      // With both headers signed this should never happen; it guards against a
      // store that doesn't enforce them. A failed delete is left to the sweep:
      // the row stays pending and its expiry queues the key.
      await s3Call("delete", () => deleteObjects(b, [key])).catch(() => undefined);
      throw attachmentError("UPLOAD_MISMATCH");
    }

    // One statement, no lock held across the HEAD. Only the row this HEAD was
    // for: if it was swept, or remade with a new key meanwhile, nothing changes.
    const confirmed = await db
      .updateTable("attachments")
      .set({
        status: "ready",
        confirmedAt: sql<Date>`now()`,
        // A photo no note names yet (its note save is still on the way)
        // starts its 7 days now; the next save that names it clears the mark.
        orphanedSince: sql<Date | null>`case when exists (
          select 1 from note_attachments
          where note_attachments.user_id = ${user.id} and note_attachments.attachment_id = ${input.id}
        ) then null else now() end`,
      })
      .where("userId", "=", user.id)
      .where("id", "=", input.id)
      .where("status", "=", "pending")
      .where("storageKey", "=", key)
      .returning([...ATTACHMENT_RECORD_COLUMNS])
      .executeTakeFirst();
    if (confirmed) return answer(confirmed);

    // A confirm at the same moment made it ready: the same answer.
    const now = await readRow();
    if (now?.status === "ready") return answer(now);
    throw attachmentError("NOT_FOUND");
  } catch (error) {
    return endpointError(error);
  }
}
