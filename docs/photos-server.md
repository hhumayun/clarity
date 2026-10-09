# Photos on the server

*Design, 2026-10-09, revised the same day after a security review and an
integrity review (section 15 lists what changed and why). Follows PR #1
(b691ac1), which added photos to Sage's editor, kept on the phone only. This
is phase 2 of `docs/rich-text-plan.md` ("Phase 2: photos") and the "Next" list
in `prototypes/revamp-5/docs/editor-plan.md`, section 10. Nothing here is
built yet. Each step that touches production needs the user's OK.*

Paths are relative to this worktree (`/root/projects/clarity-revamp-5-ux`)
unless they start with `prototypes/revamp-5/` (Sage, committed copy) or
`/root/projects/clarity-revamp-5/` (Sage's running copy, which Metro on 8087
serves; it is copied into `prototypes/revamp-5` to commit).

---

## 1. Goals and non-goals

**Goals**

- A photo added to an account note on one device shows on another.
- Photo files live in a private Railway Storage Bucket. The server never
  carries the bytes: the phone uploads straight to the bucket with a signed
  link, and downloads with another.
- Uploads go through Sage's outbox: they work offline, retry, and run in a
  lane of their own, so they never hold back note and task saves, and a
  failing photo never stops lists refreshing.
- Limits: 10 MB per photo, 1 GB per account (pending and ready uploads both
  count), 10,000 photos per account, 20 unfinished uploads at once, 200
  photos per note, 60 upload calls a minute.
- Clean-up: a photo no note names any more is deleted after 7 days; an upload
  never confirmed is deleted after 24 hours; deleting an account deletes all
  its photos. Every bucket object the server ever signed a link for is either
  in a row or queued for deletion, and queued deletions run again after every
  upload link has expired.
- The account export lists every photo still in a note, with a download link
  that works for one hour.
- No `attachment:` link reaches an AI model.
- Nothing breaks for the main app or the web app, and no client loses typed
  text because of photos. A client that doesn't say it removed a photo can't
  remove it: the server puts it back at the end of the note (section 6.2).

**Non-goals (later steps)**

- Showing real photos in the main app or the web app. They keep the outline
  (main app) or the raw `![](attachment:…)` text (web app).
- Thumbnails in note lists, a full-screen viewer, files other than photos
  (phase 3).
- Server-side image processing. The phone already makes a JPEG of at most
  2048 px.
- Undo across devices, or version checks on note saves (last write still
  wins for words, as today).

---

## 2. Decisions in one place

| Question | Decision |
|---|---|
| Photo id | Made on the phone (`Crypto.randomUUID()`), checked with `^[A-Za-z0-9-]{8,64}$`. Unique **per user**: the key is `(user_id, id)`. |
| Who names a photo | Notes, through a link table `note_attachments` rebuilt from each saved note. Before deleting a photo the sweep also reads the notes' own text, so a missing link never costs a photo. |
| Link table and unknown ids | A note may name a photo the server doesn't have (not uploaded yet, or never). Links have no foreign key to `attachments`. |
| Storage key | Made by the server: `u/<userId>/<photoId>/<random>`. A new key for every new row. A pending row keeps its key only while `start` is called again with the **same** size and type; anything else is refused (`UPLOAD_CHANGED`). |
| S3 library | `@aws-sdk/client-s3` and `@aws-sdk/s3-request-presigner`, both pinned at `3.1148.0`. Connection timeout 5 s, request timeout 30 s, 3 attempts. |
| Bucket errors | Never shown to the client. Every bucket call is wrapped; a failure is logged by name and status only and answered 503 `PHOTOS_UNAVAILABLE`, which clients retry. |
| Upload | Presigned `PUT`, 15 minutes, with `Content-Type` and `Content-Length` signed. |
| Viewing | Presigned `GET`, 10 minutes, in batches of up to 100 ids. |
| Export links | Presigned `GET`, **1 hour**, only for photos a note still names; the file says when they stop working. |
| Bucket variables missing | The server starts and everything else works. Photo endpoints answer 503 `PHOTOS_UNAVAILABLE`, `usage` says `enabled: false`, and Sage hides the Photo tool. Note saves still record links. |
| Clean-up | A timer in `server.ts`, every 15 minutes, guarded by a lease row, with an 8-minute time budget. Object deletions are queued in a table first and carried out only after every upload link for that key has expired (20 minutes). A daily pass marks unlinked photos and lists the bucket for objects nothing knows about. |
| Removing a photo | A note save names the photos the writer removed (`removedPhotos`). A photo the note had that the save neither names nor removes is put back at the end of the note. Nothing is refused; old clients lose no text. |
| Outbox | A new operation `photo.upload` in the same stored queue, sent by a separate photo lane, one photo at a time, with its own stored retry time. Photos don't count as "still syncing" for list refreshes; they do count for "All changes saved" and the sign-out warning. |

---

## 3. Data model: migration 017

### 3.1 The SQL

New file `migrations/017_attachments.sql`:

```sql
-- Photos in notes (docs/photos-server.md). A photo is a file in the Railway
-- bucket; a note only names it, as ![](attachment:<id>) in its Markdown and
-- an image node in its rich text. The id is made on the phone.
--
-- attachments: one row per photo the server has been asked to keep.
-- note_attachments: which notes name which photo ids, rebuilt from each
--   saved note. A photo nobody names gets orphaned_since, and is deleted 7
--   days later (helpers/attachmentSweep.tsx) if no note's text names it
--   either. Links have no foreign key to attachments: a note can name a
--   photo that isn't uploaded yet.
-- storage_deletions: bucket objects (or, with is_prefix, whole prefixes) to
--   delete. Written in the same transaction that removes the attachment row,
--   so no object is forgotten; carried out only after not_before, when no
--   upload link for the key can still be used.
-- maintenance_leases: so only one server instance sweeps at a time, and when
--   the daily pass last ran.
--
-- Only adds tables, so a server running older code doesn't see them and the
-- main app and web app keep working. Safe to run twice.
-- Apply BEFORE deploying the code that reads it: every note save writes
-- note_attachments.

BEGIN;

CREATE TABLE IF NOT EXISTS attachments (
  user_id            INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  id                 TEXT NOT NULL CHECK (id ~ '^[A-Za-z0-9-]{8,64}$'),
  kind               TEXT NOT NULL DEFAULT 'photo' CHECK (kind IN ('photo')),
  content_type       TEXT NOT NULL CHECK (content_type IN ('image/jpeg', 'image/png', 'image/webp')),
  bytes              INTEGER NOT NULL CHECK (bytes > 0 AND bytes <= 10485760),
  width              INTEGER CHECK (width > 0 AND width <= 20000),
  height             INTEGER CHECK (height > 0 AND height <= 20000),
  storage_key        TEXT NOT NULL UNIQUE,
  status             TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'ready')),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  upload_started_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  confirmed_at       TIMESTAMPTZ,
  orphaned_since     TIMESTAMPTZ,
  PRIMARY KEY (user_id, id)
);
CREATE INDEX IF NOT EXISTS attachments_pending_idx
  ON attachments (upload_started_at) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS attachments_orphaned_idx
  ON attachments (orphaned_since) WHERE orphaned_since IS NOT NULL;
-- The daily "mark" pass reads only ready photos not yet marked.
CREATE INDEX IF NOT EXISTS attachments_unmarked_idx
  ON attachments (user_id, id) WHERE status = 'ready' AND orphaned_since IS NULL;

CREATE TABLE IF NOT EXISTS note_attachments (
  note_id        TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  attachment_id  TEXT NOT NULL,
  PRIMARY KEY (note_id, attachment_id)
);
CREATE INDEX IF NOT EXISTS note_attachments_user_attachment_idx
  ON note_attachments (user_id, attachment_id);

CREATE TABLE IF NOT EXISTS storage_deletions (
  storage_key  TEXT PRIMARY KEY,      -- an object key, or a prefix ending in '/' when is_prefix
  is_prefix    BOOLEAN NOT NULL DEFAULT false,
  queued_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Longer than an upload link lives (15 minutes) plus clock skew.
  not_before   TIMESTAMPTZ NOT NULL DEFAULT now() + interval '20 minutes',
  attempts     INTEGER NOT NULL DEFAULT 0,
  last_error   TEXT,
  user_id      INTEGER,               -- set by attachments/delete: whose photo, and
  bytes        INTEGER                -- its size, counted by `start` until not_before
);
CREATE INDEX IF NOT EXISTS storage_deletions_due_idx ON storage_deletions (not_before);
CREATE INDEX IF NOT EXISTS storage_deletions_user_idx
  ON storage_deletions (user_id, not_before) WHERE user_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS maintenance_leases (
  name        TEXT PRIMARY KEY,
  holder      TEXT NOT NULL,
  held_until  TIMESTAMPTZ NOT NULL
);

-- Notes that already name photos (pasted from a sample note into an account
-- note while the Photo tool was hidden there) get their links now, from the
-- Markdown and the rich text both.
INSERT INTO note_attachments (note_id, user_id, attachment_id)
SELECT DISTINCT n.id, n.user_id, m[1]
FROM notes n,
     regexp_matches(n.content || ' ' || coalesce(n.doc::text, ''), 'attachment:([A-Za-z0-9-]{8,64})', 'g') AS m
ON CONFLICT DO NOTHING;

COMMIT;
```

Why each choice:

- **`PRIMARY KEY (user_id, id)`**, not `id` alone. Ids come from phones. With a
  global key, one user could learn that another user's id exists (a conflict),
  or block it. Every query filters by `user_id` first.
- **`ON DELETE CASCADE` from `users`** keeps the foreign keys valid. Account
  deletion still queues the objects and deletes the rows itself first
  (section 7.3). If older code ever deletes a user (a rollback), the cascade
  removes rows whose objects nobody queued; the daily bucket listing
  (section 7.2) finds and deletes those.
- **`note_attachments.note_id ON DELETE CASCADE`**: the links go with the note.
  The `attachments` row stays, so its object can still be found. The note
  delete hook marks it orphaned (section 6.3), and the daily pass catches
  anything missed.
- **No `note_id` on `attachments`.** A photo can be in two notes (copy and
  paste works in both editors).
- **`bytes INTEGER`**: 10 MB fits. Sums are cast to `bigint`.
- **`upload_started_at`** moves on every `start`, so an upload retried for
  days isn't expired while it is being retried.
- **`storage_deletions.not_before`** defaults to 20 minutes ahead, so code
  that forgets to think about it only delays a deletion. A row is removed
  only by the drain, after `not_before`, so a PUT through a link that was
  still valid when the row was deleted is deleted too.
- The backfill reads `doc` as text, which is looser than the editor's rule
  (any `attachment:<id>` anywhere). Too many links only keep a photo longer.

### 3.2 Kysely types

Add to `helpers/schema.tsx` (it is hand-edited after each migration; follow the
comment style used for migration 014):

```ts
/** A photo kept in the bucket (migration 017). */
export interface Attachments {
  bytes: number;
  confirmedAt: Timestamp | null;
  contentType: AttachmentContentType;
  createdAt: Generated<Timestamp>;
  height: number | null;
  id: string;
  kind: Generated<AttachmentKind>;
  orphanedSince: Timestamp | null;
  status: Generated<AttachmentStatus>;
  storageKey: string;
  uploadStartedAt: Generated<Timestamp>;
  userId: number;
  width: number | null;
}
export type AttachmentKind = "photo";
export type AttachmentStatus = "pending" | "ready";
export type AttachmentContentType = "image/jpeg" | "image/png" | "image/webp";

/** Which notes name which photo ids, rebuilt on every save (migration 017). */
export interface NoteAttachments {
  attachmentId: string;
  noteId: string;
  userId: number;
}

/** Bucket objects (or prefixes) still to delete, not before `notBefore` (migration 017). */
export interface StorageDeletions {
  attempts: Generated<number>;
  isPrefix: Generated<boolean>;
  lastError: string | null;
  notBefore: Generated<Timestamp>;
  queuedAt: Generated<Timestamp>;
  storageKey: string;
}

/** One server instance at a time for periodic work (migration 017). */
export interface MaintenanceLeases {
  heldUntil: Timestamp;
  holder: string;
  name: string;
}
```

In `interface DB`, add `attachments`, `noteAttachments`, `storageDeletions` and
`maintenanceLeases`. Add
`export const AttachmentContentTypeArrayValues: [AttachmentContentType, ...AttachmentContentType[]] = ["image/jpeg","image/png","image/webp"];`
next to the other `*ArrayValues`. No name has an underscore before a digit,
so `kyselyIdentifierOverrides` stays empty.

---

## 4. Storage

### 4.1 Variables

