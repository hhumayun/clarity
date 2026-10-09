import superjson from "superjson";
import { apiFetch } from "./apiFetch";
import { jsonHeaders, parseResponse } from "./parse";

/**
 * Photos kept on the server (revamp 5, docs/photos-server.md section 5): the
 * phone uploads a photo straight to the bucket through a signed link, and
 * shows one from another. The server only signs the links and keeps count.
 * Errors carry the server's `code` (parseResponse), which the photo lane acts
 * on (photoFailure in sync/outbox.ts).
 */

export type AttachmentContentType = "image/jpeg" | "image/png" | "image/webp";

/** A photo as the photo endpoints answer it. */
export type AttachmentRecord = {
  id: string;
  contentType: AttachmentContentType;
  bytes: number;
  width: number | null;
  height: number | null;
  createdAt: Date;
  confirmedAt: Date | null;
};

export type AttachmentUsage = {
  /** False when the server keeps no photos: the Photo tool is hidden. */
  enabled: boolean;
  /** Bytes of this account's photos, pending and ready. */
  usedBytes: number;
  quotaBytes: number;
  maxPhotoBytes: number;
  /** Photos this account keeps, pending and ready. */
  photos: number;
  maxPhotos: number;
};

export type AttachmentStart =
  | { status: "ready"; attachment: AttachmentRecord }
  | { status: "pending"; upload: { url: string; method: "PUT"; headers: Record<string, string>; expiresAt: Date } };

export type PhotoView = { url: string; expiresAt: Date; contentType: string; width: number | null; height: number | null };

async function post<T>(path: string, body: unknown, init?: RequestInit): Promise<T> {
  const result = await apiFetch(path, {
    method: "POST",
    body: superjson.stringify(body),
    ...init,
    headers: jsonHeaders(init),
  });
  return parseResponse(result);
}

/** Whether photos are on, and how much room this account has. */
export async function getAttachmentUsage(init?: RequestInit): Promise<AttachmentUsage> {
  const result = await apiFetch("/_api/attachments/usage", { method: "GET", ...init });
  return parseResponse(result);
}

/** A signed upload link for a photo, or `ready` when the server already has it. */
export function postAttachmentStart(
  body: { id: string; contentType: AttachmentContentType; bytes: number; width?: number; height?: number },
  init?: RequestInit,
): Promise<AttachmentStart> {
  return post("/_api/attachments/start", body, init);
}

/** The photo's bytes are in the bucket: the server checks them and keeps it. */
export function postAttachmentConfirm(body: { id: string }, init?: RequestInit): Promise<{ attachment: AttachmentRecord }> {
  return post("/_api/attachments/confirm", body, init);
}

/** Short-lived links to show photos, up to 100 at once; null for one the server hasn't got. */
export function postAttachmentsView(body: { ids: string[] }, init?: RequestInit): Promise<{ photos: Record<string, PhotoView | null> }> {
  return post("/_api/attachments/view", body, init);
}

/** Gives up on an upload (a note still naming the photo keeps it: `IN_USE`). */
export function postAttachmentDelete(body: { id: string }, init?: RequestInit): Promise<{ deleted: true }> {
  return post("/_api/attachments/delete", body, init);
}
