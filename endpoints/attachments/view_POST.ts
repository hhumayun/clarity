import superjson from "superjson";
import { db } from "../../helpers/db";
import { requireUser } from "../../helpers/requireUser";
import { endpointError } from "../../helpers/endpointError";
import { presignView, requireBucket, s3Call, VIEW_LINK_SECONDS } from "../../helpers/bucket";
import { PHOTO_ID } from "../../helpers/attachmentLimits";
import { schema, type OutputType, type PhotoView } from "./view_POST.schema";

/**
 * Signed download links for up to 100 of this account's ready photos
 * (docs/photos-server.md, 5.5). POST because it takes a list. Orphaned
 * photos within their 7 days are still shown: an undo or a paste may bring
 * them back.
 */
export async function handle(request: Request) {
  try {
    const user = await requireUser(request);
    const input = schema.parse(superjson.parse(await request.text()));
    const b = requireBucket();

    // fromEntries makes own properties, so no asked id can reach the prototype.
    const photos: Record<string, PhotoView | null> = Object.fromEntries(input.ids.map((id) => [id, null]));
    const valid = [...new Set(input.ids.filter((id) => PHOTO_ID.test(id)))];
    if (valid.length > 0) {
      const rows = await db
        .selectFrom("attachments")
        .select(["id", "storageKey", "contentType", "width", "height"])
        .where("userId", "=", user.id)
        .where("id", "in", valid)
        .where("status", "=", "ready")
        .execute();
      const views = await Promise.all(
        rows.map(async (row) => {
          const link = await s3Call("presign view", () => presignView(b, row.storageKey, VIEW_LINK_SECONDS));
          return [row.id, { ...link, contentType: row.contentType, width: row.width, height: row.height }] as const;
        }),
      );
      for (const [id, view] of views) photos[id] = view;
    }

    return new Response(superjson.stringify({ photos } satisfies OutputType));
  } catch (error) {
    return endpointError(error);
  }
}