The bucket (Railway service "clarity-photos") provides `BUCKET`,
`ACCESS_KEY_ID`, `SECRET_ACCESS_KEY`, `ENDPOINT` and `REGION`. On
`clarity-notes` they are referenced under prefixed names, so the generic
`REGION` and `ENDPOINT` can't be mistaken for anything else:

| On clarity-notes | Value |
|---|---|
| `PHOTOS_BUCKET` | `${{clarity-photos.BUCKET}}` |
| `PHOTOS_ACCESS_KEY_ID` | `${{clarity-photos.ACCESS_KEY_ID}}` |
| `PHOTOS_SECRET_ACCESS_KEY` | `${{clarity-photos.SECRET_ACCESS_KEY}}` |
| `PHOTOS_ENDPOINT` | `${{clarity-photos.ENDPOINT}}` |
| `PHOTOS_REGION` | `${{clarity-photos.REGION}}` (`auto`) |
| `PHOTOS_PATH_STYLE` | unset in production; `1` for the local S3, or if the bucket's Credentials tab says path-style |

### 4.2 `helpers/bucket.tsx`

New dependencies in `package.json`: `"@aws-sdk/client-s3": "3.1148.0"` and
`"@aws-sdk/s3-request-presigner": "3.1148.0"` (exact versions). The import
costs about 0.2 s on Node 24, once, on the first photo request.

```ts
import { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand,
  DeleteObjectsCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { randomBytes } from "node:crypto";
import { AttachmentError } from "./endpointError";

export const UPLOAD_LINK_SECONDS = 15 * 60;
export const VIEW_LINK_SECONDS = 10 * 60;
export const EXPORT_LINK_SECONDS = 60 * 60;

type Bucket = { s3: S3Client; name: string };
let cached: Bucket | null | undefined;

/** The bucket, or null when its variables aren't set (photos are off). */
export function bucket(): Bucket | null {
  if (cached !== undefined) return cached;
  const { PHOTOS_BUCKET, PHOTOS_ACCESS_KEY_ID, PHOTOS_SECRET_ACCESS_KEY, PHOTOS_ENDPOINT } = process.env;
  if (!PHOTOS_BUCKET || !PHOTOS_ACCESS_KEY_ID || !PHOTOS_SECRET_ACCESS_KEY || !PHOTOS_ENDPOINT) {
    return (cached = null);
  }
  const s3 = new S3Client({
    region: process.env.PHOTOS_REGION || "auto",
    endpoint: PHOTOS_ENDPOINT,
    forcePathStyle: process.env.PHOTOS_PATH_STYLE === "1",
    credentials: { accessKeyId: PHOTOS_ACCESS_KEY_ID, secretAccessKey: PHOTOS_SECRET_ACCESS_KEY },
    // No checksum of an empty body in presigned PUTs (the SDK adds one by default).
    requestChecksumCalculation: "WHEN_REQUIRED",
    // A hung request must end: the sweep and request handlers wait on these.
    requestHandler: { connectionTimeout: 5_000, requestTimeout: 30_000 },
    maxAttempts: 3,
  });
  return (cached = { s3, name: PHOTOS_BUCKET });
}

/** The bucket, or 503 PHOTOS_UNAVAILABLE. */
export function requireBucket(): Bucket { /* bucket() ?? throw new AttachmentError(503, "PHOTOS_UNAVAILABLE", …) */ }

/**
 * Runs one bucket call. Any failure is logged by name and HTTP status only
 * (SDK messages can carry the host, bucket and key) and becomes 503
 * PHOTOS_UNAVAILABLE, which clients retry.
 */
export async function s3Call<T>(what: string, call: () => Promise<T>): Promise<T> {
  try { return await call(); }
  catch (error) {
    const e = error as { name?: string; $metadata?: { httpStatusCode?: number } };
    console.error(`bucket ${what} failed:`, e?.name ?? "Error", e?.$metadata?.httpStatusCode ?? "-");
    throw new AttachmentError(503, "PHOTOS_UNAVAILABLE", "Photos can't be kept just now.");
  }
}

/** u/<userId>/<photoId>/<random>: the user's prefix makes account deletion one listing. */
export const storageKeyFor = (userId: number, photoId: string) =>
  `u/${userId}/${photoId}/${randomBytes(9).toString("base64url")}`;
export const userPrefix = (userId: number) => `u/${userId}/`;

export async function presignUpload(b: Bucket, key: string, bytes: number, contentType: string) {
  const url = await getSignedUrl(b.s3,
    new PutObjectCommand({ Bucket: b.name, Key: key, ContentType: contentType, ContentLength: bytes }),
    // content-length is signed by default; content-type only when asked.
    { expiresIn: UPLOAD_LINK_SECONDS, signableHeaders: new Set(["content-type"]) });
  return { url, method: "PUT" as const, headers: { "Content-Type": contentType },
    expiresAt: new Date(Date.now() + UPLOAD_LINK_SECONDS * 1000) };
}

export async function presignView(b: Bucket, key: string, seconds: number, filename?: string) {
  const url = await getSignedUrl(b.s3, new GetObjectCommand({ Bucket: b.name, Key: key,
    ...(filename ? { ResponseContentDisposition: `attachment; filename="${filename}"` } : {}) }),
    { expiresIn: seconds });
  return { url, expiresAt: new Date(Date.now() + seconds * 1000) };
}

/** Size and type of an uploaded object, or null when it isn't there. */
export async function headObject(b: Bucket, key: string) { /* HeadObjectCommand; 404 → null; else rethrow */ }

/** Deletes up to 1,000 keys; returns the keys that failed. A missing key is not a failure. */
export async function deleteObjects(b: Bucket, keys: string[]): Promise<string[]> { /* DeleteObjectsCommand, Quiet: true; collect Errors[].Key */ }

/** One page of keys under a prefix, with each key's LastModified, and the next token. */
export async function listPage(b: Bucket, prefix: string, token?: string):
  Promise<{ objects: { key: string; lastModified: Date }[]; next?: string }> { /* ListObjectsV2, MaxKeys 1000 */ }
```

Notes:

- Every caller wraps `headObject`, `deleteObjects`, `listPage` and the
  presigners in `s3Call`. Nothing from the SDK reaches `endpointError`'s
  generic 400 (which would show its message to the client, and which Sage
  treats as "never retry").
- `requestHandler` as a plain object is the SDK's shorthand for
  `NodeHttpHandler` options. If 3.1148.0 rejects it at typecheck, import
  `NodeHttpHandler` from `@smithy/node-http-handler` (pin the version the SDK
  already pulls in).
- The client must send exactly the signed headers: `Content-Type` as returned,
  and a body of exactly `bytes` bytes. It must not add any `x-amz-*` header.
  Tigris rejects unsigned `x-amz-*` headers on buckets made after 28 September
  2026, which this one will be.
- `bucket()` reads the variables once. Changing them needs a redeploy, which
  Railway does anyway.
- **Bucket CORS** matters only for Sage's web build (the phone's requests are
  not subject to CORS). Section 12, step 4.

---

## 5. Endpoints

All follow the repo's pattern: `endpoints/attachments/<name>_<METHOD>.ts` and
`.schema.ts`, `requireUser`, `schema.parse(superjson.parse(await request.text()))`,
`endpointError`. Add to the `routes` array in `server.ts`:

```ts
["GET", "/_api/attachments/usage", "./endpoints/attachments/usage_GET.js"],
["POST", "/_api/attachments/start", "./endpoints/attachments/start_POST.js"],
["POST", "/_api/attachments/confirm", "./endpoints/attachments/confirm_POST.js"],
["POST", "/_api/attachments/view", "./endpoints/attachments/view_POST.js"],
["POST", "/_api/attachments/delete", "./endpoints/attachments/delete_POST.js"],
```

### 5.1 Shared pieces

`helpers/attachmentLimits.tsx`:

```ts
export const MAX_PHOTO_BYTES = 10 * 1024 * 1024;          // 10,485,760
export const ACCOUNT_QUOTA_BYTES = 1024 * 1024 * 1024;    // 1,073,741,824
export const MAX_PHOTOS_PER_ACCOUNT = 10_000;              // rows, pending and ready
export const MAX_PENDING_PER_ACCOUNT = 20;
export const MAX_PHOTOS_PER_NOTE = 200;                    // distinct ids a note names
export const MAX_MISSING_LISTED = 100;
export const UPLOAD_CALLS_PER_MINUTE = 60;                 // start + confirm, per user, per instance
export const ORPHAN_GRACE_MS = 7 * 24 * 60 * 60 * 1000;
export const PENDING_GRACE_MS = 24 * 60 * 60 * 1000;
export const PHOTO_ID = /^[A-Za-z0-9-]{8,64}$/;
export const attachmentIdSchema = z.string().regex(PHOTO_ID, "That photo's id can't be used.");
```

`helpers/rateLimit.tsx` (new): `takeToken(bucketName, userId, perMinute)`: a
sliding one-minute window in a `Map<string, number[]>`, pruned on use and
emptied of idle users every 10 minutes. Over the limit it throws
`AttachmentError(429, "RATE_LIMITED", …)`. In memory per instance is enough
for one Railway instance; it is a brake, not an accounting system.

