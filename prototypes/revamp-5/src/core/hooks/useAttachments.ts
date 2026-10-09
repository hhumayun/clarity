import { useQuery } from "@tanstack/react-query";
import { getAttachmentUsage } from "../api/attachments";

/**
 * Whether photos are on for account notes (revamp 5, docs/photos-server.md
 * 9.2): the server's `usage` answer, kept on the phone (sync/persist.ts) so
 * it's known offline, fresh for 10 minutes, asked again on sign-in (the
 * cache starts empty) and on coming back to the app once it's older.
 */
export const ATTACHMENTS_USAGE_QUERY_KEY = ["attachments-usage"] as const;

/**
 * Sage's web build uploads to and shows from the bucket's own address, which
 * its CORS rule must allow. Set to false if the bucket won't keep one: the
 * web build then hides the Photo tool in account notes (the phone needs no
 * CORS and is unaffected).
 */
export const PHOTOS_ON_WEB = true;

const statusOf = (error: unknown): number | null =>
  typeof error === "object" && error !== null && typeof (error as { status?: unknown }).status === "number" ? (error as { status: number }).status : null;

export const usePhotoUsage = (enabled = true) =>
  useQuery({
    queryKey: ATTACHMENTS_USAGE_QUERY_KEY,
    queryFn: () => getAttachmentUsage(),
    enabled,
    staleTime: 10 * 60_000,
    // An answer from the server (a 404 from one without photos, a 401) won't change by asking again at once.
    retry: (failures, error) => statusOf(error) === null && failures < 2,
  });

/**
 * The Photo tool shows in account notes only once the server has said photos
 * are on. Not known yet, a server without photos (404, or `enabled: false`),
 * or the web build with photos off there: hidden. So nothing changes until
 * the server keeps photos.
 */
export function usePhotosEnabled(enabled = true): boolean {
  const usage = usePhotoUsage(enabled);
  if (!enabled) return false;
  if (process.env.EXPO_OS === "web" && !PHOTOS_ON_WEB) return false;
  if (statusOf(usage.error) === 404) return false;
  return usage.data?.enabled === true;
}
