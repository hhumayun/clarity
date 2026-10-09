import { sql } from "kysely";
import superjson from "superjson";
import { db } from "../../helpers/db";
import { requireUser } from "../../helpers/requireUser";
import { endpointError } from "../../helpers/endpointError";
import { bucket } from "../../helpers/bucket";
import { ACCOUNT_QUOTA_BYTES, MAX_PHOTO_BYTES, MAX_PHOTOS_PER_ACCOUNT } from "../../helpers/attachmentLimits";
import type { OutputType } from "./usage_GET.schema";

/**
 * How much photo space this account uses, and whether photos are on at all
 * (docs/photos-server.md, 5.2). Answers 200 even with photos off.
 */
export async function handle(request: Request) {
  try {
    const user = await requireUser(request);
    const row = await db
      .selectFrom("attachments")
      .select([
        sql<string>`count(*)`.as("photos"),
        sql<string>`coalesce(sum(bytes), 0)::bigint`.as("used"),
      ])
      .where("userId", "=", user.id)
      .executeTakeFirstOrThrow();
    return new Response(
      superjson.stringify({
        enabled: bucket() !== null,
        usedBytes: Number(row.used),
        quotaBytes: ACCOUNT_QUOTA_BYTES,
        maxPhotoBytes: MAX_PHOTO_BYTES,
        photos: Number(row.photos),
        maxPhotos: MAX_PHOTOS_PER_ACCOUNT,
      } satisfies OutputType),
    );
  } catch (error) {
    return endpointError(error);
  }
}