`helpers/endpointError.tsx` gains one class, so photo answers carry a status
and a `code` (Sage's `parseResponse` reads `code`, `src/core/api/parse.ts`):

```ts
export class AttachmentError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}
// in endpointError, before the generic 400:
if (error instanceof AttachmentError) return json({ error: error.message, code: error.code }, error.status);
```

| Code | Status | Message | When |
|---|---|---|---|
| `PHOTOS_UNAVAILABLE` | 503 | "Photos can't be kept just now." | `bucket()` is null, or a bucket call failed |
| `RATE_LIMITED` | 429 | "Too many photos at once. Please wait a moment." | over 60 `start`/`confirm` a minute |
| `TOO_MANY_PENDING` | 429 | "Some photos are still uploading. Please wait a moment." | `start` of a new id with 20 pending already |
| `TOO_LARGE` | 413 | "That photo is larger than 10 MB." | `bytes > MAX_PHOTO_BYTES` |
| `QUOTA_FULL` | 413 | "Your photos have used all 1 GB of space." | over the quota |
| `PHOTO_LIMIT` | 413 | "This account already keeps 10,000 photos." | `start` of a new id at 10,000 rows |
| `NOT_FOUND` | 404 | "That photo could not be found." | no row for this user (or it changed during confirm) |
| `NOT_UPLOADED` | 409 | "That photo hasn't arrived yet." | confirm, object missing |
| `UPLOAD_CHANGED` | 409 | "That photo changed while it was uploading." | `start` again for a pending id with another size or type |
| `UPLOAD_MISMATCH` | 422 | "That photo didn't arrive whole." | confirm, size or type differ |
| `IN_USE` | 409 | "A note still has that photo." | delete, a note names it |
| `TOO_MANY_PHOTOS` | 422 | "A note can hold up to 200 photos." | not sent any more: a save naming more than 200 is kept, with links for 200 (6.1) |

The photo returned by several endpoints:

```ts
export type AttachmentRecord = {
  id: string; contentType: AttachmentContentType; bytes: number;
  width: number | null; height: number | null; createdAt: Date; confirmedAt: Date | null;
};
```

### 5.2 `GET /_api/attachments/usage`

- **Input:** none.
- **Output:** `{ enabled: boolean; usedBytes: number; quotaBytes: number; maxPhotoBytes: number; photos: number; maxPhotos: number }`.
  `usedBytes` is the sum of `bytes` over the user's rows, pending and ready.
- Answers 200 even when photos are off (`enabled: false`). Sage reads it to
  show or hide the Photo tool and to know when space is free again (section
  9.2); the go-live check reads it too.

### 5.3 `POST /_api/attachments/start`

- **Input:**
  ```ts
  z.object({
    id: attachmentIdSchema,
    contentType: z.enum(AttachmentContentTypeArrayValues),
    bytes: z.number().int().positive(),
    width: z.number().int().min(1).max(20000).optional(),
    height: z.number().int().min(1).max(20000).optional(),
  })
  ```
- **Steps:**
  1. `requireBucket()`.
  2. `bytes > MAX_PHOTO_BYTES`: `TOO_LARGE`.
  3. `takeToken("upload", user.id, UPLOAD_CALLS_PER_MINUTE)`.
  4. In one transaction:
     - `select id from users where id = $user for update`. This serialises
       starts for one user, so two at once can't both pass the limits.
     - `select … from attachments where user_id = $u and id = $id for update`
       (the sweep skips locked rows, section 7.1).
     - It is `ready`: answer `{ status: "ready", attachment }`. No link.
       (A retried upload whose confirm answer was lost.)
     - It is `pending` and `bytes` or `contentType` differ from the input:
       `UPLOAD_CHANGED`. Every link ever signed for a key carries the same
       size and type, so an old link can't put more bytes under a row than
       the row counts. The client deletes the id and starts again (a new row
       gets a new key; the old key is queued for deletion).
     - `select count(*) as photos, count(*) filter (where status = 'pending') as pending, coalesce(sum(bytes), 0)::bigint as used from attachments where user_id = $u and id <> $id`
       (one pass over the user's primary-key range).
     - No row yet and `pending >= MAX_PENDING_PER_ACCOUNT`: `TOO_MANY_PENDING`.
       No row yet and `photos >= MAX_PHOTOS_PER_ACCOUNT`: `PHOTO_LIMIT`.
       `used + recent + bytes > ACCOUNT_QUOTA_BYTES`: `QUOTA_FULL`, where
       `recent = coalesce(sum(bytes), 0) from storage_deletions where user_id = $u and not_before > now()`:
       photos deleted while an upload link for them may still be used, so
       start → delete → PUT through the old link can't store more than the quota.
     - No row: `insert … (userId, id, contentType, bytes, width, height, storageKey = storageKeyFor(user.id, id))`
       `returning storage_key`. Pending with the same values:
       `update attachments set upload_started_at = now() where user_id = $u and id = $id returning storage_key`.
  5. Presign outside the transaction (local signing, no network), in `s3Call`.
- **Output:**
  ```ts
  | { status: "ready"; attachment: AttachmentRecord }
  | { status: "pending"; upload: { url: string; method: "PUT"; headers: Record<string, string>; expiresAt: Date } }
  ```
- **Idempotent:** calling it again with the same values gives a fresh link for
  the same key. A second PUT overwrites the same bytes.
- A user can start an id that another user also has. Rows are separate and
  keys differ.

### 5.4 `POST /_api/attachments/confirm`

- **Input:** `{ id: attachmentIdSchema }`.
- **Steps:**
  1. `requireBucket()`; `takeToken("upload", …)`.
  2. Read the row for `(user.id, id)`. None: `NOT_FOUND`. `ready`: answer it
     (idempotent). Keep its `storage_key` as `$key`.
  3. `s3Call("head", () => headObject($key))`. Null: `NOT_UPLOADED` (also the
     answer if the bucket hasn't caught up yet; the client retries).
  4. Size or type differ from the row: `s3Call` delete the object (a failure
     is ignored: the row stays pending and its expiry queues the key),
     `UPLOAD_MISMATCH`. With both headers signed this should never happen; it
     guards against a store that doesn't enforce them.
  5. One statement, no lock held across the HEAD:
     `update attachments set status = 'ready', confirmed_at = now(),
     orphaned_since = case when exists (select 1 from note_attachments where user_id = $u and attachment_id = $id) then null else now() end
     where user_id = $u and id = $id and status = 'pending' and storage_key = $key returning …`.
     No row: read the row again. `ready` now (a confirm at the same moment):
     answer it. Otherwise (swept, or remade with a new key while this ran):
     `NOT_FOUND`, and the client starts again.
     A photo that no note names yet (the note save is still on its way)
     starts its 7 days now. The next save that names it clears the mark.
- **Output:** `{ attachment: AttachmentRecord }`.

### 5.5 `POST /_api/attachments/view`

- **Input:** `{ ids: z.array(z.string().max(100)).min(1).max(100) }`. Ids are
  not checked with `attachmentIdSchema` here: one malformed id (a token broken
  by hand in the web app) must not blank the others in the same batch.
- **Steps:** `requireBucket()`. Ids that fail `PHOTO_ID` answer null. Read the
  user's `ready` rows among the rest. Presign each with `VIEW_LINK_SECONDS`
  (in `s3Call`).
- **Output:**
  `{ photos: Record<string, { url: string; expiresAt: Date; contentType: string; width: number | null; height: number | null } | null> }`.
  Every asked id is a key. `null` means: not uploaded, still pending, deleted,
  malformed, or not this user's. The answer is the same in each case, so it
  tells nothing about other users.
- POST because it takes a list. Orphaned photos within their 7 days are still
  shown (an undo, or a paste, may bring them back).

### 5.6 `POST /_api/attachments/delete`

- **Input:** `{ id: attachmentIdSchema }`. A per-user brake of 60 a minute
  (`takeToken("delete", …)`).
- **Steps:**
  1. In one transaction:
     - `select storage_key, status, bytes from attachments where user_id = $u and id = $id for update`.
       None: answer `{ deleted: true }`.
     - Only for a `ready` row (a pending one always goes: nothing of it was
       confirmed, notes name a photo before its upload ends, and Sage's
       `UPLOAD_CHANGED` recovery deletes it to start afresh): a link names it, or a note's text does
       (`exists (select 1 from notes where user_id = $u and (content like '%attachment:' || $id || '%' or doc::text like '%attachment:' || $id || '%'))`;
       ids hold no `%` or `_`): `IN_USE`. Photos taken out of notes are
       cleaned up by the sweep, after the grace period. This endpoint is for
       an upload the client gives up on, and for the checks.
     - `delete from attachments …` and
       `insert into storage_deletions (storage_key, user_id, bytes) values ($key, $u, $bytes) on conflict do nothing`
       (`not_before` 20 minutes ahead; `start` counts the bytes until then).
  2. After the transaction, if `bucket()` is set, try `deleteObjects([key])`
     once (in `s3Call`, a failure ignored). The queue row stays either way:
     the drain deletes the key again after `not_before`, which removes
     anything PUT meanwhile through a link that was still valid.
- **Output:** `{ deleted: true }`, also when there was nothing to delete
  (idempotent). Works with photos off (step 2 is skipped).

---

## 6. Hooks in note endpoints

### 6.1 Finding a note's photos: `helpers/attachmentRefs.tsx`

```ts
const IN_TEXT = /attachment:([A-Za-z0-9-]{8,64})/g;

/** Photo ids named anywhere in a note's Markdown, even in a broken token. */
export function attachmentIdsInText(content: string): Set<string>

/** Photo ids in the rich text: every node of type "image" whose attrs.src starts with "attachment:". */
export function attachmentIdsInDoc(doc: unknown): Set<string>
// Walks `content` arrays iteratively (no recursion limit issues). A string doc
// (stored double-encoded, before migration 015) is JSON.parsed first; anything
// unreadable gives an empty set.

/** The union of both: what the note names. */
export function attachmentIdsOf(content: string, doc: unknown): Set<string>

/** Puts photos back at the end of a note: a `![](attachment:<id>)` paragraph each in the Markdown, an image node each in the rich text (when there is one). */
export function appendPhotos(content: string, doc: unknown, ids: string[]): { content: string; doc: unknown }
// content: content.trimEnd() + (content.trim() ? "\n\n" : "") + ids.map((id) => `![](attachment:${id})`).join("\n\n")
// doc: null stays null; otherwise { ...doc, content: [...doc.content, ...ids.map((id) => ({ type: "image", attrs: { src: `attachment:${id}` } }))] }
// (a block image at the top level, the shape Sage's editor keeps: editor/extensions.ts liftPhotos)

/** Text with every photo taken out, for AI models, previews and hashes. */
export function withoutAttachments(text: string): string
// 1. remove /!\[[^\]]*\]\(attachment:[^)]*\)/g
// 2. remove any leftover /attachment:[A-Za-z0-9-]{8,64}/g
// 3. collapse /\n{3,}/g to "\n\n" (a photo sits on a line of its own)
```

The loose rule in `attachmentIdsInText` keeps a photo whose token was broken by
hand in the web app's textarea. That costs space, never a photo. Text that
happens to contain `attachment:<something>` makes a link to an id that doesn't
exist, which is harmless.

`helpers/noteAttachments.tsx` (all functions take `trx`, never `db`, so they run
inside the caller's transaction):

```ts
/**
 * Called inside the note's transaction, AFTER its insert or update (which
 * holds the note's row lock, so the links read here are the ones the
 * previous save committed). Makes the links match what the note names, puts
 * back photos the writer didn't remove, and lists the named ids the server
 * has no ready photo for.
 */
export async function syncNoteAttachments(trx, userId: number, note: NoteRow, removed: ReadonlySet<string>):
  Promise<{ note: NoteRow; missing: string[] }>
// 1. named = attachmentIdsOf(note.content, note.doc)
//    named.size > MAX_PHOTOS_PER_NOTE: the save is kept (no typed text is refused); only the first 200
//    ids (sorted) get links, nothing is put back, console.warn. The sweep's text check still keeps the rest.
// 2. old = select attachment_id from note_attachments where note_id = $id
// 3. kept = old − named − removed
//    kept non-empty: { content, doc } = appendPhotos(note.content, note.doc, kept);
//      update notes set content, doc where id = $id and user_id = $u returning NOTE_RECORD_COLUMNS
//      (updatedAt is not touched again); note = that row; named ∪= kept
// 4. delete links in old but not named; insert named but not old (on conflict do nothing)
// 5. added (named − old): update attachments set orphaned_since = null where user_id = $u and id in (added)
// 6. dropped (old − named): markOrphansIfUnused(trx, userId, dropped)
// 7. missing = named − (select id from attachments where user_id = $u and id in (named) and status = 'ready'),
//    the first MAX_MISSING_LISTED

export async function markOrphansIfUnused(trx, userId: number, ids: string[]): Promise<void>
// update attachments set orphaned_since = now()
// where user_id = $u and id in (ids) and orphaned_since is null
//   and not exists (select 1 from note_attachments l where l.user_id = $u and l.attachment_id = attachments.id)
```

### 6.2 `notes/create` and `notes/update`

**Removing a photo is something the writer says.** Both schemas gain
`removedPhotos: z.array(z.string().max(100)).max(MAX_PHOTOS_PER_NOTE).optional()`:
"ids of photos this writer saw in this note and took out". A photo the note
had before the save, that the save neither names nor lists as removed, is put
back at the end of the note (`appendPhotos`). So:

- An editor that doesn't know photos (the main app before PR #1, the App
  Store build) and saves a note without its photo: the save lands, the typed
  text is kept, the photo comes back at the end. Nothing is refused.
- A stale writer (a web tab open for days, a second phone with an older copy
  or an offline queue) never saw a photo added since, so it can't list it
  as removed: the photo stays, at the end of the note.
- The web app saves content only (the rich text is dropped, as today):
  the tokens are in its text, so nothing changes for photos.
- A writer that really removed a photo lists it; the link goes and the photo
  is orphaned (7 days, then swept).

The cost: a restored photo moves to the end of the note, and the restoring
save changes the note the writer sees only when the note is next loaded.

**Create** (`endpoints/notes/create_POST.ts`): inside the transaction, after
the insert succeeds (not in the `!created` retry branch), call
`syncNoteAttachments(trx, user.id, created, new Set())` (a new note has no
old links). In the retry branch, compute `missing` only (one select), so the
answer is the same.

**Update** (`endpoints/notes/update_POST.ts`): inside the transaction, after
the `updateTable("notes")` statement and only when
`input.content !== undefined || input.doc !== undefined` (title, area and
archive changes skip all of this):
`syncNoteAttachments(trx, user.id, updated, new Set(input.removedPhotos ?? []))`,
and answer with the note it returns. The stored values after the update are
what's read, so the endpoint's doc rule (new words without `doc` clear it)
applies as it is.

**Output** of both: `{ note, missingPhotos: string[] }` (add `missingPhotos` to
`OutputType` in both schema files). The main app and web app ignore it. Sage
uses it to upload photos it holds that the server lacks (section 9.4).

Archiving a note keeps its links: archived notes keep their photos.

### 6.3 `notes/delete`

`endpoints/notes/delete_POST.ts` becomes one transaction:

1. `ids = select attachment_id from note_attachments where note_id = $id and user_id = $u`.
2. Delete the note as now (the links cascade). No row: 404 as now.
3. `markOrphansIfUnused(trx, user.id, ids)`.

The photos are deleted by the sweep 7 days later, unless another note names
them. The note itself is gone at once, as today.

---

## 7. Clean-up

### 7.1 The sweep: `helpers/attachmentSweep.tsx`

`export async function sweepAttachments(): Promise<SweepReport>`.

**Lease.** At the start:

```sql
insert into maintenance_leases (name, holder, held_until)
values ('attachment-sweep', $holder, now() + interval '10 minutes')
on conflict (name) do update set holder = excluded.holder, held_until = excluded.held_until
where maintenance_leases.held_until < now()
returning holder
```

No row back: another instance holds it, return. `$holder` is
`${RAILWAY_DEPLOYMENT_ID ?? "local"}:${process.pid}:${random}`. At the end (in
a `finally`), `update … set held_until = now() where name = … and holder = $holder`.
A lease row works through Neon's pooled connection, where session advisory
locks don't. An in-process `running` flag stops a slow run overlapping the
next tick; it is reset in a `finally`.

**Time budget.** Each run stops starting new batches 8 minutes after it
began (below the 10-minute lease). Each S3 call times out (section 4.2), so a
run can't hang. Work left over is done on the next run.

**Steps**, in batches of 500 (1,000 keys for the drain), each batch its own
short transaction, looping until a batch comes back short or the budget runs
out. S3 calls happen outside transactions.

1. **Expired uploads:** pending, `upload_started_at` more than 24 h ago.
   Rows a `start` has locked are skipped, and the outer delete repeats the
   conditions, so a row refreshed meanwhile isn't deleted:
   ```sql
   with picked as (
     select user_id, id from attachments
     where status = 'pending' and upload_started_at < now() - interval '24 hours'
     order by upload_started_at limit 500
     for update skip locked),
   gone as (
     delete from attachments a using picked p
     where a.user_id = p.user_id and a.id = p.id
       and a.status = 'pending' and a.upload_started_at < now() - interval '24 hours'
     returning a.storage_key)
   insert into storage_deletions (storage_key) select storage_key from gone on conflict do nothing
   ```
2. **Repair:** ready photos past their grace that a note's text still names
   (a link lost while older code ran, or a hook bug) get their links back and
   lose the mark:
   ```sql
   with found as (
     select distinct n.id as note_id, a.user_id, a.id
     from attachments a join notes n on n.user_id = a.user_id
      and (n.content like '%attachment:' || a.id || '%' or n.doc::text like '%attachment:' || a.id || '%')
     where a.orphaned_since < now() - interval '7 days' limit 500),
   linked as (insert into note_attachments (note_id, user_id, attachment_id)
     select note_id, user_id, id from found on conflict do nothing)
   update attachments a set orphaned_since = null from found f where a.user_id = f.user_id and a.id = f.id
   ```
3. **Orphans:** ready, `orphaned_since` more than 7 days ago, no link, and no
   note's text naming it. The same `picked … for update skip locked` /
   `gone` / `insert into storage_deletions` shape as step 1, with the outer
   delete repeating every condition:
   `a.status = 'ready' and a.orphaned_since < now() - interval '7 days'
   and not exists (select 1 from note_attachments l where l.user_id = a.user_id and l.attachment_id = a.id)
   and not exists (select 1 from notes n where n.user_id = a.user_id and (n.content like '%attachment:' || a.id || '%' or n.doc::text like '%attachment:' || a.id || '%'))`.
   A save that names it a moment before keeps it; a save holding its row
   lock makes the sweep skip it this run.
4. **Prefixes**, only if `bucket()` is set: `storage_deletions` rows with
   `is_prefix` and `not_before <= now()`: list the prefix page by page,
   `deleteObjects` each page; when a listing comes back empty, delete the
   row. On failure, `attempts + 1`, `last_error = error name`.
5. **Drain**, only if `bucket()` is set: object rows with `not_before <= now()`,
   oldest first: `deleteObjects`; delete the rows that succeeded;
   `attempts = attempts + 1, last_error = <error name>` on the others. A row
   with more than 20 attempts is logged once per run with `console.error`;
   it stays.
6. **Daily**, under a second lease row used as a "next due" time
   (`name = 'attachment-daily'`, taken only when `held_until < now()`, then
   set to `now() + 24 hours` and never released):
   - **Mark** ready photos that no link names (a hook missed, or older code
     deleted a note), through `attachments_unmarked_idx`:
     `update attachments set orphaned_since = now() where (user_id, id) in (select user_id, id from attachments a where status = 'ready' and orphaned_since is null and not exists (link) limit 1000)`,
     looping while batches are full. Step 3 still checks the notes' text
     before anything is deleted.
   - **Reconcile** (only if `bucket()` is set, and only in a bucket proven
     to be this database's: an id in `maintenance_leases` ('bucket-owner',
     made on the first daily pass) plus a hash of the database's place
     (host without `-pooler`, port, name) must match the JSON in the
     bucket's `meta/owner`; a bucket without that file is claimed, any other
     answer refuses the reconcile and logs an error. A forked environment or a
     local server given production's `PHOTOS_*` would otherwise queue every
     photo. Deleting `meta/owner` lets the real owner claim it again after a
     move or restore.) List `u/` page by page; for
     each page, the keys older than 24 hours that are in neither
     `attachments.storage_key` nor `storage_deletions` (one query per page,
     `= any($keys)`) are queued in `storage_deletions` (default
     `not_before`) and go in a later drain. This catches anything every other
     rule missed: rows removed by older code's cascade, a race not thought
     of. Every key the server makes is in a row from `start` until it is
     queued, so a key in neither for a day is garbage. The whole listing is
     counted before anything is queued: more than 500 strays, or more than
     20 and over 5% of the keys listed, queues nothing and logs
     `sweep: reconcile refused, N strays of M`. If the budget runs out
     the listing stops; the next day starts again from the beginning (at
     this scale one listing is a few requests).

The report (counts per step) is logged with `console.log` when anything was
done. Errors are logged by name only.

**When.** In `server.ts`, after `serve(...)`:

```ts
import { startAttachmentSweep } from "./helpers/attachmentSweep.js";
startAttachmentSweep(); // first run after 2 minutes, then every 15; timers unref()'d
```

Each tick runs only when an `/_api` request arrived since the previous run
started (`helpers/apiActivity.tsx`, set by `server.ts`'s route wrapper), so an
idle server makes no queries and Neon can suspend the database. Every photo
change arrives through a request, so work is only put off to the next active
spell; the daily pass keys off its lease row and runs on the first active run
after 24 hours.

`startAttachmentSweep` reads `ATTACHMENT_SWEEP_EVERY_MS` (default 900000) and
does nothing when it is `0` (for the tests, which call `sweepAttachments`
directly). For the checks only, `sweepAttachments` also reads
`ATTACHMENT_SWEEP_BUDGET_MS` (default 480000) and
`ATTACHMENT_RECONCILE_MIN_AGE_MS` (default 86400000), and takes
`{ daily: true }` to run the daily pass regardless of its lease row. Errors are caught and logged; they never stop the server.

The sweep uses one pool connection at a time, for short transactions only.
The pool has 3 connections (`helpers/db.tsx`).

If the service sleeps or restarts, nothing is lost: everything the sweep acts
on is in the database (or, for the reconcile pass, in the bucket).

### 7.2 Why every object is eventually deleted

- A key is made only by `start`, inside the transaction that writes its row.
- A row leaves only by `delete`, the sweep (steps 1 and 3) or account
  deletion, each of which queues the key in the same transaction.
- A queued key is deleted at the earliest 20 minutes after it was queued, and
  no link for it is signed after its row is gone. Every link lives 15
  minutes, so nothing can be PUT under a key after its last deletion.
- The cascade from `users` (older code only) and anything unforeseen is
  caught by the daily reconcile within about a day.

### 7.3 Account deletion

Move the row deletions of `endpoints/account/delete_POST.ts` into
`helpers/accountDeletion.tsx`:
`export async function deleteAccountData(userId: number): Promise<void>`. The
endpoint keeps the Clerk lookup before it and the Clerk call after it. This
also lets the checks delete a throwaway local user without touching Clerk
(section 11.2).

In the transaction, **first**:

```sql
insert into storage_deletions (storage_key)
select storage_key from attachments where user_id = $u
on conflict do nothing;
insert into storage_deletions (storage_key, is_prefix) values ('u/' || $u || '/', true)
on conflict do nothing;
delete from note_attachments where user_id = $u;
delete from attachments where user_id = $u;
```

then the existing deletions. After the transaction (still inside
`deleteAccountData`, before Clerk), if `bucket()` is set: list the prefix and
`deleteObjects` once now (in `s3Call`, waited on for at most 10 seconds
by a hard timer, since one stalled call with the SDK's retries can take 90;
failures logged and ignored), so the photos go at once in the usual case. The queue
rows stay: 20 minutes later, when every upload link another device held has
expired, the sweep lists the prefix again and deletes what landed meanwhile.
`users.id` comes from a sequence and is never reused, so the prefix belongs
to this account only. With photos off, the queue waits until they are on
again. The account deletion itself always succeeds.

### 7.4 Signing out

Nothing on the server. On the phone, see section 9.8.

---

## 8. Export and AI

### 8.1 Export

`endpoints/account/export_GET.ts`: add to the `Promise.all`:

```ts
db.selectFrom("attachments")
  .select(["id", "contentType", "bytes", "width", "height", "createdAt", "confirmedAt", "storageKey"])
  .where("userId", "=", user.id).where("status", "=", "ready").where("orphanedSince", "is", null)
  .orderBy("createdAt", "desc").execute(),
db.selectFrom("noteAttachments").select(["noteId", "attachmentId"]).where("userId", "=", user.id).execute(),
```

and to the body:

```ts
photoLinksExpireAt: b ? new Date(Date.now() + EXPORT_LINK_SECONDS * 1000) : null,
photoLinksNote: "Each photo's url downloads it until photoLinksExpireAt (one hour after the export). Export again for new links.",
photos: rows.map((row) => ({
  id, contentType, bytes, width, height, createdAt,
  noteIds: /* from noteAttachments */,
  url: b ? (await presignView(b, row.storageKey, EXPORT_LINK_SECONDS, `${row.id}.jpg`)).url : null,
})),
```

(the file extension follows `contentType`; presigning in `s3Call`). Add
`ExportedPhoto`, `photos: ExportedPhoto[]` and the two `photoLinks*` fields to
`OutputType` in `export_GET.schema.ts`, and to `AccountExport` in Sage's
`src/core/api/account.ts`. Pending photos and photos no note names any more
(orphaned) are not listed. Never put `storageKey` in the output.

Why one hour: Sage hands the export file to the share sheet
(`app/settings.tsx`, `Sharing.shareAsync`), so it can end up in mail or a
shared drive. A link in it can't be revoked; one hour is long enough to
download the photos right after exporting and short enough that a file
forwarded later shows nothing. Signing about 3,500 links (1 GB of 300 KB
photos) is local work and fast.

### 8.2 AI

`withoutAttachments` (section 6.1) is applied **at each source, before any
slicing to a budget**, and once more as a final guard:

| File | Change |
|---|---|
| `helpers/suggestNoteTitle.tsx:45` | `const text = withoutAttachments(content).trim().slice(0, MAX_NOTE_CHARS);` A note holding only a photo then gives empty text and no AI call (it returns null). |
| `helpers/extractTasks.tsx:31` | `Note text:\n"""${withoutAttachments(input.content)}"""` |
| `helpers/noteEntityIndex.tsx:133` | `const text = \`${note.title}\n${withoutAttachments(note.content)}\`.trim();` |
| `helpers/summarizeTask.tsx:93` | `const body = withoutAttachments(note.content).trim().slice(0, …);` |
| `helpers/generateSuggestions.tsx:346` | `withoutAttachments(textBeforeCursor).slice(-800)` (also the empty check above it) |
| `helpers/generateSuggestions.tsx:217` | `excerptAround(withoutAttachments(note.content), terms)` |
| `helpers/ai.tsx`, `aiChatJson` (line ~196) | first line: `opts = { ...opts, userPrompt: withoutAttachments(opts.userPrompt) };` The final guard. `aiChatJson` is the only path to a model (checked: no file imports `@google/genai`; `focusFirstSteps` sends no note text). |

Not AI, same helper:

- `endpoints/tasks/notes_GET.ts:30`: `preview: withoutAttachments(content).replace(/\s+/g, " ").trim().slice(0, PREVIEW_CHARS)`.
- `pages/_index.tsx:164` (web app list): `withoutAttachments(note.content).replace(/\s+/g, " ").slice(0, 160)`.

Hashes (`contentHash` in `noteEntityIndex.tsx:44`, `taskContentHash`) are
left as they are. Adding a photo then re-runs indexing once; that is cheap
and keeps this change small.

Search (`helpers/listNotesPage.tsx:48`) still matches "attachment" in every
note with a photo. Left as is (open question 4).

---

## 9. Sage

All paths under `/root/projects/clarity-revamp-5` (the running copy); copy to
`prototypes/revamp-5` to commit. Record every change to `src/core/**` in
`src/core/SOURCE.md` under "Local changes".

### 9.1 API wrappers

New `src/core/api/attachments.ts`, the same shape as `notes.ts`
(`apiFetch` → `parseResponse`, superjson bodies):
`getAttachmentUsage()`, `postAttachmentStart(body)`,
`postAttachmentConfirm({ id })`, `postAttachmentsView({ ids })`,
`postAttachmentDelete({ id })`, with the output types of section 5.

`src/core/api/notes.ts`: `postNoteCreate` and `postNoteUpdate` take an
optional `removedPhotos?: string[]` and return
`{ note; missingPhotos?: string[] }`. The wrappers send the body as given, with
no client-side `schema.parse` (which would strip the field against an older
schema).

### 9.2 The Photo tool in account notes

`app/note/[id].tsx`:

- Replace `ACCOUNT_TOOLS` (lines 56-57) with a check at line 615: account
  notes show the Photo tool unless `usePhotosEnabled()` is `false`.
  `usePhotosEnabled()` (new, in `src/core/hooks/useAttachments.ts`) is a query
  `["attachments-usage"]` on `getAttachmentUsage`, stale after 10 minutes,
  refetched on sign-in and when the app comes back; `"attachments-usage"` joins
  `KEPT` in `persist.ts`, so it is known offline. Unknown (first launch,
  offline) counts as on: the photo waits in the outbox.
- In `takePhoto` (lines 372-377), after `insertPhoto`, in account mode only:
  `photoLedger.add(added.id)` then
  `outbox.enqueue({ kind: "photo.upload", body: { id: added.id, width: added.width, height: added.height } })`.
  Upload starts at once; it doesn't wait for the note's save.
- Line 517: also pass `photoFetch={demo ? undefined : fetchPhoto}` (section 9.6).

Update the comments in `src/editor/photos.ts` (lines 10-12) and
`docs/editor-plan.md` section 10 ("Samples only, for now").

### 9.3 Saying which photos were removed

`src/editor/useNoteSession.ts` keeps `seenPhotosRef: Set<string>`: the photo
ids in the note as it was loaded (the cached or server copy, **not** a
restored draft), plus the ids in every Markdown it saves in this session.
Each save (`note.update` at line 317, and `note.create` never needs it)
sends `removedPhotos: [...seen].filter((id) => !named.has(id))`, where
`named` is the ids in `nextContent` (the same loose rule as the server's
`attachmentIdsInText`; a small copy in `src/editor/photos.ts`, `photoIdsIn`).
Only when the list isn't empty.

`src/core/sync/outbox.ts`, `addToQueue`: `removedPhotos` is bookkeeping like
`changedAt`:

- It never stops a fold (left out of the `fields` check).
- Folded into an unsent `note.create`, it is dropped (the server has no old
  links for that note).
- Folded into an unsent `note.update`, the two lists are **joined** (a union),
  so a removal from an earlier editing session survives a later session that
  never saw the photo. A photo removed and then put back is named by the
  newer content, and named always wins on the server.

Tests in `src/data/outbox.test.ts` cover the three cases.

### 9.4 The outbox operation `photo.upload`

**`src/core/sync/outbox.ts`:**

- `Op` gains `| { kind: "photo.upload"; body: { id: string; width?: number; height?: number } }`.
  The name ends in neither `.create`, `.update` nor `.delete`, so the fold and
  delete rules leave it alone. Its body is small (no bytes).
- `Entry` gains `photo?: { notBefore: number; failures: number; put: boolean }`,
  stored with the queue; only photo entries carry it.
- `subjectOf`: `case "photo.upload": return \`photo:${op.body.id}\`;`
  `touches` gives just that. A photo isn't tied to one note (it can be in
  several), so deleting a note doesn't drop its upload; an upload for a
  deleted note is orphaned and swept after 7 days.
- `describeOp`: `"a photo"`.
- New `export const isPhoto = (op: Op) => op.kind === "photo.upload";`
- New `photoFailure(error): { kind: "retry" | "auth" | "gone" | "reject"; waitMs?: number }`,
  used for photos instead of `classifyFailure`:

  | Answer | Kind | Wait |
  |---|---|---|
  | no connection, timeout, 5xx, 408, 429 (`RATE_LIMITED`, `TOO_MANY_PENDING`) | retry | `backoffMs(failures)` |
  | 503 `PHOTOS_UNAVAILABLE` | retry | 15 minutes |
  | 413 `QUOTA_FULL`, `PHOTO_LIMIT` | retry | 60 minutes, or sooner when `usage` shows room (9.2's query, on foreground); a toast once per session: "Your photos have used all your space. New photos stay on this phone." |
  | 404 (any: a missing route on an older server, or a row that went away) | retry | `backoffMs(failures)` |
  | 401 | auth | wait for sign-in |
  | 410 (made by `uploadPhoto`: the file isn't on this phone) | gone | dropped quietly |
  | 413 `TOO_LARGE`, 422, other 4xx | reject | dropped with the usual toast; the id stays in the ledger as `rejected` |

**`src/core/sync/store.ts`:**

- `head()` returns the oldest entry that **isn't** a photo (the main lane).
- `nextPhoto(now)`: the oldest photo entry whose `photo.notBefore <= now`
  (missing counts as 0). `nextPhotoAt()`: the earliest `notBefore` among
  photo entries, or null.
- `patchPhoto(seq, patch)`: updates an entry's `photo` and persists.
- `pendingCount(options?: { photos?: boolean })`: all entries by default;
  `{ photos: false }` counts only the rest.

**`src/core/sync/cache.ts`:** `unlessSyncing` and `pageUnlessSyncing` use
`outbox.pendingCount({ photos: false })`. A photo can't change a list, so a
waiting photo never stops lists loading.

**`src/core/sync/runner.ts`:**

- The main lane is as now (`head()` no longer returns photos). Its
  refresh-when-empty check (line 113) uses `pendingCount({ photos: false })`.
- `touchedData`: `case "photo.upload": return [];`.
- `case "note.create"` and `"note.update"` in `send`: keep the answer and
  call `queueMissingPhotos(answer.missingPhotos)`:
  ```ts
  for (const id of missing ?? []) {
    if (outbox.isPending(`photo:${id}`) || photoLedger.isRejected(id)) continue;
    if (await photoStore.has(id)) { photoLedger.add(id); outbox.enqueue({ kind: "photo.upload", body: { id } }); }
  }
  ```
  This uploads photos pasted into a note, and brings back a photo the server
  deleted while a note still had it on this phone.
- **The photo lane**, a second loop with its own `photoRunning` flag and
  `photoTimer`, never touching `running`, `rerun`, `failures` or
  `retryTimer`. `kick()` also calls `kickPhotos()`, which starts the loop if
  it isn't running and does **not** clear `photoTimer` or change any
  `notBefore`, so typing (a save every 900 ms) never makes a failing photo
  try again early. The loop, while online:
  1. `entry = outbox.nextPhoto(Date.now())`; none: set `photoTimer` for
     `nextPhotoAt()` (if any, and not set) and stop.
  2. `await uploadPhoto(entry.op.body, { put: entry.photo?.put ?? false, onPut: () => outbox.patchPhoto(entry.seq, { …, put: true }) })`.
  3. Landed: `outbox.remove(entry.seq)`, `photoLedger.remove(id)`.
  4. Failed: by `photoFailure`: retry → `patchPhoto(seq, { failures: f + 1, notBefore: now + wait, put })`;
     auth → stop until kicked; gone → remove, `photoLedger.remove(id)`;
     reject → remove, `photoLedger.reject(id)`, toast.
  One photo at a time. `markSending` isn't used for photos (nothing folds into
  a photo entry).

**`src/editor/photoUpload.ts`** (new):

```ts
class PhotoUploadError extends Error { constructor(public status: number, message: string, public code?: string) { super(message); } }

export async function uploadPhoto({ id, width, height }, progress: { put: boolean; onPut(put: boolean): void }) {
  const local = await photoStore.forUpload(id);
  if (!local) throw new PhotoUploadError(410, "not on this phone");          // gone, quietly
  let put = progress.put;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (!put) {
      let started;
      try { started = await postAttachmentStart({ id, contentType: "image/jpeg", bytes: local.bytes, width, height }); }
      catch (error) {
        if (codeOf(error) === "UPLOAD_CHANGED" && attempt === 0) { await postAttachmentDelete({ id }); continue; }
        throw error;
      }
      if (started.status === "ready") return;
      const status = await local.put(started.upload.url, started.upload.headers); // a network error throws: retry
      if (status === 403 && attempt === 0) continue;                              // link expired or refused: a fresh one
      if (status >= 500 || status === 408 || status === 429) throw new PhotoUploadError(503, `bucket ${status}`);
      if (status < 200 || status >= 300) throw new PhotoUploadError(422, `bucket ${status}`);
      put = true; progress.onPut(true);
    }
    try { await postAttachmentConfirm({ id }); return; }
    catch (error) {
      const code = codeOf(error);
      if (code === "NOT_FOUND" || code === "NOT_UPLOADED") {
        put = false; progress.onPut(false);
        if (attempt === 0) continue;                                           // start over once now
        throw new PhotoUploadError(503, "not there yet");                       // then wait
      }
      throw error;
    }
  }
  throw new PhotoUploadError(503, "the photo couldn't be uploaded yet");
}
```

(In words: a stored `put: true` means the bytes went up, so a retry tries
`confirm` first and doesn't upload the whole file again. A confirm that finds
no object or no row clears the flag and starts over once in the same try;
then it waits. `UPLOAD_CHANGED` deletes the stale pending row and starts with
a new key. `onPut` stores the flag through `patchPhoto`. `codeOf` reads the
`code` that `parseResponse` puts on its error.)

**`src/editor/photoLedger.ts`** (new): the photos added on this phone for
account notes that the server hasn't confirmed yet, so signing out can't
silently delete the only copy.

- Persisted in AsyncStorage per user: `clarity:photos-unsent:v1:<userId>`,
  a map `id → "waiting" | "rejected"`.
- `add(id)` (taking a photo, or `queueMissingPhotos`), `remove(id)` (confirmed
  or ready, or the file is gone), `reject(id)`, `isRejected(id)`,
  `count()`, `subscribe`, `useUnsentPhotos()`, `clear()`.
- Loaded with the outbox for the signed-in user (`outbox.load`'s caller in
  `SyncProvider.tsx`).

**What the person sees:**

- "All changes saved" (`AccountSource.tsx` line 322) waits for every outbox
  entry, photos included.
- The sign-out warning (`app/settings.tsx` lines 191 and 288) counts
  `pendingCount({ photos: false }) + photoLedger.count()`, and says "Some
  changes or photos haven't reached the server yet. Signing out now loses
  them." `clearOfflineData` (which deletes the photos) only runs after that
  question is answered.

**Tests** in `src/data/outbox.test.ts` (run with
`/opt/node24/bin/node src/data/outbox.test.ts`): a photo op is appended and
never folds; a `note.delete` leaves it; `head()` never returns a photo;
`nextPhoto` respects `notBefore`; `pendingCount({ photos: false })` leaves
photos out; `photoFailure` maps 410 to gone, 404 to retry, 503
`PHOTOS_UNAVAILABLE` to a 15-minute wait, 413 `QUOTA_FULL` to a 60-minute
wait, 413 `TOO_LARGE` and 422 to reject; the `removedPhotos` fold rules
(section 9.3).

### 9.5 Local store additions

`src/editor/photoStore.ts` (native) and `photoStore.web.ts` each gain:

```ts
/** The kept photo, ready to upload: its size and a PUT to a signed link (returns the HTTP status). Null when it isn't on this phone. */
forUpload(id): Promise<{ bytes: number; put(url: string, headers: Record<string, string>): Promise<number> } | null>
/** Downloads a photo from a signed link and keeps it under its id, unless clearAll ran meanwhile. */
save(id: string, url: string): Promise<void>
/** Whether a photo is kept here. */
has(id: string): Promise<boolean>
/** Forgets every kept photo (signing out), and bumps `generation`. */
clearAll(): Promise<void>
/** Bumped by clearAll. A download started before it is thrown away. */
generation(): number
```

**Native** (`expo-file-system` 57.0.7):

```ts
import { Directory, File, Paths, UploadType } from "expo-file-system";
forUpload: const file = fileOf(id); const bytes = file.exists ? file.size : null; if (!bytes) return null;
  put: async (url, headers) => (await file.upload(url, {
    httpMethod: "PUT", uploadType: UploadType.BINARY_CONTENT, headers, sessionType: "foreground",
  })).status,
save: const gen = generation; folder().create({ intermediates: true, idempotent: true });
  const part = new File(folder(), `${id}.part`); if (part.exists) part.delete();
  await File.downloadFileAsync(url, part, { idempotent: true });   // rejects on non-2xx
  if (gen !== generation) { if (part.exists) part.delete(); return; }  // signed out meanwhile
  part.move(fileOf(id));                                            // Android may leave a partial file on failure
clearAll: generation += 1; const dir = folder(); if (dir.exists) dir.delete();
```

`file.upload` resolves for any HTTP status, so `put` returns the status and
the caller decides. `sessionType: "foreground"` because a background session's
promise is lost if the app is closed, and the outbox retries anyway.
**Unverified:** that Expo Go for SDK 57 on the phone has the native upload and
download tasks. If not, use `uploadAsync(url, file.uri, { httpMethod: "PUT", uploadType: FileSystemUploadType.BINARY_CONTENT, headers })`
and `downloadAsync(url, part.uri)` from `expo-file-system/legacy` (already
used by `app/settings.tsx`). Check this first on the phone.

**Web** (IndexedDB holds `data:` strings):

```ts
forUpload: const dataUrl = await this.read(id); if (!dataUrl) return null;
  const blob = await (await fetch(dataUrl)).blob();
  return { bytes: blob.size, put: async (url, headers) => (await fetch(url, { method: "PUT", body: blob, headers })).status };
save: const gen = generation; const response = await fetch(url);
  if (!response.ok) throw Object.assign(new Error("download"), { status: response.status });
  const blob = await response.blob();
  const dataUrl = await new Promise<string>((resolve, reject) => { const r = new FileReader();
    r.onload = () => resolve(String(r.result)); r.onerror = () => reject(r.error); r.readAsDataURL(blob); });
  if (gen !== generation) return;
  await inStore("readwrite", (store) => store.put(dataUrl, id));
clearAll: generation += 1; await inStore("readwrite", (store) => store.clear());
```

Both requests go to the bucket's host, cross-origin: the bucket's CORS must
allow the page's origin (section 12, step 4). In Playwright checks, a
`context.route` on the bucket host can add the headers instead.

### 9.6 Showing a photo this device doesn't have

**`src/editor/photos.ts`**: export `isPhotoId` (line 24) and add:

```ts
/** A photo from the server, kept here once fetched; null if the server hasn't got it, or there's no connection. */
export async function fetchPhoto(id: string): Promise<string | null>
```

- `!isPhotoId(id)`: null, without asking the server.
- Same-id calls share one promise (an in-flight map).
- Ids asked within 25 ms go in one `postAttachmentsView` call (a small
  batcher, at most 100 ids).
- For each `url`: `await photoStore.save(id, url)`, then `photoStore.read(id)`,
  then `remember(id, src)` and return it, unless the generation changed
  meanwhile (then null, nothing kept). Any failure: null.
- `forgetPhotos()` empties `recent` and bumps the same generation (for
  sign-out); `remember` drops a result from an older generation.

**`src/editor/bridge.ts`**: `NoteEditorProps` gains
`photoFetch?: (id: string) => Promise<string | null>`. The `needPhotos` case
becomes two waves:

1. Look each id up locally (`photoSource`) as now. Send one `photos` message
   with every id found, plus, when there is no `photoFetch`, the nulls.
2. For each id not found, when there is a `photoFetch`: call it, and send
   `{ type: "photos", sources: { [id]: src } }` (src or null) as each one
   answers.

The page (`editor/main.ts`) already works with this: an id left out of an
answer stays "asked", holding its shape as an empty box; the note counts as
shown after the 400 ms fallback; a later `photos` message draws it, or turns
it into the quiet outline if null. No page change is needed.

**Offline or not uploaded yet:** the outline, as for any missing photo. The
page doesn't ask again while it is open. Leaving and opening the note again
tries again. (A retry on reconnect is open question 3.)

### 9.7 Ordering, said plainly

- A note may reach the server before its photo. Other devices show an
  outline until the upload lands, then the photo the next time the note opens.
- A photo may reach the server before its note (the two lanes run side by
  side). Confirm then marks it orphaned, and the note's save clears the mark.
  The 7 days cover even a long offline spell.
- A slow photo never delays a note or task save: they are in different lanes.

### 9.8 Signing out and deleting the account

`src/core/sync/persist.ts` `clearOfflineData`: add `photoStore.clearAll()`,
`forgetPhotos()` and `photoLedger.clear()` to the `Promise.all`. Both sign-out
and account deletion go through it, after the warning of section 9.4. This
also clears sample photos; the samples aren't kept across a restart anyway,
so their photos were already orphans.

---

## 10. The main app and the web app

### 10.1 Main app (`mobile/`)

- Nothing breaks: the new answer field is ignored, and a save that drops a
  photo is not refused; the server puts the photo back at the end of the
  note. Older builds (Clarity Dev on `dev-build-editor-lab`, the App Store
  build) keep every word they type.
- The editor from PR #1 keeps photos and shows each as an outline. Until it
  sends `removedPhotos`, deleting an outline there doesn't stick: the photo
  comes back at the end of the note. Adding `removedPhotos` to
  `mobile/src/api/notes.ts` `postNoteUpdate` (and the same seen-minus-named
  rule in its note screen) fixes that; it can ship in any later build.
- Showing real photos is a later step: the same `fetchPhoto` idea, with
  `NotePhoto` drawing them.

### 10.2 Web app (`pages/`, served by the same deploy)

- `pages/note.$noteId.tsx` (save at line 164): keep `seenPhotos`, the ids in
  the loaded content plus every saved content; send
  `removedPhotos: seen − ids(nextContent)` when it isn't empty. The web app's
  `postNoteUpdate` parses with the server's own schema
  (`endpoints/notes/update_POST.schema.ts`), which gains the field in the
  same deploy, so nothing is stripped. A stale tab never saw a photo added
  elsewhere, so it can't remove it.
- `pages/_index.tsx:164`: preview through `withoutAttachments`.
- `pages/note.$noteId.tsx:200` (`textBeforeCursor`) needs nothing: the server
  strips it.
- Not changed here: the web app saves every note it opens (dropping the rich
  text and moving `updatedAt`), and a stale tab can save over newer words.
  Photos are now safe from both; words are not, as today (open question 2).

---

## 11. Tests

Nothing in this section writes to production. The local stack is the real
`server.ts` with a local database and a local S3; only Clerk is production's,
and only read (token checks, `users.getUser`).

### 11.1 Local stack

Keep the scripts in `tests/photos/` with their own `package.json` (so the
root's dependencies don't change):
`@electric-sql/pglite@0.5.8`, `postgres@3.4.9`, `@aws-sdk/client-s3@3.1148.0`,
`playwright-core` (or reuse `prototypes/revamp-5/tests/checks/node_modules`).

1. **Postgres:** PGlite behind the batching socket server. Copy
   `/tmp/photos-lab/pg-batch-server.mjs` to `tests/photos/pg-batch-server.mjs`.
   The published `pglite-socket` mixes up results after an error and can't
   serve the server's 3-connection pool; this one was checked with the
   server's exact settings (0 wrong results in 2,000 mixed queries).
   ```bash
   cd tests/photos && PORT=55432 /opt/node24/bin/node pg-batch-server.mjs &
   /opt/node24/bin/node migrate.mjs     # applies 001, 002, 004…017 in order over one connection (003 fails on a fresh database: 001 already has its constraints)
   ```
   `DATABASE_URL=postgres://postgres@localhost:55432/postgres`. It must say
   `localhost`, not `127.0.0.1`: `helpers/db.tsx` turns SSL off only for
   `localhost`. The database is one session: code that queries through `db`
   while its own transaction is open would hang here (it would not on Neon).
   Every helper in this design takes `trx`. **PGlite can't test concurrency**
   (one session runs one statement at a time), so the race checks in 11.5
   need a real Postgres.
2. **S3:** versitygw v1.8.0 (MinIO's binaries are gone: 410; s3rver checks no
   signatures).
   ```bash
   mkdir -p /tmp/s3lab/vgw && cd /tmp/s3lab/vgw
   curl -sSfL -o vgw.tgz https://github.com/versity/versitygw/releases/download/v1.8.0/versitygw_v1.8.0_Linux_x86_64.tar.gz
   tar xzf vgw.tgz && mv versitygw_v1.8.0_Linux_x86_64/versitygw . && rm -rf vgw.tgz versitygw_v1.8.0_Linux_x86_64 && mkdir -p data
   ROOT_ACCESS_KEY=labkey ROOT_SECRET_KEY=labsecret123 ./versitygw --port 127.0.0.1:7070 --region auto posix /tmp/s3lab/vgw/data &
   ```
   `tests/photos/bucket-setup.mjs` creates bucket `clarity-photos-local` and
   sets CORS: origins `http://localhost:8090`, methods `GET, PUT`, headers
   `content-type`.
3. **Server** (`tests/photos/run-server.sh`): Clerk's two keys are read at run
   time and passed only to the process. They are never printed or written to
   a file. `env -i` keeps every other production variable out, so the local
   server can't reach production's database or OpenRouter:
   ```bash
   CLERK_VARS=$(cd /root/projects/clarity && railway variables --service clarity-notes --environment production --kv \
     | grep -E '^(CLERK_SECRET_KEY|CLERK_PUBLISHABLE_KEY)=')
   cd /root/projects/clarity-revamp-5-ux
   env -i PATH="/opt/node24/bin:$PATH" HOME="$HOME" $CLERK_VARS \
     PORT=3399 DATABASE_URL=postgres://postgres@localhost:55432/postgres \
     PHOTOS_BUCKET=clarity-photos-local PHOTOS_ACCESS_KEY_ID=labkey PHOTOS_SECRET_ACCESS_KEY=labsecret123 \
     PHOTOS_ENDPOINT=http://127.0.0.1:7070 PHOTOS_REGION=auto PHOTOS_PATH_STYLE=1 \
     ATTACHMENT_SWEEP_EVERY_MS=0 \
     node node_modules/.bin/tsx server.ts
   ```
   (Clerk keys are base64-like with no spaces, so word splitting is safe.
   There is no `.env` or `env.json` in this worktree; keep it that way.)
4. **Sage's web build against it:** a second web proxy,
   `PORT=8090 API=http://localhost:3399 node scripts/web-proxy.mjs` (run from
   `/root/projects/clarity-revamp-5`; Metro on 8087 stays as it is). The page
   then sends `/_api` to the local server, same-origin. Photo bytes go from the
   browser to `127.0.0.1:7070`, allowed by step 2's CORS.
5. **A token:** sign in at `http://localhost:8090` as the test account
   (`set -a && . /root/.config/clarity-sage-test.env && set +a`;
   `clarity-sage+clerk_test@example.com`, code 424242), the same steps as
   `note-open.mjs`. Get a fresh token per request with
   `page.evaluate(() => window.Clerk.session.getToken())` (tokens last about a
   minute). The local server makes the test account's `users` row in the
   local database on the first request. The user's own items ("Good boy",
   three "Dr Lee" tasks, one note) live only in production and can't be
   reached from here.

### 11.2 Integration checks: `tests/photos/api-check.mjs`

Against `http://localhost:3399` with the token; reads the local database and
bucket directly to check what happened. A second user is a row inserted
straight into the local `users` table (`clerk_id 'local-other'`) with its own
attachments; it never signs in. Where a check needs time to pass, it moves
timestamps in the local database (`upload_started_at`, `orphaned_since`,
`not_before`) instead of waiting.

1. `usage`: `enabled: true`, 0 used.
2. `start`: pending, a link; the link has `X-Amz-SignedHeaders` with
   `content-length` and `content-type`; a row with a key under `u/<id>/`.
3. PUT the right bytes: 200. PUT one byte more or less: 403. PUT as
   `text/html`: 403.
4. `confirm` before any PUT: 409 `NOT_UPLOADED`. After: ready, `confirmedAt`
   set, `orphanedSince` set (no note names it).
5. `start` again for a ready photo: `status: "ready"`, no link. `confirm`
   again: same answer.
6. **Old links can't grow a photo:** `start(X, 10 MB)` gives L1;
   `start(X, 1 byte)`: 409 `UPLOAD_CHANGED`, the row still says 10 MB. PUT
   10 MB through L1 and confirm: ready at 10 MB; the bucket object's size
   equals the row's. `start(X)` again with the same values: the same key.
7. `start` with `bytes` over 10 MB: 413 `TOO_LARGE`. Bad id (`../x`, 7
   characters, 65 characters): 400.
8. Limits: set the user's `bytes` sum to just under 1 GB in the database; a
   start over it: 413 `QUOTA_FULL`; restarting an existing pending id doesn't
   count it twice. 20 pending rows: a 21st new id gives 429
   `TOO_MANY_PENDING`, a restart of one of the 20 works. 10,000 rows (inserted
   directly): a new id gives 413 `PHOTO_LIMIT`. 61 `start` calls in a minute:
   the last gives 429 `RATE_LIMITED`.
9. `view`: a link for ready photos (GET 200, same bytes); `null` for pending,
   unknown, malformed (`abc`, `../x`) and the other user's ids, while the
   valid ids in the same call still get links; 101 ids: 400; the link fails
   after its expiry (sign one with 1 s in a direct helper call).
10. Cross-user: the other user's id through `confirm` and `delete`: 404 and
    `{ deleted: true }` with the other row untouched. Starting the same id as
    the other user: a separate row and key.
11. Note save hook: create a note naming two photos (one in Markdown, one only
    in the doc): two links; `missingPhotos` lists the one not uploaded. Update
    with one removed and listed in `removedPhotos`: one link, the removed
    photo gets `orphanedSince`. Name it again: mark cleared. The same photo
    in two notes; remove it from one: not marked. A save naming 201 ids: 200,
    the words kept, links for the first 200 only.
12. **Saves that don't say they removed a photo** (no text is ever refused):
    - an old-client save (content without the token, no `removedPhotos`,
      as `mobile/src/api/notes.ts` sends today): 200; the stored content
      ends with `![](attachment:<id>)`, the doc (if any) ends with the image
      node, the link stays, the typed words are there;
    - a web-app content-only save (`doc` null) of a note with a photo, token
      kept: the link stays, nothing appended;
    - a stale second-device save (older content without a photo added since,
      `removedPhotos` naming a different photo): the newer photo comes back,
      the listed one goes;
    - a title-only update and an archive: links kept, nothing appended.
13. Note delete: links gone; a photo only that note named is marked; one
    another note names is not.
14. `delete`: a photo a link names: 409 `IN_USE`; a photo with no link but
    named in a note's text: 409 `IN_USE`. Unnamed: row gone, object gone, a
    `storage_deletions` row with `not_before` about 20 minutes ahead. Again:
    `{ deleted: true }`. A pending photo a note names: deleted.
15. **A link used after delete:** `start` (link L), `delete`, then PUT through
    L: the object exists, its queue row is still there. Move `not_before` into
    the past and run the sweep: the object is gone, the row is gone.
16. Sweep (`tests/photos/sweep-check.ts`, run with tsx and the same
    variables, calling `sweepAttachments()`): pending 25 h old: row gone,
    object gone after the drain. Orphan 8 days old: gone. Orphan 6 days old:
    kept. Orphan 8 days old that a note names again: kept. **Orphan 8 days
    old with no link but named in a note's content (a save that skipped the
    hook, as during a rollback): kept, and its link rebuilt (step 2).** A key
    in `storage_deletions` while the bucket is stopped: `attempts` 1, row
    kept; bucket back: gone. A key not yet due: kept. Daily pass: a ready
    photo with no link gets marked; an object under `u/` with no row and no
    queue row, older than 24 h (LastModified can't be faked: write it, then
    run the daily pass with its age threshold set to 0 through
    `ATTACHMENT_RECONCILE_MIN_AGE_MS=0`), is queued and then deleted. A run
    with the budget set to 0 does nothing and releases the lease.
17. Account deletion: **only through `deleteAccountData(userId)` on a
    throwaway local user** (rows and objects made for it in the check). Never
    call `/_api/account/delete` in a check: it deletes the Clerk user, and
    the test account is shared with the user's own items. After: no rows for
    the user, nothing under `u/<id>/`, including an object with no row; a
    prefix row in `storage_deletions`. Then **a PUT landing after the
    listing** (a link signed before the deletion): move `not_before` into the
    past, sweep: nothing under the prefix, the prefix row gone.
18. Export: `photos` lists ready photos a note names, with `noteIds`; an
    orphaned one is absent; each `url` downloads the bytes with
    `Content-Disposition: attachment`; the link's `X-Amz-Expires` is 3600;
    `photoLinksExpireAt` is set; pending ones are absent; no `storageKey`
    anywhere in the body.
19. AI cleaning (`tests/photos/ai-clean.ts`, tsx, in-process with
    `OPENROUTER_API_KEY=fake` and `globalThis.fetch` replaced to capture
    request bodies and answer with canned JSON): `suggestNoteTitle`,
    `extractTasks`, `summarizeTask`, `noteEntityIndex` (local database),
    `generateSuggestions` (text before the cursor and related excerpts): no
    captured body contains `attachment:`. A note holding only a photo makes no
    title call. Unit cases for `withoutAttachments`, `attachmentIdsOf`
    (broken token, image in a list item, double-encoded doc) and
    `appendPhotos` (empty content, null doc, a doc).
20. **The bucket down:** stop versitygw. `confirm`: 503 `PHOTOS_UNAVAILABLE`,
    and the body contains neither `127.0.0.1`, `7070` nor the bucket name;
    the server log has only the error name and status. `start` (presigning is
    local) still works. A sweep run ends within its budget and releases the
    lease.
21. Photos off: restart the server without the `PHOTOS_*` variables. It
    starts; `notes/list`, `create`, `update` work and still write links;
    `usage` says `enabled: false`; `start`, `confirm`, `view`: 503
    `PHOTOS_UNAVAILABLE`; `delete` works; export has `url: null`; the sweep
    queues but doesn't drain.
22. The existing checks still pass against the local server where they can
    (`API=… api-check.mjs`), and `npm run typecheck` shows no errors outside
    `mobile/` (`grep -v '^mobile/'`).
23. **The main app's outbox against the new server:** the main app's own
    `postNoteUpdate` body shape (from `mobile/src/api/notes.ts`, no
    `removedPhotos`) for a note holding a photo, with words added and the
    token kept, then with the token gone: both 200, the words kept, the photo
    kept (appended the second time).
24. **The rebuild script** (`scripts/rebuild-note-attachments.ts`, section
    12): delete every link in the local database, run it, and the links
    match `attachmentIdsOf` over every note's content and doc.

### 11.3 Sage web-build check: `tests/checks/photo-account.mjs`

At `http://localhost:8090` (section 11.1, step 4), signed in as the test
account, against the local server. Writes only "Sage check" notes, in the
local database.

1. A new page, "Sage check: photo". The Photo tool is there. Choose a file
   (`page.waitForEvent("filechooser")`, as `photo-flow.mjs`).
2. The photo shows at once (drawn from IndexedDB).
3. The outbox empties; the local database has the note with one link and the
   photo `ready`; the bucket has the object; the ledger is empty.
4. "Another device": clear IndexedDB `clarity-photos` and reload; open the
   note: the box holds its shape, then the photo is drawn (the `img` has a
   natural width), fetched from the server and now kept in IndexedDB.
5. **A slow upload holds nothing back:** route PUTs to the bucket host
   through Playwright with a 10-second delay. Add a photo, then type words.
   The note's new words are in the local database (checked by query) while
   the PUT is still held. Release it: the photo lands.
6. **Typing doesn't hurry a failing photo:** answer `start` with 503 for a
   while. Type for 20 seconds (a save every 900 ms). `start` is called at the
   backoff times only (count the calls), not on every save. Notes saved
   meanwhile land.
7. **Lists refresh while a photo fails:** with `start` still failing, change
   a note's title straight in the local database (another device), open the
   notes list (or pull to refresh): the new title shows.
8. Offline (`context.setOffline(true)`): add a second photo; it shows; the
   note page works; nothing reaches the server. Online: it uploads.
9. Remove a photo (Backspace twice), leave: the save carries `removedPhotos`
   with its id; its `orphanedSince` is set; it isn't appended back.
10. Photos off (`usage` answered with `enabled: false` through Playwright):
    after a reload, the Photo tool isn't there.
11. Sign out with a photo still waiting (`start` failing): the warning
    names unsent photos. Accept: IndexedDB `clarity-photos` is empty. A
    download held in flight across the sign-out writes nothing back.
12. Delete the check note from its menu: links gone; the photos marked.

### 11.4 Phone

On the user's phone, with the user's OK, after go-live: take a photo and
choose one in an account note; see it on the web build (another device);
open a note with several photos; airplane mode, add a photo, back online.
First, confirm that `File.upload` and `File.downloadFileAsync` exist in Expo
Go (section 9.5).

### 11.5 Races, on a real Postgres (needs the user's OK)

PGlite runs one statement at a time, so these pass there without proving
anything. They need a real Postgres: either an empty Neon branch made for the
check and deleted after (not production's data, but in the user's Neon
project), or `embedded-postgres` from npm (Postgres binaries in
`node_modules`, no apt). Open question 1.

**Run 2026-10-09** (the user chose `embedded-postgres`, tests only): Postgres
17.10 from npm in a throwaway folder outside the repo, deleted after;
`tests/photos/race-check.mjs` against the real server on it. Each race runs
in modes: both sides fired at once (the sweep loaded beforehand), and
"gated", where a test-only trigger pauses one side inside its transaction at
a chosen write while the other runs into it. Five runs, 28 rounds per mode,
all passed; removing `start`'s user lock, or the sweep's `skip locked` and
repeated conditions, made the checks fail, so they can catch these bugs.
`api-check.mjs` (with `sweep-check.ts` and `ai-clean.ts`) also passed there.
No server change was needed.

- Two `start`s at once for different ids that together pass the quota: one
  succeeds.
- A save that names an orphan while the sweep deletes it: either the save
  wins (row kept, mark cleared) or the sweep wins and the save's
  `missingPhotos` lists the id; never both lost.
- A `start` refreshing a pending row while the sweep expires it: either the
  row survives with its key, or `start` makes a new row with a new key and
  the old key is queued.
- `confirm` while the sweep deletes the row: `NOT_FOUND`, no ready row
  without an object.
- Two sweeps at once: one does the work (lease).
- Two note saves at once on the same note: the links match the note that
  committed last.

---

## 12. Go-live, in order

Each step needs the user's OK. Railway commands run from `/root/projects/clarity`
(the linked directory). Never run `railway bucket credentials`, and never print
variable values.

1. **Create the bucket** `clarity-photos` in project clarity-notes,
   environment production (dashboard, or `railway bucket create`). Choose
   the region nearest the service (`railway status` shows it). Check:
   `railway bucket list --json` shows it.
   *Undo:* delete the bucket (restorable for 52 hours).
2. **Attach its variables** to clarity-notes (section 4.1), with
   `--skip-deploys` or in the dashboard (its autocomplete makes the
   references). Check names only:
   `railway variables --service clarity-notes --environment production --kv | cut -d= -f1 | grep PHOTOS_`.
   Read the bucket's Credentials tab: if it says path-style, also set
   `PHOTOS_PATH_STYLE=1`.
   *Undo:* `railway variable delete` for each `PHOTOS_*`. The server then has
   photos off, and Sage hides the Photo tool once it reads `usage`.
3. **Apply 017.** `prototypes/revamp-5/tests/checks/apply-017.mjs`, modelled
   on `apply-014.mjs`, but reading
   `/root/projects/clarity-revamp-5-ux/migrations/017_attachments.sql`:
   - `--check`: prints the state (which of the four tables exist; link count;
     notes whose content or doc names `attachment:`) and changes nothing.
   - default: runs the file (its own `BEGIN`/`COMMIT`, over `max: 1`), then
     prints the state again and fails loudly unless all four tables exist and
     the link count equals the count of distinct (note, id) pairs in note
     content and doc.
   - `--rollback`: refuses unless `attachments` and `storage_deletions` are
     empty **and** the live server answers 404 to `GET /_api/attachments/usage`
     signed out (the code that writes `note_attachments` isn't deployed; a
     401 means it is, and dropping the table would make every note save
     fail). Then drops the four tables in one transaction.
   Run: `railway run --service clarity-notes --environment production node <path>/apply-017.mjs --check`, then without `--check`.
   It only adds tables, so the running server (older code) is unaffected.
   *Undo:* `--rollback`, before step 6.
4. **Bucket CORS** (for Sage's web build only):
   `tests/checks/bucket-cors.mjs` through `railway run`: `PutBucketCors` with
   origins `http://localhost:8087`, `http://localhost:8089`,
   `http://localhost:8090` and the current tunnel address
   (`/tmp/sage-web-url.txt`), methods `GET, PUT`, header `content-type`; then
   `GetBucketCors` to show it. If Railway's bucket doesn't keep it, the web
   build's photos work only in checks that add the headers in Playwright; the
   phone doesn't need it (open question 5).
   *Undo:* `DeleteBucketCors`.
5. **Sage sends `removedPhotos`** (section 9.3 and the `notes.ts` wrapper
   change) in the running copy, before the server: the server running now
   (4f947109) strips unknown fields, so it is harmless there, and from the
   first deploy of the new server Sage's removals stick. The Photo tool stays
   hidden in account notes.
6. **Deploy the server** with the repo's procedure: commit on `revamp-5-ux`,
   `git archive HEAD` into `/root/projects/clarity-deploy`, then
   `railway up /root/projects/clarity-deploy --ci --project bd49cfaa-… --environment production --service clarity-notes`.
   First run `npm install` so `package-lock.json` has the two `@aws-sdk`
   packages. Check: `/` 200; `/_api/notes/list` and `/_api/attachments/usage`
   401 signed out; the build log shows no errors; the deploy log shows
   "Running at" and, within 2 minutes, no sweep error.
   *Undo:* redeploy the previous deployment (4f947109 at the time of
   writing) from the dashboard. While the old code runs, saves write no
   links, its account deletion leaves objects to the cascade, and a note
   deleted there leaves its photos unmarked. Nothing is lost: the sweep (back
   with the new code) reads the notes' text before deleting, and the daily
   pass marks and reconciles. **When rolling forward again, run
   `scripts/rebuild-note-attachments.ts`** through `railway run` (it rebuilds
   every link from every note's content and doc with `attachmentIdsOf`, in
   batches, and prints counts), so links are exact again.
7. **End-to-end with the test account:** `tests/checks/photo-live.mjs`,
   Sage's web build on 8087 against the live server (CORS for `/_api/**` as
   the other account checks, and for the bucket host too if step 4 didn't
   take). It writes only a "Sage check: photo" note:
   - `usage`: `enabled: true`;
   - add a photo, wait for "All changes saved"; `view` gives a link that
     downloads it;
   - a fresh browser context (empty IndexedDB) opens the note and draws the
     photo;
   - delete the note; `delete` for the photo (no note names it now) removes
     it; `view` gives null.
   It never touches "Good boy", the three "Dr Lee" tasks or the user's note,
   and it refuses to run unless the address contains `+clerk_test@`. If it
   crashes, `clean-test-account.mjs` removes "Sage check" notes; a leftover
   photo is swept within 7 days.
8. **Sage:** the photo lane, ledger and Photo tool in account notes (section
   9) in the running copy; Metro picks it up. The user's phone test (section
   11.4). Then copy into `prototypes/revamp-5` and commit.
   *Undo:* hide the tool again. Photos already uploaded stay and keep
   showing on devices that have them.
