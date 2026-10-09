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
--   the daily pass last ran; also the bucket's owner id ('bucket-owner'),
--   matched against meta/owner in the bucket before the daily reconcile
--   deletes anything this database doesn't know.
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
  -- Whose photo it was and its size, while an upload link for it may still
  -- be used: `start` counts these toward the account's space until
  -- not_before, so deleting and re-uploading can't hold more than the quota.
  user_id      INTEGER,
  bytes        INTEGER
);
-- For a database that ran an earlier copy of this file (local stacks only).
ALTER TABLE storage_deletions ADD COLUMN IF NOT EXISTS user_id INTEGER;
ALTER TABLE storage_deletions ADD COLUMN IF NOT EXISTS bytes INTEGER;
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
