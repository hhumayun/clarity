import { z } from "zod";
import type { AttachmentContentType } from "./schema";

/**
 * Limits on photos in notes (docs/photos-server.md, sections 1 and 5.1).
 * Shared by the photo endpoints, the note save hooks and the sweep; holds no
 * server-only code, so schema files may import it.
 */
export const MAX_PHOTO_BYTES = 10 * 1024 * 1024; // 10,485,760
export const ACCOUNT_QUOTA_BYTES = 1024 * 1024 * 1024; // 1,073,741,824
export const MAX_PHOTOS_PER_ACCOUNT = 10_000; // rows, pending and ready
export const MAX_PENDING_PER_ACCOUNT = 20;
export const MAX_PHOTOS_PER_NOTE = 200; // distinct ids a note names
export const MAX_MISSING_LISTED = 100;
export const UPLOAD_CALLS_PER_MINUTE = 60; // start + confirm, per user, per instance
export const ORPHAN_GRACE_MS = 7 * 24 * 60 * 60 * 1000;
export const PENDING_GRACE_MS = 24 * 60 * 60 * 1000;
export const PHOTO_ID = /^[A-Za-z0-9-]{8,64}$/;
export const attachmentIdSchema = z
  .string()
  .regex(PHOTO_ID, "That photo's id can't be used.");

/** A photo as the photo endpoints answer it. Never carries the storage key. */
export type AttachmentRecord = {
  id: string;
  contentType: AttachmentContentType;
  bytes: number;
  width: number | null;
  height: number | null;
  createdAt: Date;
  confirmedAt: Date | null;
};

/** The columns an AttachmentRecord is read from. */
export const ATTACHMENT_RECORD_COLUMNS = [
  "id",
  "contentType",
  "bytes",
  "width",
  "height",
  "createdAt",
  "confirmedAt",
] as const;

/** Picks the record's fields from a row, so nothing else (the key, the status) leaks into an answer. */
export function toAttachmentRecord(row: AttachmentRecord): AttachmentRecord {
  return {
    id: row.id,
    contentType: row.contentType,
    bytes: row.bytes,
    width: row.width,
    height: row.height,
    createdAt: row.createdAt,
    confirmedAt: row.confirmedAt,
  };
}