9. **Main app:** `removedPhotos` in `mobile/`, in any later build. No server
   step. Until then a photo deleted in the main app comes back at the end of
   the note.

---

## 13. Files touched

**Server and web app** (this worktree):

- new: `migrations/017_attachments.sql`, `helpers/bucket.tsx`,
  `helpers/attachmentLimits.tsx`, `helpers/rateLimit.tsx`,
  `helpers/attachmentRefs.tsx`, `helpers/noteAttachments.tsx`,
  `helpers/attachmentSweep.tsx`, `helpers/accountDeletion.tsx`,
  `helpers/apiActivity.tsx` (when the last API request came, for the sweep),
  `endpoints/attachments/{usage_GET,start_POST,confirm_POST,view_POST,delete_POST}.ts` and `.schema.ts`,
  `scripts/rebuild-note-attachments.ts`
- changed: `package.json` (+ lock), `server.ts` (routes, sweep start),
  `helpers/schema.tsx`, `helpers/endpointError.tsx`,
  `endpoints/notes/{create,update,delete}_POST.ts` and the create and update
  schemas, `endpoints/account/{delete_POST,export_GET}.ts` and the export
  schema, `endpoints/tasks/notes_GET.ts`, `helpers/{ai,suggestNoteTitle,extractTasks,noteEntityIndex,summarizeTask,generateSuggestions}.tsx`,
  `pages/_index.tsx`, `pages/note.$noteId.tsx`
