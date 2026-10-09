import { postAttachmentConfirm, postAttachmentDelete, postAttachmentStart } from "../core/api/attachments";
import { photoStore } from "./photoStore";

/**
 * One photo up to the server (docs/photos-server.md 9.4), for the outbox's
 * photo lane: a signed link from the server, the bytes straight to the
 * bucket, then the server confirms them. Throws with an HTTP status (and the
 * server's `code`) for the lane to judge (photoFailure in sync/outbox.ts).
 */
export class PhotoUploadError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
  ) {
    super(message);
    this.name = "PhotoUploadError";
  }
}

const codeOf = (error: unknown): string | undefined =>
  typeof error === "object" && error !== null && typeof (error as { code?: unknown }).code === "string" ? (error as { code: string }).code : undefined;

/** Thrown when the person signed out (or someone else signed in) mid-upload: the lane drops the try quietly. */
export const SIGNED_OUT = "SIGNED_OUT";

/**
 * Uploads a kept photo. `progress.put` says its bytes already went up (a
 * retry then confirms first, without sending the whole file again);
 * `onPut` keeps that flag with the outbox entry. `stillCurrent` says the
 * same person is signed in; it's asked before every server call, so a
 * photo of someone who signed out never goes to the next account.
 */
export async function uploadPhoto(
  { id, width, height }: { id: string; width?: number; height?: number },
  progress: { put: boolean; onPut(put: boolean): void; stillCurrent?: () => boolean },
): Promise<void> {
  const check = () => {
    if (progress.stillCurrent && !progress.stillCurrent()) throw new PhotoUploadError(410, "Signed out", SIGNED_OUT);
  };
  const local = await photoStore.forUpload(id);
  // Not on this phone (its file went): nothing to send, quietly.
  if (!local) throw new PhotoUploadError(410, "The photo isn't on this phone");
  let put = progress.put;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (!put) {
      let started;
      check();
      try {
        started = await postAttachmentStart({
          id,
          contentType: "image/jpeg",
          bytes: local.bytes,
          ...(width ? { width: Math.round(width) } : {}),
          ...(height ? { height: Math.round(height) } : {}),
        });
      } catch (error) {
        // A stale unfinished upload of another size: given up on, and started afresh with a new key.
        if (codeOf(error) === "UPLOAD_CHANGED" && attempt === 0) {
          check();
          try {
            await postAttachmentDelete({ id });
          } catch {
            // Not given up on yet (the server's busy, or still holds it): tried again later, never dropped.
            throw new PhotoUploadError(503, "The unfinished upload couldn't be cleared yet", "PHOTOS_UNAVAILABLE");
          }
          continue;
        }
        throw error;
      }
      // The server has it already (a retry whose confirm answer was lost).
      if (started.status === "ready") return;
      // A network error throws: tried again later.
      const status = await local.put(started.upload.url, started.upload.headers);
      // The link expired or was refused: a fresh one, once.
      if (status === 403 && attempt === 0) continue;
      if (status >= 500 || status === 408 || status === 429) throw new PhotoUploadError(503, `The bucket answered ${status}`);
      // The server already took its size and type, so any other refusal is the
      // bucket's (keys rotated, a rule misset), never the photo's: waited out
      // like photos being off, and tried again, never given up on.
      if (status < 200 || status >= 300) throw new PhotoUploadError(503, `The bucket answered ${status}`, "PHOTOS_UNAVAILABLE");
      put = true;
      progress.onPut(true);
    }
    check();
    try {
      await postAttachmentConfirm({ id });
      return;
    } catch (error) {
      const code = codeOf(error);
      if (code === "NOT_FOUND" || code === "NOT_UPLOADED") {
        // Not there after all: start over once now, then wait.
        put = false;
        progress.onPut(false);
        if (attempt === 0) continue;
        throw new PhotoUploadError(503, "The photo hasn't arrived yet");
      }
      throw error;
    }
  }
  throw new PhotoUploadError(503, "The photo couldn't be uploaded yet");
}