- later, own build: `mobile/src/api/notes.ts` and its note screen
  (`removedPhotos`)

**Sage** (`/root/projects/clarity-revamp-5`, then `prototypes/revamp-5`):

- new: `src/core/api/attachments.ts`, `src/core/hooks/useAttachments.ts`,
  `src/editor/photoUpload.ts`, `src/editor/photoLedger.ts`
- changed: `app/note/[id].tsx`, `app/settings.tsx` (sign-out warning),
  `src/editor/{photos,photoStore,photoStore.web,bridge,useNoteSession}.ts`,
  `src/core/sync/{outbox,store,runner,cache,persist,SyncProvider}.ts(x)`,
  `src/core/api/{notes,account}.ts`, `src/data/outbox.test.ts`,
  `src/core/SOURCE.md`, `docs/editor-plan.md`, `tests/checks/README.md`

**Test stack:**

- `tests/photos/` (this worktree): `package.json`, `pg-batch-server.mjs`,
  `migrate.mjs`, `bucket-setup.mjs`, `run-server.sh`, `api-check.mjs`,
  `sweep-check.ts`, `ai-clean.ts`, and `race-check.mjs` (11.5, real Postgres)
- `tests/checks/` (Sage): `photo-account.mjs`, `photo-live.mjs`,
  `apply-017.mjs`, `bucket-cors.mjs`

---

## 14. Open questions and risks

**Questions for the user**

1. **A real Postgres for the race checks (11.5).** PGlite can't run two
   statements at once. Either an empty Neon branch, made for the check and
   deleted after (in the production Neon project, but not production's
   data), or `embedded-postgres` from npm (Postgres binaries inside
   `node_modules`; not apt). Which, if either? Without one, the race rules
   are reviewed but not exercised.
   *Answered 2026-10-09: `embedded-postgres`, tests only. Run, all passed (11.5).*
2. **The web app** saves every note it opens (the rich text is dropped, so
   photo sizes go) and a stale tab can save over newer words. Photos are now
   safe from both. Fix the save-on-open now (skip a save when nothing
   changed), or leave it?
3. **A photo that arrives while its note is open elsewhere** shows only when
   the note is opened again. Retry missing photos on reconnect, or when the
   upload lands?
4. **Search** matches "attachment" in every note with a photo. Leave it, or
   search the text without photo links?
5. **Sage's web build and bucket CORS.** If Railway's bucket doesn't keep a
   CORS rule (step 4), photos can't upload or show in Sage's web build (the
   phone is unaffected). Hide the Photo tool on the web build in that case,
   or accept it?

**Risks, unverified until a real bucket exists**

- That Tigris enforces the signed `Content-Length` and `Content-Type` on a
  presigned PUT (checked only on versitygw). Confirm still checks size and
  type, and `UPLOAD_CHANGED` means every link for a key signs the same size.
- How Tigris treats the SDK's checksum parameters (avoided with
  `requestChecksumCalculation: "WHEN_REQUIRED"`).
- Whether `PutBucketCors` takes effect on a private Railway bucket.
- The variable-reference form for a bucket (`${{clarity-photos.BUCKET}}`) and
  whether a new bucket is virtual-hosted. The dashboard's autocomplete and
  the Credentials tab settle both.
- Read-after-write for confirm's HEAD. Handled: `NOT_UPLOADED` is retried.
- That Expo Go for SDK 57 has `File.upload` and `File.downloadFileAsync`
  natively. The legacy API is the fallback.
- That SDK 3.1148.0 takes `requestHandler` as a plain options object
  (fallback in section 4.2).

**Risks in the design**

- Last write still wins for words between devices. Photos no longer lose to
  it: a photo a writer didn't remove comes back, at the end of the note.
- A photo restored by the server shows on the writer's device only when the
  note is next loaded, and sits at the end, not where it was.
- A photo pasted from a sample note into an account note uploads only if
  this device still has its file; otherwise it is an outline everywhere.
- The sweep's text check (`like '%attachment:<id>%'`) reads the user's notes
  for each candidate. Fine at this scale (one user, hundreds of notes); if
  accounts grow to tens of thousands of notes, revisit.
- The rate limit is per instance and in memory: a restart resets it, and
  two instances would each allow 60. It is a brake against scripts, backed
  by the row and pending limits in the database.
- The local database (PGlite) is a single session. A future helper that uses
  `db` inside its own transaction would hang in the checks (not in
  production), which shows up as a timeout.

---

## 15. Decisions after review (2026-10-09)

What changed from the first version of this design, and why.

| # | Change | Why (review item) |
|---|---|---|
| 1 | `start` on a pending row with another size or type answers 409 `UPLOAD_CHANGED`; the client deletes and starts again. Check 11.2.6. | An old link signed for 10 MB could be used after a re-start at 1 byte: 10 MB stored, 1 byte counted (security 1, blocker). |
| 2 | `storage_deletions.not_before` (20 minutes ahead by default); the queue row stays after an immediate delete; account deletion queues a prefix job that lists again later; a daily bucket reconcile. Section 7.2 says why every object is eventually deleted. Checks 11.2.15, 11.2.17. | A PUT through a still-valid link after `delete` or account deletion left an object nothing would ever delete (security 2, integrity 8). |
| 3 | Limits: 20 pending, 10,000 photos per account, 60 `start`/`confirm` a minute, 200 photos per note, `missingPhotos` capped at 100. Partial index for the mark pass, which now runs daily; sweep batches loop to an 8-minute budget instead of a fixed count. | Rows of 1 byte, scripted starts and huge notes could bloat the database and outrun the sweep (security 3, 9). |
| 4 | Export links last 1 hour (not 7 days), the file says until when, and orphaned photos are left out. No separate download endpoint: a link that needs sign-in can't be used from the exported file. | The export goes through the share sheet; 7-day unrevocable links in it were too much (security 4). |
| 5 | Every bucket call goes through `s3Call`: logged by name and status only, answered 503 `PHOTOS_UNAVAILABLE`. Check 11.2.20. | SDK messages leaked the host and bucket, and the generic 400 made Sage drop photos for good (security 5). |
| 6 | S3 client timeouts and 3 attempts; the sweep's `running` flag and lease are released in `finally`; an 8-minute budget per run. | One hung call stopped the sweep until a restart (security 6, integrity 10). |
| 7 | Sage hides the Photo tool when `usage.enabled` is false; `PHOTOS_UNAVAILABLE` waits 15 minutes between tries. | With photos off, every device retried every minute and "All changes saved" never showed (security 7). |
| 8 | `fetchPhoto` returns null for malformed ids without asking; `view` answers null for them instead of failing the batch. | One broken token blanked every photo in its batch (security 8). |
| 9 | Photos have their own lane in the runner, with a stored `notBefore` that typing can't reset, and a stored `put` flag so a retry confirms before uploading again. List fetches and the runner's refresh ignore photos (`pendingCount({ photos: false })`). Checks 11.3.5-7. | One stuck photo stopped every list refreshing, a slow PUT held back note saves, and every keystroke retried a failing photo (integrity 1 and 2, blocker). |
| 10 | Photo 404 is retried (only Sage's own 410 is "gone"); quota answers wait an hour and toast once; a persisted ledger of unconfirmed photos feeds the sign-out warning, so `clearAll` never silently deletes the only copy. | Photos were dropped without a word, then wiped at sign-out (integrity 3). |
| 11 | `keepsPhotos` and the 409 `KEEPS_PHOTOS` guard are gone. Writers list `removedPhotos`; a photo the note had that a save neither names nor removes is put back at the end. Links are read after the update, under the note's row lock. Checks 11.2.11-12 and 11.2.23. | `keepsPhotos` said what a client could do, not what the writer did: stale writers removed photos they never saw, old clients lost whole saves, and the guard could race (integrity 5). |
| 12 | Before deleting a photo, the sweep (and `delete`) also reads the notes' own text; a repair step rebuilds lost links; the migration's backfill reads `doc` too; a rebuild script for after a rollback; the step 6 undo text says this. Check 11.2.16, 11.2.24. | Links drift while older code runs or after a hook bug, and the sweep trusted them alone (integrity 4). |
| 13 | Sage ships `removedPhotos` before the server (step 5); `--rollback` refuses while the new code is live. | Deploy order could drop saves or break every note save (integrity 6). With item 11 there is no 409 left to hit. |
| 14 | The sweep selects with `for update skip locked` and repeats every condition on the delete; `start` locks the photo's row; `confirm` updates only `where storage_key = $key` and answers `NOT_FOUND` when nothing changed. | A row a save or start was changing could be deleted anyway, and confirm could mark a row ready with no object (integrity 7). |
| 15 | A generation counter in `photoStore` and `photos.ts`, bumped at sign-out; a download that finishes afterwards writes nothing. Check 11.3.11. | The previous user's photo could be written back after sign-out (integrity 9). |
| 16 | Race checks move to a real Postgres (11.5), pending the user's choice; missing checks added (lists during a failing photo, save during a slow PUT, backoff not reset by typing, 404 and sign-out, rollback-style saves, web content-only saves, old-client and stale saves, PUT after account deletion, the main app's request shape). | PGlite can't exercise concurrency, and several failure paths had no check (integrity 11). |

Not changed, as the security review found nothing to fix: cross-user access
(every query filters by `user_id`, `view` answers null for other users'
ids), key injection (the id rule and numeric user ids), and content served
from the bucket (type limited to JPEG, PNG and WebP and signed into the
upload; view links go only to the owner).
